import "server-only";
import { isAPIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { writeAudit } from "../audit";
import type { Context } from "../context";
import { db } from "../db";
import { logEvent } from "../log";
import { normaliseUsername } from "./accounts";
import {
  AFTER_SUCCESSFUL_SIGN_IN,
  afterFailedSignIn,
  attemptsLeft,
  isLocked,
  type LockState,
  lockMinutesLeft,
  temporaryPasswordExpired,
} from "./lockout";
import { isRole, type Role } from "./roles";

export type SignInRefusal = { kind: "wrong"; attemptsLeft: number } | { kind: "locked"; minutesLeft: number };

export type SignInResult =
  { ok: true; role: Role; mustChangePassword: boolean } | { ok: false; refusal: SignInRefusal };

/**
 * Lock states for usernames that have no account, kept in memory like the rate limit. They count down and
 * lock exactly as a real account does, so the messages never show whether a username exists (AUTH-2).
 */
const unknownNames = new Map<string, LockState>();

function unknownNameState(accountName: string, now: Date): LockState {
  if (unknownNames.size > 10_000) {
    for (const [name, state] of unknownNames) if (!isLocked(state, now)) unknownNames.delete(name);
  }
  return unknownNames.get(accountName) ?? AFTER_SUCCESSFUL_SIGN_IN;
}

function refusalFor(state: LockState, now: Date): { ok: false; refusal: SignInRefusal } {
  return isLocked(state, now)
    ? { ok: false, refusal: { kind: "locked", minutesLeft: lockMinutesLeft(state, now) } }
    : { ok: false, refusal: { kind: "wrong", attemptsLeft: attemptsLeft(state) } };
}

function errorCode(error: { body?: unknown }): string | null {
  const body = error.body as { code?: unknown } | undefined;
  return typeof body?.code === "string" ? body.code : null;
}

/**
 * Checks a username and password (AUTH-1) and, if they are right, starts a session.
 * A refusal says how many tries are left before the 5th wrong one locks the account, or how long the lock
 * has to run. It reads the same whether the username exists, the password is wrong, the account is
 * disabled, or the temporary password has expired (AUTH-2): each of those counts as a wrong try.
 */
export async function attemptSignIn(
  input: { username: string; password: string },
  requestHeaders: Headers,
): Promise<SignInResult> {
  const accountName = normaliseUsername(input.username);
  const now = new Date();
  const user = await db.user.findUnique({
    where: { username: accountName },
    select: {
      id: true,
      role: true,
      failedSignIns: true,
      lockedUntil: true,
      mustChangePassword: true,
      temporaryPasswordSetAt: true,
      newPasswordAskedAt: true,
    },
  });

  if (!user) {
    const state = unknownNameState(accountName, now);
    if (isLocked(state, now)) {
      logEvent("sign_in_refused", { reason: "locked", userId: null });
      return refusalFor(state, now);
    }
    try {
      // Better Auth still checks the password, so an unknown name takes as long as a known one.
      await auth.api.signInUsername({
        body: { username: accountName, password: input.password },
        headers: requestHeaders,
      });
    } catch (error) {
      if (!isAPIError(error)) throw error;
    }
    const next = afterFailedSignIn(state, now);
    unknownNames.set(accountName, next);
    logEvent("sign_in_failed", { reason: "unknown_user" });
    return refusalFor(next, now);
  }

  if (isLocked(user, now)) {
    logEvent("sign_in_refused", { reason: "locked", userId: user.id });
    return refusalFor(user, now);
  }

  /** Counts a wrong try against the account, locking it on the 5th. */
  const refuse = async (reason: string) => {
    const next = afterFailedSignIn(user, now);
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: next });
      if (next.lockedUntil) {
        await writeAudit(tx, {
          actorId: null,
          action: "account_locked",
          entityType: "user",
          entityId: user.id,
          after: { lockedUntil: next.lockedUntil.toISOString() },
        });
      }
    });
    logEvent("sign_in_failed", { reason, userId: user.id, locked: next.lockedUntil !== null });
    return refusalFor(next, now);
  };

  if (temporaryPasswordExpired(user, now)) return refuse("temporary_password_expired");

  try {
    await auth.api.signInUsername({
      body: { username: accountName, password: input.password },
      headers: requestHeaders,
    });
  } catch (error) {
    if (!isAPIError(error)) throw error;
    return refuse(errorCode(error) ?? String(error.statusCode));
  }

  // A missing role is refused again by getContext().
  if (!isRole(user.role)) return refusalFor(user, now);

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { ...AFTER_SUCCESSFUL_SIGN_IN, lastSignInAt: now, newPasswordAskedAt: null },
    });
    // The officer knows their password after all, so a request for a new one no longer waits (AUTH-7).
    if (user.newPasswordAskedAt) {
      await writeAudit(tx, {
        actorId: user.id,
        action: "new_password_request_withdrawn",
        entityType: "user",
        entityId: user.id,
      });
    }
  });
  logEvent("sign_in", { userId: user.id });
  return { ok: true, role: user.role, mustChangePassword: user.mustChangePassword };
}

/**
 * Replaces the signed-in user's password (AUTH-3). All their other sessions end, and a temporary
 * password stops being temporary.
 */
export async function changeOwnPassword(
  context: Context,
  input: { current: string; next: string },
  requestHeaders: Headers,
): Promise<{ ok: true } | { ok: false; error: "currentWrong" }> {
  try {
    await auth.api.changePassword({
      body: { currentPassword: input.current, newPassword: input.next, revokeOtherSessions: true },
      headers: requestHeaders,
    });
  } catch (error) {
    if (isAPIError(error) && errorCode(error) === "INVALID_PASSWORD") return { ok: false, error: "currentWrong" };
    throw error;
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: context.userId },
      data: { mustChangePassword: false, temporaryPasswordSetAt: null },
    });
    await writeAudit(tx, {
      actorId: context.userId,
      action: "password_changed",
      entityType: "user",
      entityId: context.userId,
    });
  });
  logEvent("password_changed", { userId: context.userId });
  return { ok: true };
}

export async function signOutCurrentSession(requestHeaders: Headers): Promise<void> {
  await auth.api.signOut({ headers: requestHeaders });
}
