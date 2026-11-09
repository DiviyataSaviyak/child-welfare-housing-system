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
  role: "HO_OFFICER",
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
      expect((await createAccount(db, ADMIN, nameless("MINISTRY_PROGRAMME_OFFICER", "HO_OFFICER"))).ok).toBe(true);
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

describe("the account list (ADM-1)", () => {
  it("finds accounts by office name and filters by office type", async () => {
    const { user, dsOfficeId } = await newOfficer();
    const office = await db.dsOffice.findUniqueOrThrow({ where: { id: dsOfficeId } });

    const found = await listAccounts(db, { q: office.nameSi, officeType: "DS" }, "si");
    expect(found.map((row) => row.id)).toContain(user.id);
    expect(found.every((row) => row.officeType === "DS")).toBe(true);
    expect(found.find((row) => row.id === user.id)).toMatchObject({
      designation: "DS_CRPO",
      place: { kind: "dsOffice", office: office.nameSi },
    });
    expect(await listAccounts(db, { officeType: "MINISTRY", q: office.nameSi }, "si")).toEqual([]);
  });

  it("finds a District or Provincial account by its place, in any language", async () => {
    const district = await db.district.findFirstOrThrow({ orderBy: { id: "desc" } });
    const province = await db.province.findFirstOrThrow({ orderBy: { id: "desc" } });
    const made = await Promise.all([
      createAccount(db, ADMIN, nameless("DISTRICT_CRPO", "DISTRICT_OFFICER", { districtId: district.id })),
      createAccount(db, ADMIN, nameless("PROVINCE_PROBATION_OFFICER", "VIEWER", { provinceId: province.id })),
    ]);
    const [districtUser, provinceUser] = made.map((m) => (m.ok ? m.value.username : ""));

    const byDistrict = await listAccounts(db, { q: district.nameEn.toLowerCase(), officeType: "DISTRICT" }, "ta");
    expect(byDistrict.find((row) => row.username === districtUser)).toMatchObject({
      officeType: "DISTRICT",
      role: "DISTRICT_OFFICER",
      place: { kind: "district", district: district.nameTa },
    });
    const byProvince = await listAccounts(db, { q: province.nameSi, officeType: "PROVINCE" }, "en");
    expect(byProvince.find((row) => row.username === provinceUser)).toMatchObject({
      place: { kind: "province", province: province.nameEn },
    });
    const admins = await listAccounts(db, { officeType: "ADMINISTRATOR" }, "si");
    expect(admins.length).toBeGreaterThan(0);
    expect(admins.every((row) => row.role === "ADMIN" && row.designation === null && row.place === null)).toBe(true);
  });
});
