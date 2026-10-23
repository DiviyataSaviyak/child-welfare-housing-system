import type { PrismaClient } from "@/generated/prisma/client";
import { keyedHash } from "./keyed-hash";
import { AFTER_SUCCESSFUL_SIGN_IN, type LockState } from "./lockout";

/** A username with no wrong try for this many days is forgotten. */
export const FORGET_UNKNOWN_NAME_DAYS = 30;

const isUniqueViolation = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === "P2002";

/**
 * AUTH-2: the lock state of a username that has no account (`unknown_sign_in_name`). It counts down and
 * locks exactly as an account's does, so the messages never show whether a username exists. It is in
 * the database, so both app containers see the same count.
 */
export async function unknownNameState(db: PrismaClient, accountName: string): Promise<LockState> {
  const row = await db.unknownSignInName.findUnique({
    where: { nameHash: keyedHash(accountName) },
    select: { failedSignIns: true, lockedUntil: true },
  });
  return row ?? AFTER_SUCCESSFUL_SIGN_IN;
}

/** Saves the state after a wrong try, and forgets the names nobody has tried for 30 days. */
export async function saveUnknownNameState(
  db: PrismaClient,
  accountName: string,
  state: LockState,
  now: Date,
): Promise<void> {
  const nameHash = keyedHash(accountName);
  const data = { failedSignIns: state.failedSignIns, lockedUntil: state.lockedUntil, lastTriedAt: now };
  const save = () => db.unknownSignInName.upsert({ where: { nameHash }, create: { nameHash, ...data }, update: data });
  // Two first tries of the same name at the same moment can both try to add the row; the second then updates it.
  await save().catch((error: unknown) => {
    if (isUniqueViolation(error)) return save();
    throw error;
  });
  await db.unknownSignInName.deleteMany({
    where: { lastTriedAt: { lt: new Date(now.getTime() - FORGET_UNKNOWN_NAME_DAYS * 24 * 60 * 60_000) } },
  });
}
