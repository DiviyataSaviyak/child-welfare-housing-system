import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { writeAudit } from "../audit";
import { savePasswordHash } from "../users/commands";
import { normaliseUsername } from "./accounts";

/**
 * AUTH-7: an officer who has forgotten their password sets a new one with a code sent by SMS to the
 * mobile number in their account, in three steps: the username (sendResetCode), the code
 * (checkResetCode), then the new password (resetPasswordWithCode). The browser carries a random ticket
 * from step to step; the database keeps only its SHA-256 and an HMAC of the code.
 */

/** How long a code lasts, for both typing it and setting the new password (SEC-4). */
export const CODE_MINUTES = 15;
/** Wrong codes a ticket takes before it stops working. */
export const CODE_TRIES = 5;
/** Codes an account can be sent in 24 hours. Together with CODE_TRIES this caps guessing at 25 a day. */
export const CODES_PER_DAY = 5;

const DAY_MS = 24 * 60 * 60_000;

const ticketId = (ticket: string) => createHash("sha256").update(ticket).digest("hex");

function codeHash(id: string, code: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set");
  return createHmac("sha256", secret).update(`${id}:${code}`).digest("hex");
}

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Sends the code to a mobile number and says whether the SMS went. */
export type SendCode = (mobile: string, code: string) => Promise<boolean>;

export type SendResult = { ok: true; ticket: string; userId: string | null } | { ok: false; error: "smsFailed" };

/**
 * Step 1. Every username gets a ticket, so the page reads the same whether or not it exists (as for
 * AUTH-2). Only an active account with a mobile number, sent fewer than CODES_PER_DAY codes in the last
 * 24 hours, gets an SMS, and only such a ticket can lead to a new password; the others hold a code
 * nobody was sent. A new code ends the account's earlier ones. The one refusal is an SMS that didn't
 * go, because the officer then needs to know to try later or call the admin. `userId` is for the log.
 */
export async function sendResetCode(
  db: PrismaClient,
  username: string,
  send: SendCode,
  now = new Date(),
): Promise<SendResult> {
  const ticket = randomBytes(32).toString("base64url");
  const id = ticketId(ticket);
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const row = {
    id,
    codeHash: codeHash(id, code),
    createdAt: now,
    expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000),
  };

  // A ticket is no use a day after it ran out, and by then it no longer counts towards the daily limit.
  await db.resetCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - DAY_MS) } } });

  // No username is longer than 64 characters (ADM-2).
  const user =
    username.length > 64
      ? null
      : await db.user.findUnique({
          where: { username: normaliseUsername(username) },
          select: { id: true, role: true, banned: true, mobile: true },
        });
  const sentToday = user
    ? await db.resetCode.count({ where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - DAY_MS) } } })
    : 0;
  if (!user?.role || user.banned || !user.mobile || sentToday >= CODES_PER_DAY) {
    await db.resetCode.create({ data: { ...row, userId: null } });
    return { ok: true, ticket, userId: null };
  }

  // Saved before sending, so the code works the moment it arrives.
  await db.resetCode.create({ data: { ...row, userId: user.id } });
  if (!(await send(user.mobile, code))) {
    await db.resetCode.delete({ where: { id } });
    return { ok: false, error: "smsFailed" };
  }
  await db.$transaction(async (tx) => {
    await tx.resetCode.updateMany({
      where: { userId: user.id, id: { not: id }, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });
    await writeAudit(tx, { actorId: null, action: "reset_code_sent", entityType: "user", entityId: user.id });
  });
  return { ok: true, ticket, userId: user.id };
}

export type CheckResult =
  { ok: true } | { ok: false; error: "wrong"; triesLeft: number } | { ok: false; error: "tooManyTries" | "expired" };

/**
 * Step 2: the six digits as typed. A wrong code counts against the ticket, and the CODE_TRIES-th ends it.
 * An unknown ticket reads as expired. Checking a right code again changes nothing.
 */
export async function checkResetCode(
  db: PrismaClient,
  ticket: string,
  code: string,
  now = new Date(),
): Promise<CheckResult> {
  const id = ticketId(ticket);
  const row = await db.resetCode.findUnique({ where: { id } });
  if (!row || row.expiresAt <= now) return { ok: false, error: "expired" };
  if (row.checkedAt) return { ok: true };
  if (row.tries >= CODE_TRIES) return { ok: false, error: "tooManyTries" };

  // Each update counts only while tries are left, so two tries at once can't go past the limit.
  const stillOpen = { id, tries: { lt: CODE_TRIES } };
  if (sameHash(row.codeHash, codeHash(id, code))) {
    const checked = await db.resetCode.updateMany({ where: stillOpen, data: { checkedAt: now } });
    return checked.count === 1 ? { ok: true } : { ok: false, error: "tooManyTries" };
  }
  const counted = await db.resetCode.updateMany({ where: stillOpen, data: { tries: { increment: 1 } } });
  const triesLeft = CODE_TRIES - row.tries - 1;
  return counted.count === 1 && triesLeft > 0
    ? { ok: false, error: "wrong", triesLeft }
    : { ok: false, error: "tooManyTries" };
}

export type ResetResult = { ok: true; userId: string } | { ok: false; error: "expired" };

/**
 * Step 3: sets the new password (already checked against AUTH-3's rules) once the ticket's code was right
 * and before it expires. The password is the officer's own, so nothing asks them to change it; it also
 * clears a lock, ends every open session, and uses up the account's codes. A disabled account, or a
 * ticket with no account behind it, reads as expired.
 */
export async function resetPasswordWithCode(
  db: PrismaClient,
  ticket: string,
  password: string,
  now = new Date(),
): Promise<ResetResult> {
  const id = ticketId(ticket);
  const row = await db.resetCode.findUnique({
    where: { id },
    select: { userId: true, checkedAt: true, expiresAt: true, user: { select: { role: true, banned: true } } },
  });
  const userId = row?.userId;
  if (!userId || !row.checkedAt || row.expiresAt <= now || !row.user?.role || row.user.banned) {
    return { ok: false, error: "expired" };
  }

  const passwordHash = await hashPassword(password);
  const done = await db.$transaction(async (tx) => {
    // The ticket works once: two forms sent at the same moment can't both set a password.
    const used = await tx.resetCode.deleteMany({ where: { id, checkedAt: { not: null }, expiresAt: { gt: now } } });
    if (used.count === 0) return false;
    await tx.resetCode.deleteMany({ where: { userId } });
    await savePasswordHash(tx, userId, passwordHash);
    await tx.user.update({
      where: { id: userId },
      data: { mustChangePassword: false, temporaryPasswordSetAt: null, failedSignIns: 0, lockedUntil: null },
    });
    await tx.session.deleteMany({ where: { userId } });
    await writeAudit(tx, { actorId: userId, action: "password_reset_by_code", entityType: "user", entityId: userId });
    return true;
  });
  return done ? { ok: true, userId } : { ok: false, error: "expired" };
}
