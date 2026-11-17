import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId } from "../../../tests/db/client";
import type { AccountInput } from "@/lib/validation/user";
import { createAccount, resetPassword, setAccountDisabled, updateAccount, updateProfile } from "./commands";
import { accountHistory, getProfile, labelOf, listAccounts } from "./queries";

const db = createTestClient();
const ADMIN = "users-test-admin";

const officer = (dsOfficeId: number | null): AccountInput => ({
  name: "ජී. පරීක්ෂණ",
  designation: "DS_CRPO",
  mobile: "0710000201",
  contactEmail: null,
  role: "DS_OFFICER",
  dsOfficeId,
  districtId: null,
  provinceId: null,
});

/** An account of another office type, with only what the form requires: no name, mobile or email (ADM-2). */
const nameless = (
  designation: AccountInput["designation"],
  role: AccountInput["role"],
  place: Partial<Pick<AccountInput, "dsOfficeId" | "districtId" | "provinceId">> = {},
): AccountInput => ({
  name: "",
  mobile: null,
  contactEmail: null,
  designation,
  role,
  dsOfficeId: null,
  districtId: null,
  provinceId: null,
  ...place,
});

const headOfficeOfficer: AccountInput = {
  ...officer(null),
  role: "MINISTRY_OFFICER",
  designation: "MINISTRY_PROGRAMME_OFFICER",
};

/** Creates a DS officer at a free office and returns the account and its office. */
async function newOfficer() {
  const dsOfficeId = await freeOfficeId(db);
  const created = await createAccount(db, ADMIN, officer(dsOfficeId));
  if (!created.ok) throw new Error(created.error);
  const user = await db.user.findUniqueOrThrow({ where: { username: created.value.username } });
  return { user, dsOfficeId, credentials: created.value };
}

const passwordOf = async (userId: string) =>
  (await db.account.findFirstOrThrow({ where: { userId, providerId: "credential" } })).password ?? "";

beforeAll(async () => {
  await seed(db);
  await db.user.create({
    data: { id: ADMIN, name: "පරිපාලක", email: "users-test-admin@no-email.invalid", username: "ad9000", role: "ADMIN" },
  });
});

afterAll(() => db.$disconnect());

describe("creating an account (ADM-2)", () => {
  it("makes the account, its temporary password and an audit record together", async () => {
    const { user, dsOfficeId, credentials } = await newOfficer();

    expect(credentials.username).toMatch(/^ds\d{4}$/);
    expect(user).toMatchObject({ role: "DS_OFFICER", dsOfficeId, mustChangePassword: true, banned: false });
    expect(user.email).toBe(`${credentials.username}@no-email.invalid`);
    expect(await verifyPassword({ hash: await passwordOf(user.id), password: credentials.temporaryPassword })).toBe(
      true,
    );

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: user.id, action: "account_created" } });
    expect(audit.actorId).toBe(ADMIN);
  });

  it("gives the next number to the next account", async () => {
    const first = await newOfficer();
    const second = await newOfficer();
    expect(Number(second.credentials.username.slice(2))).toBe(Number(first.credentials.username.slice(2)) + 1);
  });

  it("makes a District Secretariat account with no name, mobile or email (AC-37)", async () => {
    const district = await db.district.findFirstOrThrow({ orderBy: { id: "asc" } });
    const created = await createAccount(
      db,
      ADMIN,
      nameless("DISTRICT_CHIEF_ACCOUNTANT", "VIEWER", { districtId: district.id }),
    );
    if (!created.ok) throw new Error(created.error);
    expect(created.value.username).toMatch(/^dt\d{4}$/);
    expect(await db.user.findUniqueOrThrow({ where: { username: created.value.username } })).toMatchObject({
      name: "",
      mobile: null,
      contactEmail: null,
      role: "VIEWER",
      designation: "DISTRICT_CHIEF_ACCOUNTANT",
      dsOfficeId: null,
      districtId: district.id,
      provinceId: null,
      mustChangePassword: true,
    });
  });

  it("gives each office type its own prefix and place", async () => {
    const province = await db.province.findFirstOrThrow({ orderBy: { id: "asc" } });
    const commissioner = await createAccount(
      db,
      ADMIN,
      nameless("PROVINCE_COMMISSIONER", "VIEWER", { provinceId: province.id }),
    );
    const department = await createAccount(db, ADMIN, nameless("DEPARTMENT_COMMISSIONER", "VIEWER"));
    const secretary = await createAccount(db, ADMIN, nameless("MINISTRY_SECRETARY", "VIEWER"));
    const usernames = [commissioner, department, secretary].map((m) => (m.ok ? m.value.username : ""));
    expect(usernames.map((u) => u.slice(0, 2))).toEqual(["pv", "pd", "ho"]);
    expect(await db.user.findUniqueOrThrow({ where: { username: usernames[0] } })).toMatchObject({
      provinceId: province.id,
      districtId: null,
      dsOfficeId: null,
    });
  });

  it("puts no cap on how many hold a designation (AC-39)", async () => {
    const officers = () => db.user.count({ where: { designation: "MINISTRY_PROGRAMME_OFFICER", banned: false } });
    const admins = () => db.user.count({ where: { role: "ADMIN", banned: false } });
    const [officersBefore, adminsBefore] = [await officers(), await admins()];
    for (let i = 0; i < 3; i += 1) {
      expect((await createAccount(db, ADMIN, nameless("MINISTRY_PROGRAMME_OFFICER", "MINISTRY_OFFICER"))).ok).toBe(
        true,
      );
      expect((await createAccount(db, ADMIN, nameless(null, "ADMIN"))).ok).toBe(true);
    }
    expect(await officers()).toBe(officersBefore + 3);
    expect(await admins()).toBe(adminsBefore + 3);
  });

  it("refuses a district or province that doesn't exist", async () => {
    const district = await createAccount(db, ADMIN, nameless("DISTRICT_SECRETARY", "VIEWER", { districtId: 999_999 }));
    expect(district).toEqual({ ok: false, error: "officeUnavailable" });
    const province = await createAccount(
      db,
      ADMIN,
      nameless("PROVINCE_COMMISSIONER", "VIEWER", { provinceId: 999_999 }),
    );
    expect(province).toEqual({ ok: false, error: "officeUnavailable" });
  });

  it("refuses an inactive office (LST-3)", async () => {
    const office = await freeOfficeId(db);
    await db.dsOffice.update({ where: { id: office }, data: { active: false } });
    expect(await createAccount(db, ADMIN, officer(office))).toEqual({ ok: false, error: "officeUnavailable" });
    await db.dsOffice.update({ where: { id: office }, data: { active: true } });
  });
});

describe("several DS officers at one office (ADM-3)", () => {
  const active = (dsOfficeId: number) => db.user.count({ where: { dsOfficeId, role: "DS_OFFICER", banned: false } });

  it("gives an office that has an officer a second one", async () => {
    const { dsOfficeId } = await newOfficer();
    const second = await createAccount(db, ADMIN, officer(dsOfficeId));
    expect(second.ok).toBe(true);
    expect(await active(dsOfficeId)).toBe(2);
  });

  it("enables a former officer again while the office has another", async () => {
    const { user: former, dsOfficeId } = await newOfficer();
    expect(await setAccountDisabled(db, ADMIN, former.id, true)).toEqual({ ok: true, value: null });
    expect((await createAccount(db, ADMIN, officer(dsOfficeId))).ok).toBe(true);

    expect(await setAccountDisabled(db, ADMIN, former.id, false)).toEqual({ ok: true, value: null });
    expect(await active(dsOfficeId)).toBe(2);
  });

  it("moves an officer to an office that has one, and turns a Head Office account into another", async () => {
    const { user } = await newOfficer();
    const { dsOfficeId: office } = await newOfficer();
    expect(await updateAccount(db, ADMIN, user.id, officer(office))).toEqual({
      ok: true,
      value: { changed: ["dsOfficeId"] },
    });

    const ho = await createAccount(db, ADMIN, headOfficeOfficer);
    if (!ho.ok) throw new Error(ho.error);
    const headOffice = await db.user.findUniqueOrThrow({ where: { username: ho.value.username } });
    expect((await updateAccount(db, ADMIN, headOffice.id, officer(office))).ok).toBe(true);
    expect(await active(office)).toBe(3);
  });
});

describe("changing an account (ADM-4)", () => {
  it("moves an officer to another office and keeps both offices in the history", async () => {
    const { user, dsOfficeId: from } = await newOfficer();
    const to = await freeOfficeId(db);

    const result = await updateAccount(db, ADMIN, user.id, officer(to));
    expect(result).toEqual({ ok: true, value: { changed: ["dsOfficeId"] } });

    const [latest] = await accountHistory(db, user.id, "si");
    expect(latest).toMatchObject({
      action: "account_updated",
      actorName: "පරිපාලක",
      before: { dsOfficeId: from },
      after: { dsOfficeId: to },
    });
  });

  it("changes the office type, designation and place, and records both sides (ADM-4)", async () => {
    const { user, dsOfficeId } = await newOfficer();
    const office = await db.dsOffice.findUniqueOrThrow({ where: { id: dsOfficeId } });
    const input: AccountInput = {
      ...officer(null),
      designation: "DISTRICT_SECRETARY",
      role: "VIEWER",
      districtId: office.districtId,
    };

    const result = await updateAccount(db, ADMIN, user.id, input);
    expect(result).toEqual({ ok: true, value: { changed: ["designation", "role", "dsOfficeId", "districtId"] } });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      role: "VIEWER",
      designation: "DISTRICT_SECRETARY",
      dsOfficeId: null,
      districtId: office.districtId,
    });
    const [latest] = await accountHistory(db, user.id, "si");
    expect(latest).toMatchObject({
      before: { designation: "DS_CRPO", role: "DS_OFFICER", dsOfficeId, districtId: null },
      after: { designation: "DISTRICT_SECRETARY", role: "VIEWER", dsOfficeId: null, districtId: office.districtId },
    });
  });

  it("records nothing when nothing changed", async () => {
    const { user, dsOfficeId } = await newOfficer();
    expect(await updateAccount(db, ADMIN, user.id, officer(dsOfficeId))).toEqual({ ok: true, value: { changed: [] } });
    expect(await accountHistory(db, user.id, "si")).toHaveLength(1);
  });
});

describe("changing one's own profile", () => {
  it("changes the officer's own details, keeps the role and office, and logs the officer as the actor", async () => {
    const { user, dsOfficeId } = await newOfficer();
    const details = { name: "ජී. පරීක්ෂණ", mobile: "0770000202", contactEmail: "g@example.lk" };

    const result = await updateProfile(db, user.id, details);
    expect(result).toEqual({ ok: true, value: { changed: ["mobile", "contactEmail"] } });

    const after = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after).toMatchObject({ ...details, role: "DS_OFFICER", designation: "DS_CRPO", dsOfficeId });
    const [latest] = await accountHistory(db, user.id, "si");
    expect(latest).toMatchObject({
      action: "account_updated",
      actorName: "ජී. පරීක්ෂණ",
      before: { mobile: "0710000201", contactEmail: null },
      after: { mobile: "0770000202", contactEmail: "g@example.lk" },
    });

    expect(await updateProfile(db, user.id, details)).toEqual({ ok: true, value: { changed: [] } });
    expect(await accountHistory(db, user.id, "si")).toHaveLength(2);
  });

  it("shows the account's username, office type, designation, role and place (ADM-11)", async () => {
    const { user, dsOfficeId } = await newOfficer();
    const office = await db.dsOffice.findUniqueOrThrow({ where: { id: dsOfficeId }, include: { district: true } });
    expect(await getProfile(db, user.id, "si")).toEqual({
      name: user.name,
      username: user.username,
      officeType: "DS",
      designation: "DS_CRPO",
      mobile: user.mobile,
      contactEmail: null,
      role: "DS_OFFICER",
      place: { kind: "dsOffice", office: office.nameSi, district: office.district.nameSi },
    });
  });

  it("lets an officer clear their own name, mobile and email (ADM-11)", async () => {
    const { user } = await newOfficer();
    const empty = { name: "", mobile: null, contactEmail: null };
    expect(await updateProfile(db, user.id, empty)).toEqual({
      ok: true,
      value: { changed: ["name", "mobile"] },
    });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject(empty);
    const [latest] = await accountHistory(db, user.id, "si");
    // The officer, now nameless, is shown by designation and office (ADM-10).
    expect(latest.actorName).toBe(await labelOf(db, user.username ?? "", "si"));
    expect(latest.actorName).toMatch(/, /);
  });
});

describe("resetting a password (ADM-5)", () => {
  it("issues a new temporary password, clears a lock and ends the sessions", async () => {
    const { user: created, credentials } = await newOfficer();
    const user = await db.user.update({
      where: { id: created.id },
      data: { mustChangePassword: false, failedSignIns: 3, lockedUntil: new Date(Date.now() + 60_000) },
    });
    await db.session.create({
      data: { id: "reset-session", token: "reset-token", userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
    });

    const result = await resetPassword(db, ADMIN, user.id);
    if (!result.ok) throw new Error(result.error);

    expect(await verifyPassword({ hash: await passwordOf(user.id), password: result.value.temporaryPassword })).toBe(
      true,
    );
    expect(await verifyPassword({ hash: await passwordOf(user.id), password: credentials.temporaryPassword })).toBe(
      false,
    );
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      mustChangePassword: true,
      failedSignIns: 0,
      lockedUntil: null,
    });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect((await accountHistory(db, user.id, "si"))[0].action).toBe("password_reset");
  });
});

describe("disabling an account (ADM-6)", () => {
  it("disables and re-enables an officer, ending their sessions", async () => {
    const { user } = await newOfficer();
    await db.session.create({
      data: {
        id: "disable-session",
        token: "disable-token",
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });

    expect(await setAccountDisabled(db, ADMIN, user.id, true)).toEqual({ ok: true, value: null });
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).banned).toBe(true);
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);

    expect(await setAccountDisabled(db, ADMIN, user.id, false)).toEqual({ ok: true, value: null });
    expect((await accountHistory(db, user.id, "si")).map((h) => h.action).slice(0, 2)).toEqual([
      "account_enabled",
      "account_disabled",
    ]);
  });

  it("won't let an admin disable themselves, or the last active admin", async () => {
    expect(await setAccountDisabled(db, ADMIN, ADMIN, true)).toEqual({ ok: false, error: "self" });
    const otherAdmin = await createAccount(db, ADMIN, nameless(null, "ADMIN"));
    if (!otherAdmin.ok) throw new Error(otherAdmin.error);
    const other = await db.user.findUniqueOrThrow({ where: { username: otherAdmin.value.username } });

    // With another active admin, disabling that one is allowed...
    expect(await setAccountDisabled(db, ADMIN, other.id, true)).toEqual({ ok: true, value: null });
    // ...and once ADMIN is the only active admin left (other test files may have made admins too),
    // it can't be demoted by someone else either.
    await db.user.updateMany({ where: { role: "ADMIN", id: { not: ADMIN } }, data: { banned: true } });
    expect(await updateAccount(db, other.id, ADMIN, headOfficeOfficer)).toEqual({
      ok: false,
      error: "lastAdmin",
    });
  });
});

/** Writes accounts straight into the table, without a temporary password each, for the list's tests. */
async function madeUpAccounts(
  marker: string,
  accounts: {
    name: string;
    designation: AccountInput["designation"];
    role: AccountInput["role"];
    place?: Partial<Pick<AccountInput, "dsOfficeId" | "districtId" | "provinceId">>;
    banned?: boolean;
    lastSignInAt?: Date;
  }[],
) {
  await db.user.createMany({
    data: accounts.map((a, i) => ({
      id: `${marker}-${i}`,
      name: `ලැයිස්තු ${marker} ${a.name}`,
      email: `${marker}-${i}@no-email.invalid`,
      // Not a prefix and four digits, so the usernames the form gives next (ADM-2) stay as they were.
      username: `list-${marker}-${i}`,
      role: a.role,
      designation: a.designation,
      banned: a.banned ?? false,
      lastSignInAt: a.lastSignInAt ?? null,
      ...a.place,
    })),
  });
}

describe("the account list (ADM-1, ADM-12)", () => {
  it("narrows by province, district and DS office, and counts each choice (AC-72)", async () => {
    const kandy = await db.district.findFirstOrThrow({
      where: { nameEn: "Kandy" },
      include: { dsOffices: { orderBy: { id: "asc" } } },
    });
    const [office, otherOffice] = kandy.dsOffices;
    const matale = await db.district.findFirstOrThrow({
      where: { provinceId: kandy.provinceId, id: { gt: kandy.id } },
      include: { dsOffices: true },
    });
    const elsewhere = await db.dsOffice.findFirstOrThrow({
      where: { district: { provinceId: { not: kandy.provinceId } } },
    });
    await madeUpAccounts("places", [
      { name: "අ", designation: "DS_CRPO", role: "DS_OFFICER", place: { dsOfficeId: office.id } },
      { name: "ආ", designation: "DS_ACCOUNTANT", role: "VIEWER", place: { dsOfficeId: office.id } },
      { name: "ඇ", designation: "DS_CRPO", role: "DS_OFFICER", place: { dsOfficeId: otherOffice.id } },
      { name: "ඈ", designation: "DS_CRPO", role: "DS_OFFICER", place: { dsOfficeId: matale.dsOffices[0].id } },
      { name: "ඉ", designation: "DISTRICT_SECRETARY", role: "VIEWER", place: { districtId: kandy.id } },
      { name: "ඊ", designation: "PROVINCE_COMMISSIONER", role: "VIEWER", place: { provinceId: kandy.provinceId } },
      { name: "උ", designation: "DS_CRPO", role: "DS_OFFICER", place: { dsOfficeId: elsewhere.id } },
      { name: "ඌ", designation: "MINISTRY_SECRETARY", role: "VIEWER" },
    ]);
    const list = (filter: Parameters<typeof listAccounts>[1]) =>
      listAccounts(db, { q: "ලැයිස්තු places", ...filter }, "en");

    const all = await list({});
    expect(all.total).toBe(8);
    expect(all.counts.provinces[kandy.provinceId]).toBe(6);
    expect(all.counts.districts[kandy.id]).toBe(4);
    expect(all.counts.districts[matale.id]).toBe(1);
    expect(all.counts.dsOffices[office.id]).toBe(2);

    // A place leaves out the accounts with none, such as the Ministry's.
    const province = await list({ provinceId: kandy.provinceId });
    expect(province.rows.map((r) => r.name.at(-1))).toEqual(["ඊ", "ඉ", "අ", "ආ", "ඇ", "ඈ"]);
    // The office type tabs count under the place, the places under the office type.
    expect(province.counts.officeTypes).toMatchObject({ all: 6, DS: 4, DISTRICT: 1, PROVINCE: 1, MINISTRY: 0 });
    expect(province.counts.provinces[kandy.provinceId]).toBe(6);

    const district = await list({ provinceId: kandy.provinceId, districtId: kandy.id });
    expect(district.total).toBe(4);
    const dsOffice = await list({ provinceId: kandy.provinceId, districtId: kandy.id, dsOfficeId: office.id });
    expect(dsOffice.rows.map((r) => r.name.at(-1))).toEqual(["අ", "ආ"]);
    expect(dsOffice.rows[0].place).toEqual({ kind: "dsOffice", office: office.nameEn, district: "Kandy" });
    // The other offices still count, so the list can offer them.
    expect(dsOffice.counts.dsOffices[otherOffice.id]).toBe(1);

    const ds = await list({ officeType: "DS", provinceId: kandy.provinceId });
    expect(ds.total).toBe(4);
    expect(ds.counts.provinces[kandy.provinceId]).toBe(4);
    expect(ds.counts.officeTypes.all).toBe(6);

    // With no place, the accounts with none come first.
    expect(all.rows[0].name.at(-1)).toBe("ඌ");
    expect(all.rows[0].place).toBeNull();
  });

  it("searches by name or username only", async () => {
    const kandy = await db.district.findFirstOrThrow({ where: { nameEn: "Kandy" } });
    expect((await listAccounts(db, { q: "Kandy" }, "en")).rows.some((r) => r.name.includes("places"))).toBe(false);
    const [account] = (await listAccounts(db, { q: "ලැයිස්තු places", districtId: kandy.id }, "si")).rows;
    const byUsername = await listAccounts(db, { q: account.username.toUpperCase() }, "si");
    expect(byUsername.rows.map((r) => r.id)).toEqual([account.id]);
  });

  it("filters by status, sorts by a column either way and shows 50 to a page (AC-73)", async () => {
    const dsOfficeId = (await db.dsOffice.findFirstOrThrow({ orderBy: { id: "desc" } })).id;
    const day = (n: number) => new Date(Date.UTC(2026, 9, n));
    await madeUpAccounts(
      "pages",
      Array.from({ length: 55 }, (_, i) => ({
        name: String(i + 10),
        designation: "DS_CRPO" as const,
        role: "DS_OFFICER" as const,
        place: { dsOfficeId },
        // Every fifth is disabled, every third signed in on a day of its own; the rest never signed in.
        banned: i % 5 === 0,
        ...(i % 3 === 0 && { lastSignInAt: day(1 + (i % 28)) }),
      })),
    );
    const q = "ලැයිස්තු pages";

    const first = await listAccounts(db, { q }, "si");
    expect([first.total, first.page, first.rows.length]).toEqual([55, 1, 50]);
    const second = await listAccounts(db, { q, page: 2 }, "si");
    expect(second.rows).toHaveLength(5);
    expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(55);
    // A page past the end shows the last.
    expect((await listAccounts(db, { q, page: 9 }, "si")).page).toBe(2);

    const never = await listAccounts(db, { q, status: "neverSignedIn" }, "si");
    expect(never.total).toBe(55 - 11 - 19 + 4);
    expect(never.rows.every((r) => r.active && r.lastSignInAt === null)).toBe(true);
    expect((await listAccounts(db, { q, status: "disabled" }, "si")).total).toBe(11);
    expect((await listAccounts(db, { q, status: "active" }, "si")).total).toBe(44);

    const latest = await listAccounts(db, { q, sort: "lastSignIn" }, "si");
    const signIns = latest.rows.map((r) => r.lastSignInAt?.getTime() ?? 0);
    expect(signIns).toEqual([...signIns].sort((a, b) => b - a));
    expect(latest.rows[0].lastSignInAt).toEqual(day(28));
    const earliest = await listAccounts(db, { q, sort: "lastSignIn", reversed: true }, "si");
    expect(earliest.rows[0].lastSignInAt).toBeNull();

    const byName = await listAccounts(db, { q, sort: "name", reversed: true, page: 2 }, "si");
    expect(byName.rows.map((r) => r.name.split(" ").at(-1))).toEqual(["14", "13", "12", "11", "10"]);
  });
});
