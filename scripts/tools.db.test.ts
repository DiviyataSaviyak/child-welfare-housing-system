import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { appliedMigrations, applyGrants, shippedMigrations } from "./tools";

// Roles belong to the whole PostgreSQL server, so the test makes one of its own, never diviyata_app.
const suffix = randomBytes(3).toString("hex");
const ROLE = `tools_test_app_${suffix}`;
const EMPTY_SCHEMA = `tools_test_empty_${suffix}`;
const FIRST_PASSWORD = `first-${randomBytes(16).toString("hex")}`;
const SECOND_PASSWORD = `second-${randomBytes(16).toString("hex")}`;
const schema = inject("testSchema");
const owner = new pg.Client({ connectionString: inject("testDatabaseUrl") });

/** Signs in as the test role, or fails as the server refuses. */
async function signInAs(password: string): Promise<string> {
  const url = new URL(inject("testDatabaseUrl"));
  url.username = ROLE;
  url.password = password;
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return (await client.query<{ user: string }>("SELECT current_user AS user")).rows[0]?.user ?? "";
  } finally {
    await client.end();
  }
}

const may = async (table: string, privilege: string) =>
  (
    await owner.query<{ may: boolean }>("SELECT has_table_privilege($1, $2, $3) AS may", [
      ROLE,
      `${owner.escapeIdentifier(schema)}.${table}`,
      privilege,
    ])
  ).rows[0]?.may;

beforeAll(() => owner.connect());

afterAll(async () => {
  await owner.query(`DROP SCHEMA IF EXISTS ${owner.escapeIdentifier(EMPTY_SCHEMA)}`);
  const role = owner.escapeIdentifier(ROLE);
  if ((await owner.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [ROLE])).rowCount) {
    await owner.query(`DROP OWNED BY ${role}`);
    await owner.query(`DROP ROLE ${role}`);
  }
  await owner.end();
});

describe("tools grants: the app's own database account (SEC-3)", () => {
  it("makes the account, which signs in with the password and may only read and write rows", async () => {
    await applyGrants(owner, { role: ROLE, schema, password: FIRST_PASSWORD });
    expect(await signInAs(FIRST_PASSWORD)).toBe(ROLE);

    const { rows } = await owner.query("SELECT rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1", [
      ROLE,
    ]);
    expect(rows[0]).toEqual({ rolsuper: false, rolcreatedb: false, rolcreaterole: false });

    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) expect(await may('"case"', privilege)).toBe(true);
    expect(await may('"case"', "TRUNCATE")).toBe(false);
    // Audit rows are only added (HIS-3), and the migrations' record is the owner's alone.
    expect(await may("audit_log", "INSERT")).toBe(true);
    for (const privilege of ["UPDATE", "DELETE", "TRUNCATE"]) expect(await may("audit_log", privilege)).toBe(false);
    expect(await may("_prisma_migrations", "SELECT")).toBe(false);

    const { rows: schemaRights } = await owner.query<{ create: boolean }>(
      "SELECT has_schema_privilege($1, $2, 'CREATE') AS create",
      [ROLE, schema],
    );
    expect(schemaRights[0]?.create).toBe(false);
  });

  it("runs again with a new password, which then replaces the old one", async () => {
    await applyGrants(owner, { role: ROLE, schema, password: SECOND_PASSWORD });
    expect(await signInAs(SECOND_PASSWORD)).toBe(ROLE);
    await expect(signInAs(FIRST_PASSWORD)).rejects.toThrow(/password authentication failed/);
  });
});

describe("tools pending-migrations", () => {
  it("finds every migration the image carries run on a migrated database", async () => {
    expect(await appliedMigrations(owner, schema)).toEqual(await shippedMigrations());
  });

  it("finds none run before the first deploy", async () => {
    await owner.query(`CREATE SCHEMA ${owner.escapeIdentifier(EMPTY_SCHEMA)}`);
    expect(await appliedMigrations(owner, EMPTY_SCHEMA)).toEqual([]);
  });
});
