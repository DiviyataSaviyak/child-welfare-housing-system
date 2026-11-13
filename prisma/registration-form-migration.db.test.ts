import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

/**
 * Change 0007's two migrations (the design's "Migration"), run over cases entered before them: the new
 * columns stay empty on those, every check holds on them, and the checks refuse what they should.
 */
const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const VALUES = "20261112090000_registration_form_values";
const COLUMNS = "20261112090100_registration_form";

const client = new pg.Client({ connectionString: inject("testDatabaseUrl") });
const schema = `registration_${Date.now()}_${randomBytes(3).toString("hex")}`;

const run = (name: string) => client.query(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));
const sql = (text: string, values: unknown[] = []) => client.query(text, values);

/** The statement fails on the named check. */
async function refused(text: string, values: unknown[], check: string) {
  await expect(sql(text, values)).rejects.toMatchObject({ code: "23514", constraint: check });
}

const oldCase = (id: string, category: string, kind = "NEW_HOUSE") =>
  sql(
    `INSERT INTO "case" ("id", "application_number", "application_key", "ds_office_id", "build_ds_office_id",
       "category", "kind", "status", "name", "created_by_id", "updated_at")
     VALUES ($1, $1, upper($1), 1, 1, $2, $3, 'IN_PROGRESS', 'පරීක්ෂණ', 'officer', now())`,
    [id, category, kind],
  );

const setCase = (id: string, set: string, values: unknown[] = []) =>
  sql(`UPDATE "case" SET ${set} WHERE "id" = $1`, [id, ...values]);

const centre = (values: Record<string, unknown>) => {
  const row = { case_id: "care-leaver", position: 1, name: "මධ්‍යස්ථානය", province_id: 1, ...values };
  const names = Object.keys(row);
  return sql(
    `INSERT INTO "care_centre" (${names.map((n) => `"${n}"`).join(", ")})
     VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(row),
  );
};

beforeAll(async () => {
  await client.connect();
  await sql(`CREATE SCHEMA "${schema}"`);
  await sql(`SET search_path TO "${schema}"`);

  const names = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  for (const name of names.filter((n) => n < VALUES)) await run(name);

  await sql(`INSERT INTO "province" ("id", "name_si", "name_ta", "name_en") VALUES (1, 'බස්නාහිර', 'மேல்', 'Western')`);
  await sql(
    `INSERT INTO "district" ("id", "name_si", "name_ta", "name_en", "province_id") VALUES (1, 'කොළඹ', 'கொழும்பு', 'Colombo', 1)`,
  );
  await sql(
    `INSERT INTO "ds_office" ("id", "code", "name_si", "name_ta", "name_en", "district_id", "updated_at")
     VALUES (1, 'KDW', 'කඩුවෙල', 'கடுவெல', 'Kaduwela', 1, now())`,
  );
  await sql(
    `INSERT INTO "app_user" ("id", "name", "email", "username", "role", "designation", "ds_office_id", "updated_at")
     VALUES ('officer', 'පරීක්ෂණ', 'officer@no-email.invalid', 'officer', 'DS_OFFICER', 'DS_CRPO', 1, now())`,
  );
  await sql(
    `INSERT INTO "stage_definition" ("kind", "sort_order", "name_si", "name_ta", "name_en", "updated_at")
     VALUES ('NEW_HOUSE', 1, 'අත්තිවාරම', 'அத்திவாரம்', 'Foundation', now()),
            ('RENOVATION', 1, 'වහලය', 'கூரை', 'Roof', now())`,
  );
  await oldCase("care-leaver", "CARE_LEAVER");
  await oldCase("child", "CHILD_AT_RISK", "RENOVATION");
  for (let n = 1; n <= 4; n += 1) {
    await sql(
      `INSERT INTO "installment" ("id", "case_id", "number", "amount", "status", "updated_at")
       VALUES ($1, 'care-leaver', $2, 500000, 'NOT_STARTED', now())`,
      [`care-leaver-${n}`, n],
    );
  }

  await run(VALUES);
  await run(COLUMNS);
});

afterAll(async () => {
  await sql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

describe("the registration form's migrations (change 0007)", () => {
  it("adds the three land kinds after the house kinds", async () => {
    const { rows } = await sql(
      `SELECT e."enumlabel" FROM pg_enum e JOIN pg_type t ON t."oid" = e."enumtypid"
       JOIN pg_namespace n ON n."oid" = t."typnamespace"
       WHERE t."typname" = 'Kind' AND n."nspname" = $1 ORDER BY e."enumsortorder"`,
      [schema],
    );
    expect(rows.map((r) => r.enumlabel)).toEqual([
      "NEW_HOUSE",
      "RENOVATION",
      "LAND_ONLY",
      "LAND_AND_BUILD",
      "LAND_WITH_HOUSE",
    ]);
  });

  it("leaves every new column empty on the cases entered before it", async () => {
    const { rows } = await sql(
      `SELECT "date_of_birth", "care_group", "marital_status", "relationship", "relationship_other",
         "family_members", "disabled_children", "aid", "aid_other", "land_gn_division"
       FROM "case" ORDER BY "id"`,
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(Object.values(row).every((value) => value === null)).toBe(true);
    expect((await sql(`SELECT 1 FROM "care_centre"`)).rowCount).toBe(0);
  });

  it("takes each category's own details (CASE-14, CASE-15, CASE-16)", async () => {
    await setCase(
      "care-leaver",
      `"date_of_birth" = '2008-04-01', "care_group" = 'IN_CARE', "marital_status" = 'UNMARRIED',
       "family_members" = 4, "disabled_children" = false, "aid" = '{SAMURDHI,OTHER}', "aid_other" = 'ආධාරය',
       "land_gn_division" = 'කඩුවෙල නැගෙනහිර', "kind" = 'LAND_AND_BUILD'`,
    );
    await setCase("child", `"relationship" = 'OTHER', "relationship_other" = 'ආච්චි', "aid" = '{}'`);
    const { rows } = await sql(`SELECT "aid"::text[] AS aid FROM "case" ORDER BY "id"`);
    expect(rows.map((r) => r.aid)).toEqual([["SAMURDHI", "OTHER"], []]);
  });

  it("refuses a care leaver's details on a child at risk, and a child's on a care leaver", async () => {
    await refused(`UPDATE "case" SET "care_group" = 'LEFT_CARE' WHERE "id" = 'child'`, [], "case_care_leaver_details");
    await refused(
      `UPDATE "case" SET "marital_status" = 'MARRIED' WHERE "id" = 'child'`,
      [],
      "case_care_leaver_details",
    );
    await refused(
      `UPDATE "case" SET "relationship" = 'MOTHER' WHERE "id" = 'care-leaver'`,
      [],
      "case_child_at_risk_details",
    );
    // Switching the category without dropping the other category's details is refused too.
    await refused(
      `UPDATE "case" SET "category" = 'CARE_LEAVER' WHERE "id" = 'child'`,
      [],
      "case_child_at_risk_details",
    );
  });

  it("keeps the typed relationship and aid to their 'other' choice, and the family to 1-30", async () => {
    await refused(
      `UPDATE "case" SET "relationship" = 'MOTHER' WHERE "id" = 'child'`,
      [],
      "case_relationship_other_only_for_other",
    );
    await refused(
      `UPDATE "case" SET "aid" = '{SAMURDHI}' WHERE "id" = 'care-leaver'`,
      [],
      "case_aid_other_only_for_other",
    );
    await refused(
      `UPDATE "case" SET "family_members" = 0 WHERE "id" = 'care-leaver'`,
      [],
      "case_family_members_1_to_30",
    );
    await refused(
      `UPDATE "case" SET "family_members" = 31 WHERE "id" = 'care-leaver'`,
      [],
      "case_family_members_1_to_30",
    );
    await setCase("care-leaver", `"family_members" = 30`);
  });

  it("holds a care leaver's centres with dates as precise as they are known (CASE-14)", async () => {
    await centre({ position: 1, from_year: 2012, until_year: 2015, until_month: 6 });
    await centre({ position: 2, from_year: 2015, from_month: 7, from_day: 1 });
    await centre({ position: 3 });
    // One row per place in the order.
    await expect(centre({ position: 1 })).rejects.toMatchObject({ code: "23505" });
  });

  it("refuses a centre out of its rules", async () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ position: 11 }, "care_centre_position_1_to_10"],
      [{ position: 4, name: "අ" }, "care_centre_name_2_to_150"],
      [{ position: 4, from_month: 3 }, "care_centre_from_month_needs_year"],
      [{ position: 4, from_year: 2015, from_day: 3 }, "care_centre_from_day_needs_month"],
      [{ position: 4, from_year: 2015, from_month: 13 }, "care_centre_from_month_1_to_12"],
      [{ position: 4, from_year: 2015, from_month: 2, from_day: 32 }, "care_centre_from_day_1_to_31"],
      [{ position: 4, until_month: 3 }, "care_centre_until_month_needs_year"],
      [{ position: 4, until_year: 2015, until_day: 3 }, "care_centre_until_day_needs_month"],
      [{ position: 4, until_year: 2015, until_month: 0 }, "care_centre_until_month_1_to_12"],
      [{ position: 4, until_year: 2015, until_month: 2, until_day: 0 }, "care_centre_until_day_1_to_31"],
    ];
    for (const [values, check] of bad) {
      await expect(centre(values), check).rejects.toMatchObject({ code: "23514", constraint: check });
    }
  });

  it("takes installments of other amounts, from Rs. 1 to Rs. 2,000,000 (INS-7)", async () => {
    await sql(`UPDATE "installment" SET "amount" = 850000 WHERE "id" = 'care-leaver-1'`);
    await sql(`UPDATE "installment" SET "amount" = 1 WHERE "id" = 'care-leaver-2'`);
    await sql(`UPDATE "installment" SET "amount" = 2000000 WHERE "id" = 'care-leaver-3'`);
    for (const amount of [0, 2000001]) {
      await refused(
        `UPDATE "installment" SET "amount" = $1 WHERE "id" = 'care-leaver-4'`,
        [amount],
        "installment_amount_1_to_2000000",
      );
    }
  });

  it("keeps stage lists for the house kinds only (LST-4)", async () => {
    await refused(
      `INSERT INTO "stage_definition" ("kind", "sort_order", "name_si", "name_ta", "name_en", "updated_at")
       VALUES ('LAND_AND_BUILD', 1, 'ඉඩම', 'காணி', 'Land', now())`,
      [],
      "stage_definition_house_kinds",
    );
  });

  it("deletes a case's centres with the case (CASE-8)", async () => {
    await sql(`DELETE FROM "installment" WHERE "case_id" = 'care-leaver'`);
    await sql(`DELETE FROM "case" WHERE "id" = 'care-leaver'`);
    expect((await sql(`SELECT 1 FROM "care_centre"`)).rowCount).toBe(0);
  });
});
