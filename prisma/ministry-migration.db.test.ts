import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const THIS_ONE = "20261109090000_ministry_officer";

const client = new pg.Client({ connectionString: inject("testDatabaseUrl") });
const schema = `ministry_${Date.now()}_${randomBytes(3).toString("hex")}`;

const run = (name: string) => client.query(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));

const account = (id: string, role: string, designation: string | null) =>
  client.query(
    `INSERT INTO "app_user" ("id", "name", "email", "username", "role", "designation", "updated_at")
     VALUES ($1, 'පරීක්ෂණ', $2, $1, $3, $4, now())`,
    [id, `${id}@no-email.invalid`, role, designation],
  );

const after = async (id: string) =>
  (await client.query(`SELECT "username", "role", "designation" FROM "app_user" WHERE "id" = $1`, [id])).rows[0];

/** Change 0005's Head Office accounts, in a schema of this test's own, with this migration run over them. */
beforeAll(async () => {
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);

  const names = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  for (const name of names.filter((n) => n < THIS_ONE)) await run(name);

  await account("old-programme", "HO_OFFICER", "MINISTRY_PROGRAMME_OFFICER");
  await account("old-accountant", "HO_OFFICER", "MINISTRY_CHIEF_ACCOUNTANT");
  await account("old-secretary", "VIEWER", "MINISTRY_SECRETARY");
  await account("old-admin", "ADMIN", null);
  await client.query(
    `INSERT INTO "account" ("id", "account_id", "provider_id", "user_id", "password", "updated_at")
     VALUES ('old-programme-credential', 'old-programme', 'credential', 'old-programme', 'a-hash', now())`,
  );

  await run(THIS_ONE);
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

describe("Head Office officers become Ministry officers (UI-10, AC-59)", () => {
  it("moves both Ministry designations to MINISTRY_OFFICER, keeping usernames and designations", async () => {
    expect(await after("old-programme")).toEqual({
      username: "old-programme",
      role: "MINISTRY_OFFICER",
      designation: "MINISTRY_PROGRAMME_OFFICER",
    });
    expect(await after("old-accountant")).toEqual({
      username: "old-accountant",
      role: "MINISTRY_OFFICER",
      designation: "MINISTRY_CHIEF_ACCOUNTANT",
    });
  });

  it("leaves the other roles and the passwords alone", async () => {
    expect(await after("old-secretary")).toMatchObject({ role: "VIEWER", designation: "MINISTRY_SECRETARY" });
    expect(await after("old-admin")).toMatchObject({ role: "ADMIN", designation: null });
    const { rows } = await client.query(`SELECT "password" FROM "account" WHERE "user_id" = 'old-programme'`);
    expect(rows).toEqual([{ password: "a-hash" }]);
  });

  it("refuses the old role from now on", async () => {
    // Both checks refuse it; PostgreSQL reports whichever it tries first.
    await expect(account("new-ho", "HO_OFFICER", "MINISTRY_PROGRAMME_OFFICER")).rejects.toThrow(
      /app_user_(role|designation)_check/,
    );
  });

  it("still ties the role to the designation", async () => {
    await expect(account("wrong-pair", "MINISTRY_OFFICER", "DS_CRPO")).rejects.toThrow(/app_user_designation_check/);
  });
});
