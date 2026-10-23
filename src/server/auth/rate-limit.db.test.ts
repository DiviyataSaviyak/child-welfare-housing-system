import { afterAll, describe, expect, it } from "vitest";
import { createTestClient } from "../../../tests/db/client";
import { createRateLimiter } from "./rate-limit";

const db = createTestClient();
const START = new Date("2026-10-22T09:00:00Z");
const at = (ms: number) => new Date(START.getTime() + ms);

afterAll(() => db.$disconnect());

// Each test has a limit of its own, because test files share one schema per run.
describe("rate limits kept in the database (SEC-4)", () => {
  it("allows 10 attempts a minute per address, then refuses", async () => {
    const limiter = createRateLimiter({ name: "test-ten", limit: 10, windowMs: 60_000 });
    for (let i = 0; i < 10; i += 1) expect(await limiter.allow(db, "10.0.0.1", at(1_000 + i))).toBe(true);
    expect(await limiter.allow(db, "10.0.0.1", at(2_000))).toBe(false);
    expect(await limiter.allow(db, "10.0.0.2", at(2_000))).toBe(true);
  });

  it("allows attempts again in the next minute", async () => {
    const limiter = createRateLimiter({ name: "test-window", limit: 1, windowMs: 60_000 });
    expect(await limiter.allow(db, "ip", at(0))).toBe(true);
    expect(await limiter.allow(db, "ip", at(59_999))).toBe(false);
    expect(await limiter.allow(db, "ip", at(60_000))).toBe(true);
    expect(await limiter.allow(db, "ip", at(60_001))).toBe(false);
  });

  it("counts attempts made at the same moment once each, as two app containers would make them", async () => {
    const limiter = createRateLimiter({ name: "test-together", limit: 5, windowMs: 60_000 });
    const answers = await Promise.all(Array.from({ length: 8 }, () => limiter.allow(db, "10.0.0.3", at(0))));
    expect(answers.filter(Boolean)).toHaveLength(5);
  });

  it("keeps each limit's count apart", async () => {
    const signIn = createRateLimiter({ name: "test-apart-a", limit: 1, windowMs: 60_000 });
    const resetCode = createRateLimiter({ name: "test-apart-b", limit: 1, windowMs: 60_000 });
    expect(await signIn.allow(db, "10.0.0.4", at(0))).toBe(true);
    expect(await resetCode.allow(db, "10.0.0.4", at(0))).toBe(true);
    expect(await signIn.allow(db, "10.0.0.4", at(1))).toBe(false);
  });

  it("stores only an HMAC of the address, and removes windows that have ended", async () => {
    const limiter = createRateLimiter({ name: "test-stored", limit: 5, windowMs: 60_000 });
    await limiter.allow(db, "203.0.113.9", at(0));
    await limiter.allow(db, "203.0.113.10", at(30_000));
    const keys = async () =>
      (await db.rateLimit.findMany({ where: { key: { startsWith: "test-stored:" } } })).map((row) => row.key);
    expect(await keys()).toHaveLength(2);
    expect((await keys()).join()).not.toContain("203.0.113");

    // A minute after the first: its window has ended, and the next attempt removes it.
    await limiter.allow(db, "203.0.113.10", at(60_000));
    expect(await keys()).toHaveLength(1);
  });
});
