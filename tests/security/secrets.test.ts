/**
 * SEC-9, SEC-11: secrets live only in the server's settings, and real data never in the repository.
 * Looks at every file git tracks. The server's env template and Compose file are checked in the
 * Infrastructure repository.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);

const BINARY = /\.(woff2?|ico|png|jpe?g|gif|pdf|xlsx)$/i;
const SECRET_PATTERNS: [string, RegExp][] = [
  ["a private key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["an AWS access key", /\b(AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a GitHub token", /\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/],
  ["a healthchecks.io ping URL", /hc-ping\.com\/[0-9a-f]{8}-[0-9a-f]{4}-/],
];

describe("the repository holds no secrets (SEC-9)", () => {
  it("tracks no env file but the examples, and no key or certificate files", () => {
    const risky = tracked.filter(
      (path) =>
        (/(^|\/)\.env($|\.)/.test(path) && path !== ".env.example") ||
        /\.(pem|key|p12|pfx)$/.test(path) ||
        /(^|\/)id_(rsa|ed25519|ecdsa)/.test(path),
    );
    expect(risky).toEqual([]);
  });

  it("has no private key, access key, token or alert URL in a tracked file", () => {
    const found = tracked
      .filter((path) => !BINARY.test(path))
      .flatMap((path) => {
        const text = readFileSync(path, "utf8");
        return SECRET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([what]) => `${path}: ${what}`);
      });
    expect(found).toEqual([]);
  });
});

describe("the repository holds no real data (SEC-11)", () => {
  it("tracks no spreadsheet or database dump", () => {
    expect(tracked.filter((path) => /\.(xlsx|xls|csv|dump|sql\.gz)$/i.test(path))).toEqual([]);
  });
});
