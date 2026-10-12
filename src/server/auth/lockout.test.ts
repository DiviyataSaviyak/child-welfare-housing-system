import { describe, expect, it } from "vitest";
import {
  AFTER_SUCCESSFUL_SIGN_IN,
  afterFailedSignIn,
  attemptsLeft,
  isLocked,
  lockMinutesLeft,
  type LockState,
  temporaryPasswordExpired,
} from "./lockout";

const now = new Date("2026-09-29T09:00:00Z");
const minutes = (n: number) => new Date(now.getTime() + n * 60_000);
const fresh: LockState = { failedSignIns: 0, lockedUntil: null };

describe("account lock (AUTH-2)", () => {
  it("counts wrong passwords and locks on the fifth, for 15 minutes", () => {
    let state = fresh;
    for (let i = 1; i <= 4; i += 1) {
      state = afterFailedSignIn(state, now);
      expect(state).toEqual({ failedSignIns: i, lockedUntil: null });
      expect(isLocked(state, now)).toBe(false);
    }
    state = afterFailedSignIn(state, now);
    expect(state.lockedUntil).toEqual(minutes(15));
    expect(isLocked(state, now)).toBe(true);
    expect(isLocked(state, minutes(14))).toBe(true);
    expect(isLocked(state, minutes(15))).toBe(false);
  });

  it("starts counting again once a lock has run out", () => {
    const expired: LockState = { failedSignIns: 0, lockedUntil: minutes(-1) };
    expect(afterFailedSignIn(expired, now)).toEqual({ failedSignIns: 1, lockedUntil: null });
  });

  it("says how many wrong passwords are left, and how long a lock has to run", () => {
    expect(attemptsLeft(fresh)).toBe(5);
    expect(attemptsLeft(afterFailedSignIn(fresh, now))).toBe(4);
    const locked: LockState = { failedSignIns: 0, lockedUntil: minutes(15) };
    expect(lockMinutesLeft(locked, now)).toBe(15);
    expect(lockMinutesLeft(locked, new Date(now.getTime() + 14 * 60_000 + 1))).toBe(1);
    expect(lockMinutesLeft(fresh, now)).toBe(0);
  });

  it("clears the count after a correct password", () => {
    expect(AFTER_SUCCESSFUL_SIGN_IN).toEqual(fresh);
  });
});

describe("temporary passwords (SEC-4)", () => {
  const issued = (daysAgo: number) => new Date(now.getTime() - daysAgo * 24 * 60 * 60_000);

  it("work for 7 days", () => {
    expect(temporaryPasswordExpired({ mustChangePassword: true, temporaryPasswordSetAt: issued(6) }, now)).toBe(false);
    expect(temporaryPasswordExpired({ mustChangePassword: true, temporaryPasswordSetAt: issued(8) }, now)).toBe(true);
  });

  it("do not apply once the officer has set their own password", () => {
    expect(temporaryPasswordExpired({ mustChangePassword: false, temporaryPasswordSetAt: issued(30) }, now)).toBe(
      false,
    );
  });
});
