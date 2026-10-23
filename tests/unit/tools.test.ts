import { createHash, createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAINTENANCE_NOTE,
  maintenanceMigrations,
  migrationDifference,
  scramVerifier,
  shippedMigrations,
} from "../../scripts/tools";

describe("the tools image's commands (scripts/tools.ts)", () => {
  it("lists the migrations the image carries, oldest first", async () => {
    const shipped = await shippedMigrations();
    expect(shipped.length).toBeGreaterThan(10);
    expect(shipped).toEqual([...shipped].sort());
    expect(shipped).not.toContain("migration_lock.toml");
    for (const name of shipped) expect(name).toMatch(/^\d{14}_[a-z0-9_]+$/);
  });

  it("finds the migrations with a maintenance note", async () => {
    const folder = await mkdtemp(join(tmpdir(), "diviyata-migrations-"));
    try {
      for (const name of ["20260101000000_add", "20260102000000_rename"]) {
        await mkdir(join(folder, name));
        await writeFile(join(folder, name, "migration.sql"), "SELECT 1;\n");
      }
      await writeFile(join(folder, "20260102000000_rename", MAINTENANCE_NOTE), "# Renames a column\n");
      await writeFile(join(folder, "migration_lock.toml"), 'provider = "postgresql"\n');

      expect(await shippedMigrations(folder)).toEqual(["20260101000000_add", "20260102000000_rename"]);
      expect(await maintenanceMigrations(folder)).toEqual(["20260102000000_rename"]);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it("has a reason in every maintenance note of this repository's migrations", async () => {
    for (const name of await maintenanceMigrations()) {
      const note = await readFile(join("prisma", "migrations", name, MAINTENANCE_NOTE), "utf8");
      expect(note.trim().length, name).toBeGreaterThan(20);
    }
  });

  it("tells pending migrations from ones the image doesn't know", () => {
    expect(migrationDifference(["1_a", "2_b", "3_c"], ["1_a"])).toEqual({ pending: ["2_b", "3_c"], unknown: [] });
    expect(migrationDifference(["1_a"], ["1_a", "2_b"])).toEqual({ pending: [], unknown: ["2_b"] });
    expect(migrationDifference(["1_a"], [])).toEqual({ pending: ["1_a"], unknown: [] });
  });

  it("stores a password as a SCRAM-SHA-256 verifier that checks out against RFC 7677's example", () => {
    const salt = Buffer.from("W22ZaJ0SNY7soEsUEjb6gQ==", "base64");
    const verifier = scramVerifier("pencil", salt);
    const match = /^SCRAM-SHA-256\$4096:([^$]+)\$([^:]+):(.+)$/.exec(verifier);
    expect(match?.[1]).toBe("W22ZaJ0SNY7soEsUEjb6gQ==");
    const storedKey = Buffer.from(match?.[2] ?? "", "base64");
    const serverKey = Buffer.from(match?.[3] ?? "", "base64");

    // The RFC's exchange: the server's signature must match, and the client's proof must give back the stored key.
    const authMessage =
      "n=user,r=rOprNGfwEbeRWgbNEkqO,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=W22ZaJ0SNY7soEsUEjb6gQ==,i=4096," +
      "c=biws,r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0";
    expect(createHmac("sha256", serverKey).update(authMessage).digest("base64")).toBe(
      "6rriTRBi23WpRR/wtup+mMhUZUn/dB5nLTJRsjl95G4=",
    );
    const proof = Buffer.from("dHzbZapWIk4jUhN+Ute9ytag9zjfMHgsqmmiz7AndVQ=", "base64");
    const clientSignature = createHmac("sha256", storedKey).update(authMessage).digest();
    const clientKey = Buffer.from(proof.map((byte, i) => byte ^ (clientSignature[i] ?? 0)));
    expect(createHash("sha256").update(clientKey).digest().equals(storedKey)).toBe(true);
  });

  it("gives each verifier its own salt", () => {
    expect(scramVerifier("same-password")).not.toBe(scramVerifier("same-password"));
  });
});
