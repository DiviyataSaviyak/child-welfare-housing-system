import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

/**
 * Change 0009 task 7's migration, run over a database with a District release that holds cases of two
 * Ministry letters, one that holds a single letter's, and a return from the mixed one (REL-12).
 */
const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const MIGRATION = "20261118120000_one_letter_per_ds_release";

const client = new pg.Client({ connectionString: inject("testDatabaseUrl") });
const schema = `one_letter_${Date.now()}_${randomBytes(3).toString("hex")}`;

const run = (name: string) => client.query(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));
const sql = (text: string, values: unknown[] = []) => client.query(text, values);

const insert = (table: string, row: Record<string, unknown>) => {
  const names = Object.keys(row);
  return sql(
    `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")})
     VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(row),
  );
};

async function addCase(id: string, status = "ALLOCATION_RECEIVED") {
  await sql(
    `INSERT INTO "case" ("id", "application_number", "application_key", "ds_office_id", "build_ds_office_id",
       "category", "kind", "status", "name", "created_by_id", "updated_at")
     VALUES ($1, $1, upper($1), 1, 1, 'CARE_LEAVER', 'NEW_HOUSE', $2, 'පරීක්ෂණ', 'officer', now())`,
    [id, status],
  );
}

const letter = (id: string, number: string, day: string) =>
  insert("release_letter", {
    id,
    district_id: 1,
    letter_number: number,
    letter_date: day,
    valid_until: "2026-12-31",
    by_id: "officer",
  });

const dsRelease = (id: string, reference: string) =>
  insert("ds_release", {
    id,
    district_id: 1,
    ds_office_id: 1,
    reference_number: reference,
    released_on: "2026-11-05",
    note: "සටහන",
    by_id: "officer",
    at: "2026-11-05T04:00:00Z",
  });

async function allocation(caseId: string, letterId: string, dsReleaseId: string) {
  await addCase(caseId);
  await insert("release", {
    id: `${caseId}-release`,
    case_id: caseId,
    letter_id: letterId,
    released_on: "2026-11-01",
    ds_release_id: dsReleaseId,
    ds_released_on: "2026-11-05",
    amount: 2000000,
    by_id: "officer",
  });
}

beforeAll(async () => {
  await client.connect();
  await sql(`CREATE SCHEMA "${schema}"`);
  await sql(`SET search_path TO "${schema}"`);

  const names = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  for (const name of names.filter((n) => n < MIGRATION)) await run(name);

  await sql(`INSERT INTO "province" ("id", "name_si", "name_ta", "name_en") VALUES (1, 'දකුණ', 'தெற்கு', 'Southern')`);
  await sql(
    `INSERT INTO "district" ("id", "name_si", "name_ta", "name_en", "province_id") VALUES (1, 'මාතර', 'மாத்தறை', 'Matara', 1)`,
  );
  await sql(
    `INSERT INTO "ds_office" ("id", "code", "name_si", "name_ta", "name_en", "district_id", "updated_at")
     VALUES (1, 'WLG', 'වැලිගම', 'வெலிகம', 'Weligama', 1, now())`,
  );
  await sql(
    `INSERT INTO "app_user" ("id", "name", "email", "username", "role", "designation", "ds_office_id", "updated_at")
     VALUES ('officer', 'පරීක්ෂණ', 'officer@no-email.invalid', 'officer', 'DS_OFFICER', 'DS_CRPO', 1, now())`,
  );

  // Letter 3 (older) and letter 4, both released together to Weligama in "mixed"; letter 5 alone in "single".
  await letter("letter-3", "L/3", "2026-11-01");
  await letter("letter-4", "L/4", "2026-11-02");
  await letter("letter-5", "L/5", "2026-11-03");
  await dsRelease("mixed", "DS/MIX");
  await dsRelease("single", "DS/ONE");
  await allocation("three-a", "letter-3", "mixed");
  await allocation("three-b", "letter-3", "mixed");
  await allocation("four-a", "letter-4", "mixed");
  await allocation("five-a", "letter-5", "single");
  await insert("file", {
    id: "scan",
    kind: "LETTER",
    ds_release_id: "mixed",
    stored_name: "scan-stored",
    original_name: "scan.pdf",
    mime_type: "application/pdf",
    size: 10,
    sha256: "a".repeat(64),
    uploaded_by_id: "officer",
  });

  // A letter 4 beneficiary replaced and their allocation returned to the District from "mixed" (AMD-11).
  await addCase("four-old", "REPLACED");
  await addCase("four-new", "ALLOCATED_TO_DISTRICT");
  await insert("amendment", {
    id: "amendment",
    case_id: "four-old",
    ds_office_id: 1,
    application_key: "AMENDMENT",
    details: "{}",
    reason: "ඉඩමේ ගැටලුවක් ඇත",
    submitted_by_id: "officer",
  });
  await insert("allocation_return", {
    id: "return",
    amendment_id: "amendment",
    case_id: "four-old",
    new_case_id: "four-new",
    letter_id: "letter-4",
    ds_release_id: "mixed",
    district_id: 1,
    ds_office_id: 1,
    returned_to: "DISTRICT",
    amount: 2000000,
    returned_on: "2026-11-10",
    reference_number: "RET/1",
    by_id: "officer",
  });

  await run(MIGRATION);
});

afterAll(async () => {
  await sql(`DROP SCHEMA "${schema}" CASCADE`);
  await client.end();
});

const releaseOf = async (caseId: string) =>
  (await sql(`SELECT "ds_release_id" FROM "release" WHERE "case_id" = $1`, [caseId])).rows[0].ds_release_id as string;

describe("one letter for each District release (REL-12)", () => {
  it("keeps the release for its oldest letter, with its scan, and makes one for the other letter", async () => {
    const { rows } = await sql(
      `SELECT "id", "letter_id", "reference_number", "released_on"::text AS "on", "note", "by_id", "at"
       FROM "ds_release" ORDER BY "letter_id"`,
    );
    expect(rows.map((r) => [r.letter_id, r.reference_number])).toEqual([
      ["letter-3", "DS/MIX"],
      ["letter-4", "DS/MIX"],
      ["letter-5", "DS/ONE"],
    ]);
    const [three, four] = rows;
    expect(three.id).toBe("mixed");
    expect(four.id).not.toBe("mixed");
    expect(four).toMatchObject({ on: "2026-11-05", note: "සටහන", by_id: "officer", at: three.at });

    expect(await releaseOf("three-a")).toBe("mixed");
    expect(await releaseOf("three-b")).toBe("mixed");
    expect(await releaseOf("four-a")).toBe(four.id);
    expect(await releaseOf("five-a")).toBe("single");
    expect((await sql(`SELECT "ds_release_id" FROM "file" WHERE "id" = 'scan'`)).rows[0].ds_release_id).toBe("mixed");
    expect((await sql(`SELECT "ds_release_id" FROM "allocation_return" WHERE "id" = 'return'`)).rows[0]).toEqual({
      ds_release_id: four.id,
    });
  });

  it("tells the history of each case of the split release, and of no other", async () => {
    const { rows } = await sql(
      `SELECT "case_id", "entity_id", "after" FROM "audit_log" WHERE "action" = 'ds_release_split' ORDER BY "case_id"`,
    );
    expect(rows.map((r) => r.case_id)).toEqual(["four-a", "three-a", "three-b"]);
    expect(rows[0].after).toMatchObject({ fromDsReleaseId: "mixed", letterNumber: "L/4", referenceNumber: "DS/MIX" });
    expect(rows[1].after).toMatchObject({ dsReleaseId: "mixed", letterNumber: "L/3" });
  });

  it("requires the letter from now on", async () => {
    await expect(dsRelease("no-letter", "DS/NONE")).rejects.toMatchObject({ code: "23502" });
  });
});
