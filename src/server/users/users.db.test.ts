import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient, freeOfficeId } from "../../../tests/db/client";
import type { AccountInput } from "@/lib/validation/user";
import { askForNewPassword } from "../auth/new-password";
import { closeNewPasswordRequest, createAccount, resetPassword, setAccountDisabled, updateAccount } from "./commands";
import { accountHistory, listAccounts, newPasswordRequestsNow } from "./queries";

const db = createTestClient();
const ADMIN = "users-test-admin";

const officer = (dsOfficeId: number | null): AccountInput => ({
  name: "ජී. පරීක්ෂණ",
  designation: "සංවර්ධන නිලධාරී",
  mobile: "0710000201",
  contactEmail: null,
  role: "DS_OFFICER",
  dsOfficeId,
});

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

    const ho = await createAccount(db, ADMIN, { ...officer(null), role: "HO_OFFICER" });
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

    const [latest] = await accountHistory(db, user.id);
    expect(latest).toMatchObject({
      action: "account_updated",
      actorName: "පරිපාලක",
      before: { dsOfficeId: from },
      after: { dsOfficeId: to },
    });
  });

  it("records nothing when nothing changed", async () => {
    const { user, dsOfficeId } = await newOfficer();
    expect(await updateAccount(db, ADMIN, user.id, officer(dsOfficeId))).toEqual({ ok: true, value: { changed: [] } });
    expect(await accountHistory(db, user.id)).toHaveLength(1);
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
    expect((await accountHistory(db, user.id))[0].action).toBe("password_reset");
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
    expect((await accountHistory(db, user.id)).map((h) => h.action).slice(0, 2)).toEqual([
      "account_enabled",
      "account_disabled",
    ]);
  });

  it("won't let an admin disable themselves, or the last active admin", async () => {
    expect(await setAccountDisabled(db, ADMIN, ADMIN, true)).toEqual({ ok: false, error: "self" });
    const otherAdmin = await createAccount(db, ADMIN, { ...officer(null), role: "ADMIN" });
    if (!otherAdmin.ok) throw new Error(otherAdmin.error);
    const other = await db.user.findUniqueOrThrow({ where: { username: otherAdmin.value.username } });

    // With another active admin, disabling that one is allowed...
    expect(await setAccountDisabled(db, ADMIN, other.id, true)).toEqual({ ok: true, value: null });
    // ...and once ADMIN is the only active admin left (other test files may have made admins too),
    // it can't be demoted by someone else either.
    await db.user.updateMany({ where: { role: "ADMIN", id: { not: ADMIN } }, data: { banned: true } });
    expect(await updateAccount(db, other.id, ADMIN, { ...officer(null), role: "HO_OFFICER" })).toEqual({
      ok: false,
      error: "lastAdmin",
    });
  });
});

describe("the account list (ADM-1)", () => {
  it("finds accounts by office name and filters by role", async () => {
    const { user, dsOfficeId } = await newOfficer();
    const office = await db.dsOffice.findUniqueOrThrow({ where: { id: dsOfficeId } });

    const found = await listAccounts(db, { q: office.nameSi, role: "DS_OFFICER" }, "si");
    expect(found.map((row) => row.id)).toContain(user.id);
    expect(found.every((row) => row.role === "DS_OFFICER")).toBe(true);
    expect(await listAccounts(db, { role: "HO_OFFICER", q: office.nameSi }, "si")).toEqual([]);
  });
});

describe("asking for a new password (AUTH-7)", () => {
  const askedAt = async (id: string) =>
    (await db.user.findUniqueOrThrow({ where: { id }, select: { newPasswordAskedAt: true } })).newPasswordAskedAt;
  const waiting = async () => (await newPasswordRequestsNow(db)).count;

  it("opens one request for the account, however the username is typed and however often", async () => {
    const { user, credentials } = await newOfficer();
    const before = await waiting();

    expect(await askForNewPassword(db, ` ${credentials.username.toUpperCase()} `)).toBe(user.id);
    expect(await askForNewPassword(db, credentials.username)).toBeNull();

    expect(await askedAt(user.id)).toBeInstanceOf(Date);
    expect(await waiting()).toBe(before + 1);
    const history = await accountHistory(db, user.id);
    expect(history.filter((h) => h.action === "new_password_asked")).toHaveLength(1);
    expect(history[0]).toMatchObject({ action: "new_password_asked", actorName: null });
  });

  it("opens nothing for an unknown username or a disabled account", async () => {
    const before = await waiting();
    expect(await askForNewPassword(db, "ds9999-none")).toBeNull();

    const { user, credentials } = await newOfficer();
    await setAccountDisabled(db, ADMIN, user.id, true);
    expect(await askForNewPassword(db, credentials.username)).toBeNull();
    expect(await askedAt(user.id)).toBeNull();
    expect(await waiting()).toBe(before);
  });

  it("puts the accounts waiting first on the list, the longest waiting at the top", async () => {
    const first = await newOfficer();
    const second = await newOfficer();
    await askForNewPassword(db, second.credentials.username, new Date("2026-10-01T08:00:00Z"));
    await askForNewPassword(db, first.credentials.username, new Date("2026-10-02T08:00:00Z"));

    const rows = await listAccounts(db, {}, "si");
    const waitingRows = rows.filter((row) => row.newPasswordAskedAt !== null);
    expect(rows.slice(0, waitingRows.length)).toEqual(waitingRows);
    const ids = waitingRows.map((row) => row.id);
    expect(ids.indexOf(second.user.id)).toBeLessThan(ids.indexOf(first.user.id));
    expect(waitingRows.find((row) => row.id === first.user.id)?.mobile).toBe("0710000201");
    await closeNewPasswordRequest(db, ADMIN, first.user.id);
    await closeNewPasswordRequest(db, ADMIN, second.user.id);
  });

  it("is answered by a new password", async () => {
    const { user, credentials } = await newOfficer();
    await askForNewPassword(db, credentials.username);
    const before = await waiting();

    expect((await resetPassword(db, ADMIN, user.id)).ok).toBe(true);
    expect(await askedAt(user.id)).toBeNull();
    expect(await waiting()).toBe(before - 1);
  });

  it("can be closed without a new password, once", async () => {
    const { user, credentials } = await newOfficer();
    await askForNewPassword(db, credentials.username);
    const password = await passwordOf(user.id);

    expect(await closeNewPasswordRequest(db, ADMIN, user.id)).toEqual({ ok: true, value: null });
    expect(await closeNewPasswordRequest(db, ADMIN, user.id)).toEqual({ ok: true, value: null });

    expect(await askedAt(user.id)).toBeNull();
    expect(await passwordOf(user.id)).toBe(password);
    const history = await accountHistory(db, user.id);
    expect(history.filter((h) => h.action === "new_password_request_closed")).toHaveLength(1);
    expect(history[0]).toMatchObject({ action: "new_password_request_closed", actorName: "පරිපාලක" });
    expect(await closeNewPasswordRequest(db, ADMIN, "no-such-account")).toEqual({ ok: false, error: "notFound" });
  });

  it("is dropped when the account is disabled", async () => {
    const { user, credentials } = await newOfficer();
    await askForNewPassword(db, credentials.username);

    await setAccountDisabled(db, ADMIN, user.id, true);
    expect(await askedAt(user.id)).toBeNull();
    await setAccountDisabled(db, ADMIN, user.id, false);
    expect(await askedAt(user.id)).toBeNull();
  });
});
