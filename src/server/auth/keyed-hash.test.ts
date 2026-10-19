import { afterEach, describe, expect, it, vi } from "vitest";
import { keyedHash } from "./keyed-hash";

afterEach(() => vi.unstubAllEnvs());

describe("keyed hash of values the database must not hold", () => {
  it("gives the same hash for the same value and key, and another for another key", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-one");
    const first = keyedHash("203.0.113.5");
    expect(keyedHash("203.0.113.5")).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(keyedHash("203.0.113.6")).not.toBe(first);

    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-two");
    expect(keyedHash("203.0.113.5")).not.toBe(first);
  });

  it("refuses to work without the key", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    expect(() => keyedHash("203.0.113.5")).toThrow("BETTER_AUTH_SECRET is not set");
  });
});
