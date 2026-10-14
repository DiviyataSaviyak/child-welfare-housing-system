import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seed } from "../../../prisma/seed-data";
import { createTestClient } from "../../../tests/db/client";
import { accountHistory } from "../users/queries";
import { createAccount, setAccountDisabled } from "../users/commands";
import {
  CODE_MINUTES,
  CODES_PER_DAY,
  checkResetCode,
  resetPasswordWithCode,
  sendResetCode,
  type SendCode,
} from "./password-reset";

const db = createTestClient();
const ADMIN = "reset-test-admin";
const MINUTE = 60_000;

/** A Head Office officer with a temporary password, as the admin makes one. */
async function newAccount(contactEmail: string | null = "officer401@example.com") {
  const created = await createAccount(db, ADMIN, {
    name: "කේ. පරීක්ෂණ",
    designation: null,
    mobile: "0710000401",
    contactEmail,
    role: "HO_OFFICER",
    dsOfficeId: null,
  });
  if (!created.ok) throw new Error(created.error);
  const user = await db.user.findUniqueOrThrow({ where: { username: created.value.username } });
  return { user, username: created.value.username };
}

/** Records each email instead of sending it. */
function mailBox(works = true) {
  const sent: { email: string; code: string }[] = [];
  const send: SendCode = async (email, code) => {
    sent.push({ email, code });
    return works;
  };
  return { sent, send };
}

const passwordOf = async (userId: string) =>
  (await db.account.findFirstOrThrow({ where: { userId, providerId: "credential" } })).password ?? "";
const codesOf = (userId: string) => db.resetCode.count({ where: { userId } });
const actions = async (userId: string) => (await accountHistory(db, userId)).map((entry) => entry.action);

beforeAll(async () => {
  await seed(db);
  await db.user.create({
    data: { id: ADMIN, name: "පරිපාලක", email: "reset-test-admin@no-email.invalid", username: "ad9100", role: "ADMIN" },
  });
});

afterAll(() => db.$disconnect());

describe("resetting a forgotten password with a code sent by email (AUTH-7)", () => {
  it("sends a code to the account's email address, and the right code lets the officer set their own password", async () => {
    const { user, username } = await newAccount();
    await db.user.update({
      where: { id: user.id },
      data: { failedSignIns: 5, lockedUntil: new Date(Date.now() + 10 * MINUTE) },
    });
    await db.session.create({
      data: {
        id: "reset-test-session",
        token: "reset-test-token",
        userId: user.id,
        expiresAt: new Date(Date.now() + 60 * MINUTE),
      },
    });
    const { sent, send } = mailBox();

    const result = await sendResetCode(db, ` ${username.toUpperCase()} `, send);
    if (!result.ok) throw new Error(result.error);
    expect(result.userId).toBe(user.id);
    expect(sent).toEqual([{ email: "officer401@example.com", code: expect.stringMatching(/^\d{6}$/) }]);
    const { code } = sent[0];

    // Neither the ticket nor the code is stored as it is.
    const row = await db.resetCode.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.id).not.toBe(result.ticket);
    expect(row.codeHash).not.toContain(code);

    // Setting a password before the code was checked doesn't work.
    expect(await resetPasswordWithCode(db, result.ticket, "Own-New-Pass-1")).toEqual({ ok: false, error: "expired" });
    const wrong = code === "000000" ? "111111" : "000000";
    expect(await checkResetCode(db, result.ticket, wrong)).toEqual({ ok: false, error: "wrong", triesLeft: 4 });
    expect(await checkResetCode(db, result.ticket, code)).toEqual({ ok: true });
    expect(await checkResetCode(db, result.ticket, code)).toEqual({ ok: true });

    expect(await resetPasswordWithCode(db, result.ticket, "Own-New-Pass-1")).toEqual({ ok: true, userId: user.id });
    expect(await verifyPassword({ hash: await passwordOf(user.id), password: "Own-New-Pass-1" })).toBe(true);
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({
      mustChangePassword: false,
      temporaryPasswordSetAt: null,
      failedSignIns: 0,
      lockedUntil: null,
    });
    expect(await db.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await codesOf(user.id)).toBe(0);

    // The ticket works once.
    expect(await resetPasswordWithCode(db, result.ticket, "Another-Pass-2")).toEqual({ ok: false, error: "expired" });
    expect(await verifyPassword({ hash: await passwordOf(user.id), password: "Own-New-Pass-1" })).toBe(true);

    const history = await accountHistory(db, user.id);
    expect(history[0]).toMatchObject({ action: "password_reset_by_code", actorName: "කේ. පරීක්ෂණ" });
    expect(history[1]).toMatchObject({ action: "reset_code_sent", actorName: null });
  });

  it("answers the same for an unknown username, a disabled account and one with no email address, and sends nothing", async () => {
    const disabled = await newAccount();
    await setAccountDisabled(db, ADMIN, disabled.user.id, true);
    const noEmail = await newAccount(null);
    const { sent, send } = mailBox();

    for (const username of ["ds9999-none", disabled.username, noEmail.username, "x".repeat(65)]) {
      const result = await sendResetCode(db, username, send);
      expect(result).toMatchObject({ ok: true, userId: null, ticket: expect.any(String) });
      if (!result.ok) continue;
      // Its code reads like any other: wrong, with tries left.
      expect(await checkResetCode(db, result.ticket, "123456")).toMatchObject({ ok: false });
    }
    expect(sent).toEqual([]);
    expect(await codesOf(disabled.user.id)).toBe(0);
    expect(await actions(disabled.user.id)).not.toContain("reset_code_sent");
  });

  it("ends a code after its fifth wrong try", async () => {
    const { username } = await newAccount();
    const { sent, send } = mailBox();
    const result = await sendResetCode(db, username, send);
    if (!result.ok) throw new Error(result.error);
    const wrong = sent[0].code === "000000" ? "111111" : "000000";

    for (const triesLeft of [4, 3, 2, 1]) {
      expect(await checkResetCode(db, result.ticket, wrong)).toEqual({ ok: false, error: "wrong", triesLeft });
    }
    expect(await checkResetCode(db, result.ticket, wrong)).toEqual({ ok: false, error: "tooManyTries" });
    expect(await checkResetCode(db, result.ticket, sent[0].code)).toEqual({ ok: false, error: "tooManyTries" });
  });

  it(`keeps a code for ${CODE_MINUTES} minutes, for the code and the new password both`, async () => {
    const { username } = await newAccount();
    const { sent, send } = mailBox();
    const start = new Date();
    const result = await sendResetCode(db, username, send, start);
    if (!result.ok) throw new Error(result.error);
    const at = (minutes: number) => new Date(start.getTime() + minutes * MINUTE);

    expect(await checkResetCode(db, result.ticket, sent[0].code, at(CODE_MINUTES))).toEqual({
      ok: false,
      error: "expired",
    });
    expect(await checkResetCode(db, result.ticket, sent[0].code, at(CODE_MINUTES - 1))).toEqual({ ok: true });
    expect(await resetPasswordWithCode(db, result.ticket, "Own-New-Pass-1", at(CODE_MINUTES))).toEqual({
      ok: false,
      error: "expired",
    });
    expect(await checkResetCode(db, "no-such-ticket", "123456")).toEqual({ ok: false, error: "expired" });
  });

  it("ends the earlier code when a new one is sent", async () => {
    const { username } = await newAccount();
    const { sent, send } = mailBox();
    const first = await sendResetCode(db, username, send);
    const second = await sendResetCode(db, username, send);
    if (!first.ok || !second.ok) throw new Error("not sent");

    expect(await checkResetCode(db, first.ticket, sent[0].code)).toEqual({ ok: false, error: "expired" });
    expect(await checkResetCode(db, second.ticket, sent[1].code)).toEqual({ ok: true });
  });

  it(`sends an account at most ${CODES_PER_DAY} codes in 24 hours`, async () => {
    const { user, username } = await newAccount();
    const { sent, send } = mailBox();
    const start = new Date();
    const at = (minutes: number) => new Date(start.getTime() + minutes * MINUTE);

    for (let i = 0; i < CODES_PER_DAY; i += 1) await sendResetCode(db, username, send, at(i));
    expect(await sendResetCode(db, username, send, at(CODES_PER_DAY))).toMatchObject({ ok: true, userId: null });
    expect(sent).toHaveLength(CODES_PER_DAY);

    expect(await sendResetCode(db, username, send, at(24 * 60 + 1))).toMatchObject({ ok: true, userId: user.id });
    expect(sent).toHaveLength(CODES_PER_DAY + 1);
  });

  it("refuses when the email didn't go, and keeps nothing of it", async () => {
    const { user, username } = await newAccount();
    const { sent, send } = mailBox(false);

    expect(await sendResetCode(db, username, send)).toEqual({ ok: false, error: "emailFailed" });
    expect(sent).toHaveLength(1);
    expect(await codesOf(user.id)).toBe(0);
    expect(await actions(user.id)).not.toContain("reset_code_sent");
  });

  it("sets no password on an account disabled after its code was checked", async () => {
    const { user, username } = await newAccount();
    const { sent, send } = mailBox();
    const result = await sendResetCode(db, username, send);
    if (!result.ok) throw new Error(result.error);
    expect(await checkResetCode(db, result.ticket, sent[0].code)).toEqual({ ok: true });
    const password = await passwordOf(user.id);

    await setAccountDisabled(db, ADMIN, user.id, true);
    expect(await resetPasswordWithCode(db, result.ticket, "Own-New-Pass-1")).toEqual({ ok: false, error: "expired" });
    expect(await passwordOf(user.id)).toBe(password);
  });
});
