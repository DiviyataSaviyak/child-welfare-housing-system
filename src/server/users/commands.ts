import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { AccountInput } from "@/lib/validation/user";
import { writeAudit } from "../audit";
import { placeholderEmail } from "../auth/accounts";
import { generateTemporaryPassword } from "./passwords";
import { activeAdminCount } from "./queries";
import { type AccountRuleError, checkDisable, checkRoleChange } from "./rules";
import { nextUsername, USERNAME_PREFIX } from "./usernames";

export type AccountCommandError = AccountRuleError | "notFound" | "officeUnavailable";
export type Credentials = { username: string; temporaryPassword: string };

type Result<T> = { ok: true; value: T } | { ok: false; error: AccountCommandError };

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

/** A DS officer's office must exist and be active; inactive offices get no new accounts (LST-3). */
async function officeUsable(db: PrismaClient, dsOfficeId: number | null): Promise<boolean> {
  if (dsOfficeId === null) return true;
  const office = await db.dsOffice.findUnique({ where: { id: dsOfficeId }, select: { active: true } });
  return office?.active === true;
}

/**
 * ADM-2: creates an account with a generated username and a temporary password that must be
 * changed at first sign-in. The password is returned once and only its hash is stored. The actor
 * is null for the first admin, whom the system creates (scripts/create-admin.ts).
 */
export async function createAccount(
  db: PrismaClient,
  actorId: string | null,
  input: AccountInput,
): Promise<Result<Credentials>> {
  if (!(await officeUsable(db, input.dsOfficeId))) return { ok: false, error: "officeUnavailable" };

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  // Two admins creating accounts at the same moment could pick the same username: try again.
  for (let attempt = 1; ; attempt += 1) {
    const taken = await db.user.findMany({
      where: { username: { startsWith: USERNAME_PREFIX[input.role] } },
      select: { username: true },
    });
    const username = nextUsername(
      input.role,
      taken.flatMap((u) => (u.username ? [u.username] : [])),
    );
    const id = randomUUID();
    try {
      await db.$transaction(async (tx) => {
        await tx.user.create({
          data: {
            id,
            name: input.name,
            email: placeholderEmail(username),
            username,
            displayUsername: username,
            role: input.role,
            banned: false,
            designation: input.designation,
            mobile: input.mobile,
            contactEmail: input.contactEmail,
            dsOfficeId: input.dsOfficeId,
            mustChangePassword: true,
            temporaryPasswordSetAt: new Date(),
          },
        });
        await tx.account.create({
          data: { id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: passwordHash },
        });
        await writeAudit(tx, {
          actorId,
          action: "account_created",
          entityType: "user",
          entityId: id,
          after: { username, ...input },
        });
      });
      return { ok: true, value: { username, temporaryPassword } };
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Another admin took the same username.
      if (attempt < 3) continue;
      throw error;
    }
  }
}

const EDITABLE = ["name", "designation", "mobile", "contactEmail", "role", "dsOfficeId"] as const;

/**
 * ADM-4: changes an account's details. Moving a DS officer to another office is how a transfer is
 * recorded; the audit record keeps the old and the new office, and the change applies to the
 * officer's next request (PRM-3).
 */
export async function updateAccount(
  db: PrismaClient,
  actorId: string,
  id: string,
  input: AccountInput,
): Promise<Result<{ changed: string[] }>> {
  const current = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      role: true,
      banned: true,
      name: true,
      designation: true,
      mobile: true,
      contactEmail: true,
      dsOfficeId: true,
    },
  });
  if (!current) return { ok: false, error: "notFound" };

  const roleProblem = checkRoleChange(actorId, current, input.role, await activeAdminCount(db));
  if (roleProblem) return { ok: false, error: roleProblem };
  if (input.dsOfficeId !== current.dsOfficeId && !(await officeUsable(db, input.dsOfficeId))) {
    return { ok: false, error: "officeUnavailable" };
  }

  const changed = EDITABLE.filter((field) => current[field] !== input[field]);
  if (changed.length === 0) return { ok: true, value: { changed } };

  const pick = (source: Record<string, unknown>) =>
    Object.fromEntries(changed.map((f) => [f, source[f]])) as Prisma.InputJsonObject;
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: input });
    await writeAudit(tx, {
      actorId,
      action: "account_updated",
      entityType: "user",
      entityId: id,
      before: pick(current),
      after: pick(input),
    });
  });
  return { ok: true, value: { changed } };
}

/**
 * ADM-5: issues a new temporary password, shown once. It also clears a lock, answers a request for a
 * new password (AUTH-7), and ends every open session of the account.
 */
export async function resetPassword(db: PrismaClient, actorId: string, id: string): Promise<Result<Credentials>> {
  const user = await db.user.findUnique({ where: { id }, select: { username: true } });
  if (!user?.username) return { ok: false, error: "notFound" };

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  await db.$transaction(async (tx) => {
    const updated = await tx.account.updateMany({
      where: { userId: id, providerId: "credential" },
      data: { password: passwordHash },
    });
    if (updated.count === 0) {
      await tx.account.create({
        data: { id: randomUUID(), accountId: id, providerId: "credential", userId: id, password: passwordHash },
      });
    }
    await tx.user.update({
      where: { id },
      data: {
        mustChangePassword: true,
        temporaryPasswordSetAt: new Date(),
        failedSignIns: 0,
        lockedUntil: null,
        newPasswordAskedAt: null,
      },
    });
    await tx.session.deleteMany({ where: { userId: id } });
    await writeAudit(tx, { actorId, action: "password_reset", entityType: "user", entityId: id });
  });
  return { ok: true, value: { username: user.username, temporaryPassword } };
}

/**
 * ADM-6: disables or re-enables an account. Disabling ends its sessions at once (AUTH-5) and drops a
 * waiting request for a new password (AUTH-7).
 */
export async function setAccountDisabled(
  db: PrismaClient,
  actorId: string,
  id: string,
  disabled: boolean,
): Promise<Result<null>> {
  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, banned: true },
  });
  if (!target) return { ok: false, error: "notFound" };
  if (target.banned === disabled) return { ok: true, value: null };

  if (disabled) {
    const problem = checkDisable(actorId, target, await activeAdminCount(db));
    if (problem) return { ok: false, error: problem };
  }

  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: disabled ? { banned: true, newPasswordAskedAt: null } : { banned: false },
    });
    if (disabled) await tx.session.deleteMany({ where: { userId: id } });
    await writeAudit(tx, {
      actorId,
      action: disabled ? "account_disabled" : "account_enabled",
      entityType: "user",
      entityId: id,
    });
  });
  return { ok: true, value: null };
}

/**
 * AUTH-7: the admin closes a request for a new password without giving one, for example when the officer
 * says on the phone that they didn't ask. Closing one that is already closed changes nothing.
 */
export async function closeNewPasswordRequest(db: PrismaClient, actorId: string, id: string): Promise<Result<null>> {
  const user = await db.user.findUnique({ where: { id }, select: { id: true } });
  if (!user) return { ok: false, error: "notFound" };

  await db.$transaction(async (tx) => {
    const closed = await tx.user.updateMany({
      where: { id, newPasswordAskedAt: { not: null } },
      data: { newPasswordAskedAt: null },
    });
    if (closed.count === 0) return;
    await writeAudit(tx, { actorId, action: "new_password_request_closed", entityType: "user", entityId: id });
  });
  return { ok: true, value: null };
}
