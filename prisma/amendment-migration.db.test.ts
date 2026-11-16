import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

/**
 * Change 0008's two migrations (the design's "Migration"), run over a database with cases and documents
 * entered before them: nothing existing changes, and the amendment's rules hold.
 */
const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const VALUES = "20261116090000_amendment_values";
const TABLE = "20261116090100_amendments";

const client = new pg.Client({ connectionString: inject("testDatabaseUrl") });
const schema = `amendment_${Date.now()}_${randomBytes(3).toString("hex")}`;

const run = (name: string) => client.query(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));
const sql = (text: string, values: unknown[] = []) => client.query(text, values);

/** The statement fails on the named check (23514) or unique index (23505). */
async function refused(text: string, values: unknown[], constraint: string, code = "23514") {
  await expect(sql(text, values), constraint).rejects.toMatchObject({ code, constraint });
}

const addCase = (id: string, status = "AWAITING_ALLOCATION") =>
  sql(
    `INSERT INTO "case" ("id", "application_number", "application_key", "ds_office_id", "build_ds_office_id",
       "category", "kind", "status", "name", "created_by_id", "updated_at")
     VALUES ($1, $1, upper($1), 1, 1, 'CARE_LEAVER', 'NEW_HOUSE', $2, 'පරීක්ෂණ', 'officer', now())`,
    [id, status],
  );

/** An amendment with the given columns over a waiting one's defaults. */
const amendment = (values: Record<string, unknown>) => {
  const row = {
    id: "amendment",
    case_id: "existing",
    ds_office_id: 1,
    application_key: "KDW/9",
    details: JSON.stringify({ name: "නව ප්‍රතිලාභියා" }),
    reason: "ඉඩමේ ගැටලුවක් ඇත",
    submitted_by_id: "officer",
    ...values,
  };
  const names = Object.keys(row);
  return sql(
    `INSERT INTO "amendment" (${names.map((n) => `"${n}"`).join(", ")})
     VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(row),
  );
};

const insertOf = (values: Record<string, unknown>): [string, unknown[]] => {
  const row = {
    id: "bad",
    case_id: "other",
    ds_office_id: 1,
    application_key: "KDW/BAD",
    details: "{}",
    reason: "ඉඩමේ ගැටලුවක් ඇත",
    submitted_by_id: "officer",
    ...values,
  };
  const names = Object.keys(row);
  return [
    `INSERT INTO "amendment" (${names.map((n) => `"${n}"`).join(", ")})
     VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(row),
  ];
};

const file = (id: string, values: Record<string, unknown>) => {
  const row = {
    id,
    kind: "DOCUMENT",
    stored_name: id,
    original_name: "ලේඛනය.pdf",
    mime_type: "application/pdf",
    size: 10,
    sha256: "a".repeat(64),
    uploaded_by_id: "officer",
    ...values,
  };
  const names = Object.keys(row);
  return sql(
    `INSERT INTO "file" (${names.map((n) => `"${n}"`).join(", ")})
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
    `INSERT INTO "app_user" ("id", "name", "email", "username", "role", "designation", "updated_at")
     VALUES ('ministry', 'පරීක්ෂණ', 'ministry@no-email.invalid', 'ministry', 'MINISTRY_OFFICER', 'MINISTRY_PROGRAMME_OFFICER', now())`,
  );
  // Cases and a document entered before the change.
  await addCase("existing");
  await addCase("other");
  await addCase("done", "COMPLETED");
  await file("old-document", { case_id: "existing" });

  await run(VALUES);
  await run(TABLE);
});

afterAll(async () => {
  await sql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

const labels = async (type: string) => {
  const { rows } = await sql(
    `SELECT e."enumlabel" FROM pg_enum e JOIN pg_type t ON t."oid" = e."enumtypid"
     JOIN pg_namespace n ON n."oid" = t."typnamespace"
     WHERE t."typname" = $1 AND n."nspname" = $2 ORDER BY e."enumsortorder"`,
    [type, schema],
  );
  return rows.map((r) => r.enumlabel as string);
};

describe("the amendments' migrations (change 0008)", () => {
  it("adds REPLACED last, the two notices and the amendment's statuses", async () => {
    expect(await labels("CaseStatus")).toEqual([
      "AWAITING_ALLOCATION",
      "ALLOCATED_TO_DISTRICT",
      "ALLOCATION_RECEIVED",
      "IN_PROGRESS",
      "COMPLETED",
      "REPLACED",
    ]);
    expect((await labels("NotificationType")).slice(-2)).toEqual(["AMENDMENT_APPROVED", "AMENDMENT_REJECTED"]);
    expect(await labels("AmendmentStatus")).toEqual(["WAITING", "APPROVED", "REJECTED"]);
  });

  it("leaves the cases and documents entered before it as they were", async () => {
    const { rows } = await sql(`SELECT "id", "status"::text AS status FROM "case" ORDER BY "id"`);
    expect(rows).toEqual([
      { id: "done", status: "COMPLETED" },
      { id: "existing", status: "AWAITING_ALLOCATION" },
      { id: "other", status: "AWAITING_ALLOCATION" },
    ]);
    const document = await sql(`SELECT "case_id", "amendment_id" FROM "file" WHERE "id" = 'old-document'`);
    expect(document.rows).toEqual([{ case_id: "existing", amendment_id: null }]);
  });

  it("takes a waiting amendment, with its documents (AMD-1)", async () => {
    await amendment({});
    const { rows } = await sql(
      `SELECT "status"::text AS status, "version", "decided_by_id", "decided_at", "new_case_id", "submitted_at"
       FROM "amendment" WHERE "id" = 'amendment'`,
    );
    expect(rows[0]).toMatchObject({ status: "WAITING", version: 1, decided_by_id: null, new_case_id: null });
    expect(rows[0].submitted_at).toBeInstanceOf(Date);
    await file("new-document", { amendment_id: "amendment" });
  });

  it("refuses a second waiting amendment for a case (AMD-3)", async () => {
    const [text, values] = insertOf({ id: "second", case_id: "existing" });
    await refused(text, values, "amendment_one_waiting_per_case", "23505");
  });

  it("refuses an Application Number another waiting amendment of the DS holds (AMD-8)", async () => {
    const [text, values] = insertOf({ id: "same-number", application_key: "KDW/9" });
    await refused(text, values, "amendment_one_waiting_per_application_number", "23505");
  });

  it("holds the reasons, the decision and the new case to the amendment's status", async () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ reason: "අඩු" }, "amendment_reason_5_to_1000"],
      [{ reason: "අ".repeat(1001) }, "amendment_reason_5_to_1000"],
      // Waiting, but decided.
      [{ decided_by_id: "ministry" }, "amendment_decided_by_only_when_decided"],
      [{ decided_at: new Date() }, "amendment_decided_at_only_when_decided"],
      [{ rejection_reason: "හේතුවක් ඇත" }, "amendment_rejection_reason_only_when_rejected"],
      [{ new_case_id: "done" }, "amendment_new_case_only_when_approved"],
      // Decided, but missing who or when.
      [
        { status: "REJECTED", decided_at: new Date(), rejection_reason: "හේතුවක් ඇත" },
        "amendment_decided_by_only_when_decided",
      ],
      [
        { status: "REJECTED", decided_by_id: "ministry", rejection_reason: "හේතුවක් ඇත" },
        "amendment_decided_at_only_when_decided",
      ],
      // Rejected with no reason, or too short a one.
      [
        { status: "REJECTED", decided_by_id: "ministry", decided_at: new Date() },
        "amendment_rejection_reason_only_when_rejected",
      ],
      [
        { status: "REJECTED", decided_by_id: "ministry", decided_at: new Date(), rejection_reason: "නැත" },
        "amendment_rejection_reason_5_to_1000",
      ],
      // Approved with no new case, or with the case itself.
      [
        { status: "APPROVED", decided_by_id: "ministry", decided_at: new Date() },
        "amendment_new_case_only_when_approved",
      ],
      [
        { status: "APPROVED", decided_by_id: "ministry", decided_at: new Date(), new_case_id: "other" },
        "amendment_new_case_not_itself",
      ],
    ];
    for (const [values, check] of bad) {
      const [text, params] = insertOf(values);
      await refused(text, params, check);
    }
  });

  it("takes an approval and a rejection, and the DS may send another once one is decided (AMD-5, AMD-6)", async () => {
    await sql(
      `UPDATE "amendment" SET "status" = 'REJECTED', "decided_by_id" = 'ministry', "decided_at" = now(),
         "rejection_reason" = 'ලේඛන මදි', "version" = "version" + 1 WHERE "id" = 'amendment'`,
    );
    await amendment({ id: "again", application_key: "KDW/9" });
    await addCase("new-case");
    await sql(
      `UPDATE "amendment" SET "status" = 'APPROVED', "decided_by_id" = 'ministry', "decided_at" = now(),
         "new_case_id" = 'new-case' WHERE "id" = 'again'`,
    );
    await sql(`UPDATE "case" SET "status" = 'REPLACED' WHERE "id" = 'existing'`);
    // The case an approval made belongs to that amendment only.
    await amendment({ id: "third", case_id: "other", application_key: "KDW/10" });
    await refused(
      `UPDATE "amendment" SET "status" = 'APPROVED', "decided_by_id" = 'ministry', "decided_at" = now(),
         "new_case_id" = 'new-case' WHERE "id" = 'third'`,
      [],
      "amendment_new_case_id_key",
      "23505",
    );
  });

  it("keeps a document on a case or an amendment, never both, and only a document (CASE-2)", async () => {
    await refused(`UPDATE "file" SET "case_id" = 'existing' WHERE "id" = 'new-document'`, [], "file_case_or_amendment");
    await expect(file("photo", { kind: "PHOTO", amendment_id: "amendment" })).rejects.toMatchObject({
      code: "23514",
      constraint: "file_only_documents_on_amendments",
    });
    // The approval moves a document to the new case.
    await sql(`UPDATE "file" SET "amendment_id" = NULL, "case_id" = 'new-case' WHERE "id" = 'new-document'`);
  });

  it("refuses to delete a case or an account with an amendment (CASE-8, ADM-7)", async () => {
    await expect(sql(`DELETE FROM "case" WHERE "id" = 'other'`)).rejects.toMatchObject({
      code: "23503",
      constraint: "amendment_case_id_fkey",
    });
    await expect(sql(`DELETE FROM "app_user" WHERE "id" = 'ministry'`)).rejects.toMatchObject({ code: "23503" });
  });
});
