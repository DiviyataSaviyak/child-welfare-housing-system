import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const THIS_ONE = "20261106090000_offices_and_designations";

const client = new pg.Client({ connectionString: inject("testDatabaseUrl") });
const schema = `offices_${Date.now()}_${randomBytes(3).toString("hex")}`;

const run = (name: string) => client.query(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));

const account = (id: string, role: string, designation: string | null, dsOfficeId: number | null) =>
  client.query(
    `INSERT INTO "app_user" ("id", "name", "email", "username", "role", "designation", "ds_office_id", "updated_at")
     VALUES ($1, 'පරීක්ෂණ', $2, $1, $3, $4, $5, now())`,
    [id, `${id}@no-email.invalid`, role, designation, dsOfficeId],
  );

const after = async (id: string) =>
  (
    await client.query(
      `SELECT "username", "role", "designation", "ds_office_id", "district_id", "province_id"
       FROM "app_user" WHERE "id" = $1`,
      [id],
    )
  ).rows[0];

/** The accounts as version 1 left them, in a schema of this test's own, with this migration run over them. */
beforeAll(async () => {
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  await client.query(`SET search_path TO "${schema}"`);

  const names = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  for (const name of names.filter((n) => n < THIS_ONE)) await run(name);

  const province = await client.query(
    `INSERT INTO "province" ("name_en", "name_si", "name_ta") VALUES ('P', 'ප', 'ப') RETURNING "id"`,
  );
  const district = await client.query(
    `INSERT INTO "district" ("name_en", "name_si", "name_ta", "province_id") VALUES ('D', 'ද', 'த', $1) RETURNING "id"`,
    [province.rows[0].id],
  );
  const office = await client.query(
    `INSERT INTO "ds_office" ("code", "name_en", "name_si", "name_ta", "district_id", "updated_at")
     VALUES ('TST', 'O', 'ක', 'க', $1, now()) RETURNING "id"`,
    [district.rows[0].id],
  );

  await account("old-ds", "DS_OFFICER", "සංවර්ධන නිලධාරී", office.rows[0].id);
  await account("old-ds-no-title", "DS_OFFICER", null, office.rows[0].id);
  await account("old-ho", "HO_OFFICER", "සහකාර ලේකම්", null);
  await account("old-admin", "ADMIN", "පරිපාලන නිලධාරී", null);
  await client.query(
    `INSERT INTO "account" ("id", "account_id", "provider_id", "user_id", "password", "updated_at")
     VALUES ('old-ds-credential', 'old-ds', 'credential', 'old-ds', 'a-hash', now())`,
  );

  await run(THIS_ONE);
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

describe("moving version 1's accounts to designations (AC-43)", () => {
  it("makes DS officers Child Rights Promotion Officers, in the same office", async () => {
    for (const id of ["old-ds", "old-ds-no-title"]) {
      expect(await after(id)).toMatchObject({
        username: id,
        role: "DS_OFFICER",
        designation: "DS_CRPO",
        district_id: null,
        province_id: null,
      });
      expect((await after(id)).ds_office_id).not.toBeNull();
    }
  });

  it("makes Head Office officers Programme Officers", async () => {
    expect(await after("old-ho")).toMatchObject({
      username: "old-ho",
      role: "HO_OFFICER",
      designation: "MINISTRY_PROGRAMME_OFFICER",
      ds_office_id: null,
    });
  });

  it("leaves an admin with no designation", async () => {
    expect(await after("old-admin")).toMatchObject({ username: "old-admin", role: "ADMIN", designation: null });
  });

  it("leaves the passwords alone", async () => {
    const { rows } = await client.query(`SELECT "password" FROM "account" WHERE "user_id" = 'old-ds'`);
    expect(rows).toEqual([{ password: "a-hash" }]);
  });
});
