import { describe, expect, it } from "vitest";
import { clientIp } from "./rate-limit";

// The counting itself is in the database: rate-limit.db.test.ts.
describe("sign-in rate limit (SEC-4)", () => {
  it("reads the client address from the proxy's header", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.6" }))).toBe("203.0.113.6");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});
