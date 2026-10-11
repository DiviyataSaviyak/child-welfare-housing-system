/**
 * SEC-9, SEC-11: secrets live only in the server's .env, and real data never in the repository.
 * Looks at every file git tracks.
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

  it("leaves every secret empty in the server's env template", () => {
    const template = readFileSync("deploy/server/env.example", "utf8");
    for (const key of ["DB_OWNER_PASSWORD", "APP_DB_PASSWORD", "BETTER_AUTH_SECRET", "RESTIC_PASSWORD"]) {
      expect(template).toMatch(new RegExp(`^${key}=$`, "m"));
    }
  });

  it("takes every password in the server's stack from .env", () => {
    const compose = readFileSync("deploy/server/compose.yml", "utf8");
    const literal = compose
      .split("\n")
      .filter((line) => /(PASSWORD|SECRET)\b.*:/.test(line) || /:\/\/[^$]*:[^$@]+@/.test(line))
      .filter((line) => !/\$\{[A-Z_]+(:\?[^}]*)?\}/.test(line));
    expect(literal).toEqual([]);
  });
});

describe("the repository holds no real data (SEC-11)", () => {
  it("tracks no spreadsheet or database dump", () => {
    expect(tracked.filter((path) => /\.(xlsx|xls|csv|dump|sql\.gz)$/i.test(path))).toEqual([]);
  });
});
