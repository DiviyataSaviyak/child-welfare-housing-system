import { afterAll, describe, expect, it } from "vitest";
import { createTestClient } from "../../../tests/db/client";
import { afterFailedSignIn, isLocked, LOCK_MINUTES, MAX_FAILED_SIGN_INS } from "./lockout";
import { FORGET_UNKNOWN_NAME_DAYS, saveUnknownNameState, unknownNameState } from "./unknown-names";

const db = createTestClient();
const NOW = new Date("2026-10-22T09:00:00Z");
const DAY = 24 * 60 * 60_000;

afterAll(() => db.$disconnect());

/** One wrong try for the name, as attemptSignIn makes it. */
async function wrongTry(name: string, now: Date) {
  const next = afterFailedSignIn(await unknownNameState(db, name), now);
  await saveUnknownNameState(db, name, next, now);
  return next;
}

describe("wrong tries of usernames that have no account (AUTH-2)", () => {
  it("count down and lock exactly as an account's do", async () => {
    const name = "nobody-count";
    for (let attempt = 1; attempt < MAX_FAILED_SIGN_INS; attempt += 1) {
      expect(await wrongTry(name, NOW)).toEqual({ failedSignIns: attempt, lockedUntil: null });
    }
    await wrongTry(name, NOW);
    const locked = await unknownNameState(db, name);
    expect(isLocked(locked, NOW)).toBe(true);
    expect(locked.lockedUntil).toEqual(new Date(NOW.getTime() + LOCK_MINUTES * 60_000));

    // Once the lock runs out, the count starts again.
    const later = new Date(NOW.getTime() + (LOCK_MINUTES + 1) * 60_000);
    expect(await wrongTry(name, later)).toEqual({ failedSignIns: 1, lockedUntil: null });
  });

  it("start from nothing for a name never tried", async () => {
    expect(await unknownNameState(db, "nobody-new")).toEqual({ failedSignIns: 0, lockedUntil: null });
  });

  it("keep only an HMAC of the name, which may be a password typed in the wrong box", async () => {
    await wrongTry("Not-A-Username-2026", NOW);
    const rows = await db.unknownSignInName.findMany();
    expect(JSON.stringify(rows)).not.toContain("Not-A-Username-2026");
  });

  it("forget a name nobody has tried for 30 days", async () => {
    await wrongTry("nobody-forgotten", NOW);
    await wrongTry("nobody-later", new Date(NOW.getTime() + (FORGET_UNKNOWN_NAME_DAYS + 1) * DAY));
    expect(await unknownNameState(db, "nobody-forgotten")).toEqual({ failedSignIns: 0, lockedUntil: null });
    expect((await unknownNameState(db, "nobody-later")).failedSignIns).toBe(1);
  });
});
