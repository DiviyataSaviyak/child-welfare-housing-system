import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const THIS_ONE = "20261109120000_allocation_flow";

const client = new pg.Client({ connectionString: inject("testDatabaseUrl") });
const schema = `allocation_${Date.now()}_${randomBytes(3).toString("hex")}`;

const run = (name: string) => client.query(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));
const sql = (text: string, values: unknown[] = []) => client.query(text, values);

type OldCase = {
  id: string;
  status: string;
  number?: string | null;
  office?: number;
  before?: string | null;
  anotherName?: boolean;
};

const oldCase = ({ id, status, number = `KDW-2026-${id}`, office = 1, before = null, anotherName = false }: OldCase) =>
  sql(
    `INSERT INTO "case" ("id", "case_number", "ds_office_id", "category", "kind", "status", "name", "created_by_id",
       "updated_at", "status_before_stop", "another_name_requested")
     VALUES ($1, $2, $3, 'CARE_LEAVER', 'NEW_HOUSE', $4, 'පරීක්ෂණ', 'officer', now(), $5, $6)`,
    [id, number, office, status, before, anotherName],
  );

/** Version 1's letter for some cases: a release each and their four installments, `paid` of them released. */
async function letter(id: string, district: number, day: string, cases: { id: string; paid: number }[]) {
  await sql(
    `INSERT INTO "release_letter" ("id", "district_id", "letter_number", "letter_date", "valid_until", "by_id", "at")
     VALUES ($1, $2, $3, $4, '2026-12-31', 'ministry', '2026-03-01T04:00:00Z')`,
    [id, district, `MWCA/${id}`, day],
  );
  for (const c of cases) {
    await sql(
      `INSERT INTO "release" ("id", "case_id", "letter_id", "released_on", "amount", "by_id")
       VALUES ($1, $1, $2, $3, 2000000, 'ministry')`,
      [c.id, id, day],
    );
    for (let n = 1; n <= 4; n += 1) {
      await sql(
        `INSERT INTO "installment" ("id", "case_id", "number", "amount", "status", "released_on", "updated_at")
         VALUES ($1, $2, $3, 500000, $4, $5, now())`,
        [`${c.id}-${n}`, c.id, n, n <= c.paid ? "RELEASED" : "NOT_STARTED", n <= c.paid ? day : null],
      );
    }
  }
}

const after = async (id: string) =>
  (
    await sql(
      `SELECT "status"::text, "application_number", "application_key", "ds_office_id", "build_ds_office_id",
         "status_before_stop", "another_name_requested"
       FROM "case" WHERE "id" = $1`,
      [id],
    )
  ).rows[0];

/** Every version 1 status, in a schema of this test's own, with this migration run over them. */
beforeAll(async () => {
  await client.connect();
  await sql(`CREATE SCHEMA "${schema}"`);
  await sql(`SET search_path TO "${schema}"`);

  const names = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
  for (const name of names.filter((n) => n < THIS_ONE)) await run(name);

  await sql(`INSERT INTO "province" ("id", "name_si", "name_ta", "name_en") VALUES (1, 'බස්නාහිර', 'மேல்', 'Western')`);
  await sql(
    `INSERT INTO "district" ("id", "name_si", "name_ta", "name_en", "province_id")
     VALUES (1, 'කොළඹ', 'கொழும்பு', 'Colombo', 1), (2, 'ගම්පහ', 'கம்பஹா', 'Gampaha', 1)`,
  );
  await sql(
    `INSERT INTO "ds_office" ("id", "code", "name_si", "name_ta", "name_en", "district_id", "updated_at")
     VALUES (1, 'KDW', 'කඩුවෙල', 'கடுவெல', 'Kaduwela', 1, now()),
            (2, 'HMG', 'හෝමාගම', 'ஹோமாகம', 'Homagama', 1, now()),
            (3, 'GMP', 'ගම්පහ', 'கம்பஹா', 'Gampaha', 2, now())`,
  );
  await sql(
    `INSERT INTO "app_user" ("id", "name", "email", "username", "role", "designation", "ds_office_id", "updated_at")
     VALUES ('officer', 'පරීක්ෂණ', 'officer@no-email.invalid', 'officer', 'DS_OFFICER', 'DS_CRPO', 1, now()),
            ('ministry', 'පරීක්ෂණ', 'ministry@no-email.invalid', 'ministry', 'MINISTRY_OFFICER', 'MINISTRY_PROGRAMME_OFFICER', NULL, now())`,
  );

  await oldCase({ id: "draft", status: "DRAFT", number: null });
  await sql(
    `INSERT INTO "file" ("id", "kind", "case_id", "stored_name", "original_name", "mime_type", "size", "sha256", "uploaded_by_id")
     VALUES ('draft-file', 'DOCUMENT', 'draft', 'aa/draft-file', 'x.pdf', 'application/pdf', 1, repeat('0', 64), 'officer')`,
  );
  await oldCase({ id: "submitted", status: "SUBMITTED", number: "kdw / 147" });
  await oldCase({ id: "returned", status: "RETURNED" });
  await oldCase({ id: "verified", status: "VERIFIED" });
  await oldCase({ id: "rejected", status: "REJECTED", anotherName: true });
  await oldCase({ id: "stopped-verified", status: "STOPPED", before: "VERIFIED" });
  await oldCase({ id: "released", status: "IN_PROGRESS" });
  await oldCase({ id: "paying", status: "IN_PROGRESS", office: 2 });
  await oldCase({ id: "stopped-paying", status: "STOPPED", before: "IN_PROGRESS", anotherName: true });
  await oldCase({ id: "completed", status: "COMPLETED", office: 2 });
  await oldCase({ id: "gampaha", status: "IN_PROGRESS", office: 3 });
  await letter("letter-a", 1, "2026-03-01", [
    { id: "released", paid: 0 },
    { id: "paying", paid: 2 },
    { id: "stopped-paying", paid: 1 },
    { id: "completed", paid: 4 },
  ]);
  await letter("letter-b", 2, "2026-04-01", [{ id: "gampaha", paid: 0 }]);
  await sql(`UPDATE "case" SET "completed_at" = now() WHERE "id" = 'completed'`);

  await run(THIS_ONE);
});

afterAll(async () => {
  await sql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

describe("the allocation flow's migration (AC-59)", () => {
  it("deletes drafts with their documents, and logs each deletion by the system", async () => {
    expect(await after("draft")).toBeUndefined();
    expect((await sql(`SELECT 1 FROM "file" WHERE "id" = 'draft-file'`)).rowCount).toBe(0);
    const { rows } = await sql(`SELECT "actor_id", "after" FROM "audit_log" WHERE "action" = 'case_draft_deleted'`);
    expect(rows).toEqual([{ actor_id: null, after: { dsOfficeId: 1, reason: "migration_allocation_flow" } }]);
  });

  it("puts every case nobody has paid for yet in awaiting fund allocation", async () => {
    for (const id of ["submitted", "returned", "verified", "rejected", "stopped-verified"]) {
      expect(await after(id), id).toMatchObject({ status: "AWAITING_ALLOCATION" });
    }
  });

  it("makes a released case allocation received until installment 1 is paid, and keeps the rest", async () => {
    expect(await after("released")).toMatchObject({ status: "ALLOCATION_RECEIVED" });
    expect(await after("gampaha")).toMatchObject({ status: "ALLOCATION_RECEIVED" });
    expect(await after("paying")).toMatchObject({ status: "IN_PROGRESS" });
    expect(await after("stopped-paying")).toMatchObject({ status: "IN_PROGRESS" });
    expect(await after("completed")).toMatchObject({ status: "COMPLETED" });
  });

  it("leaves nothing stopped, rejected or asking for another name", async () => {
    const { rows } = await sql(`SELECT "status"::text AS status, count(*)::int AS n FROM "case" GROUP BY 1 ORDER BY 1`);
    expect(rows).toEqual([
      { status: "ALLOCATION_RECEIVED", n: 2 },
      { status: "AWAITING_ALLOCATION", n: 5 },
      { status: "COMPLETED", n: 1 },
      { status: "IN_PROGRESS", n: 2 },
    ]);
    expect(
      (await sql(`SELECT 1 FROM "case" WHERE "status_before_stop" IS NOT NULL OR "another_name_requested"`)).rowCount,
    ).toBe(0);
  });

  it("makes each case number the Application Number, keyed in capitals without spaces (CASE-12)", async () => {
    expect(await after("returned")).toMatchObject({
      application_number: "KDW-2026-returned",
      application_key: "KDW-2026-RETURNED",
    });
    expect(await after("submitted")).toMatchObject({ application_number: "kdw / 147", application_key: "KDW/147" });
  });

  it("refuses the same Application Number twice in one DS office, but not in another", async () => {
    await expect(
      sql(
        `INSERT INTO "case" ("id", "application_number", "application_key", "ds_office_id", "build_ds_office_id",
           "status", "created_by_id", "updated_at")
         VALUES ('again', 'KDW/147', 'KDW/147', 1, 1, 'AWAITING_ALLOCATION', 'officer', now())`,
      ),
    ).rejects.toThrow(/case_ds_office_id_application_key_key/);
    await sql(
      `INSERT INTO "case" ("id", "application_number", "application_key", "ds_office_id", "build_ds_office_id",
         "status", "created_by_id", "updated_at")
       VALUES ('elsewhere', 'KDW/147', 'KDW/147', 2, 2, 'AWAITING_ALLOCATION', 'officer', now())`,
    );
    await sql(`DELETE FROM "case" WHERE "id" = 'elsewhere'`);
  });

  it("builds every case in its DS of residence (CASE-13)", async () => {
    const { rows } = await sql(`SELECT 1 FROM "case" WHERE "build_ds_office_id" <> "ds_office_id"`);
    expect(rows).toEqual([]);
  });

  it("turns each letter into one District release per DS office, with its number, date and author", async () => {
    const { rows } = await sql(
      `SELECT d."district_id", d."ds_office_id", d."reference_number", to_char(d."released_on", 'YYYY-MM-DD') AS day,
         d."by_id", array_agg(r."case_id" ORDER BY r."case_id") AS cases
       FROM "ds_release" d JOIN "release" r ON r."ds_release_id" = d."id"
       GROUP BY d."id" ORDER BY d."ds_office_id"`,
    );
    expect(rows).toEqual([
      {
        district_id: 1,
        ds_office_id: 1,
        reference_number: "MWCA/letter-a",
        day: "2026-03-01",
        by_id: "ministry",
        cases: ["released", "stopped-paying"],
      },
      {
        district_id: 1,
        ds_office_id: 2,
        reference_number: "MWCA/letter-a",
        day: "2026-03-01",
        by_id: "ministry",
        cases: ["completed", "paying"],
      },
      {
        district_id: 2,
        ds_office_id: 3,
        reference_number: "MWCA/letter-b",
        day: "2026-04-01",
        by_id: "ministry",
        cases: ["gampaha"],
      },
    ]);
    const days = await sql(
      `SELECT 1 FROM "release" WHERE "ds_released_on" IS DISTINCT FROM "released_on" OR "ds_release_id" IS NULL`,
    );
    expect(days.rowCount).toBe(0);
  });

  it("keeps a release's District release and its day together", async () => {
    await expect(sql(`UPDATE "release" SET "ds_released_on" = NULL WHERE "case_id" = 'released'`)).rejects.toThrow(
      /release_ds_release_both_or_neither/,
    );
  });

  it("lets a scan belong to a letter or a District release, never both", async () => {
    const id = (await sql(`SELECT "id" FROM "ds_release" LIMIT 1`)).rows[0].id as string;
    await expect(
      sql(
        `INSERT INTO "file" ("id", "kind", "letter_id", "ds_release_id", "stored_name", "original_name", "mime_type",
           "size", "sha256", "uploaded_by_id")
         VALUES ('both', 'LETTER', 'letter-a', $1, 'aa/both', 'x.pdf', 'application/pdf', 1, repeat('0', 64), 'ministry')`,
        [id],
      ),
    ).rejects.toThrow(/file_scan_on_one_release/);
  });
});
