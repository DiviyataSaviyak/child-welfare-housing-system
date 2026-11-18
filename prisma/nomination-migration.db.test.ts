import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";

/**
 * Change 0009 task 5's two migrations, run over a database with a case and a return to the Ministry written
 * before them (task 4 allowed one): nothing existing changes, and the request's rules hold.
 */
const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const VALUES = "20261118090000_nomination_values";
const TABLE = "20261118090100_nominations";

const client = new pg.Client({ connectionString: inject("testDatabaseUrl") });
const schema = `nomination_${Date.now()}_${randomBytes(3).toString("hex")}`;

const run = (name: string) => client.query(readFileSync(join(MIGRATIONS, name, "migration.sql"), "utf8"));
const sql = (text: string, values: unknown[] = []) => client.query(text, values);

/** The statement fails on the named check (23514) or unique index (23505). */
async function refused(text: string, values: unknown[], constraint: string, code = "23514") {
  await expect(sql(text, values), constraint).rejects.toMatchObject({ code, constraint });
}

const insert = (table: string, row: Record<string, unknown>): [string, unknown[]] => {
  const names = Object.keys(row);
  return [
    `INSERT INTO "${table}" (${names.map((n) => `"${n}"`).join(", ")})
     VALUES (${names.map((_, i) => `$${i + 1}`).join(", ")})`,
    Object.values(row),
  ];
};

/** A waiting request with the given columns over its defaults. */
const request = (values: Record<string, unknown>) =>
  insert("nomination", {
    id: "request",
    case_id: "existing",
    ds_office_id: 1,
    district_id: 1,
    reason: "වෙනත් ප්‍රතිලාභියෙකු නැත",
    asked_by_id: "officer",
    ...values,
  });

/** A return of the replaced case's allocation, to `to`. */
const allocationReturn = (id: string, to: string, values: Record<string, unknown> = {}) =>
  insert("allocation_return", {
    id,
    amendment_id: `${id}-amendment`,
    case_id: `${id}-case`,
    new_case_id: `${id}-new`,
    letter_id: "letter",
    ds_release_id: "ds-release",
    district_id: 1,
    ds_office_id: 1,
    returned_to: to,
    amount: 2000000,
    returned_on: "2026-11-17",
    reference_number: "RET/1",
    by_id: "officer",
    ...values,
  });

async function addCase(id: string) {
  await sql(
    `INSERT INTO "case" ("id", "application_number", "application_key", "ds_office_id", "build_ds_office_id",
       "category", "kind", "status", "name", "created_by_id", "updated_at")
     VALUES ($1, $1, upper($1), 1, 1, 'CARE_LEAVER', 'NEW_HOUSE', 'ALLOCATION_RECEIVED', 'පරීක්ෂණ', 'officer', now())`,
    [id],
  );
}

async function addAmendment(id: string, caseId: string) {
  await sql(
    ...insert("amendment", {
      id,
      case_id: caseId,
      ds_office_id: 1,
      application_key: id.toUpperCase(),
      details: "{}",
      reason: "ඉඩමේ ගැටලුවක් ඇත",
      submitted_by_id: "officer",
    }),
  );
}

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
    `INSERT INTO "release_letter" ("id", "district_id", "letter_number", "letter_date", "valid_until", "by_id")
     VALUES ('letter', 1, 'L/1', '2026-11-01', '2026-12-31', 'officer')`,
  );
  await sql(
    `INSERT INTO "ds_release" ("id", "district_id", "ds_office_id", "reference_number", "released_on", "by_id")
     VALUES ('ds-release', 1, 1, 'R/1', '2026-11-02', 'officer')`,
  );
  for (const id of ["existing", "old-case", "old-new", "new-case", "new-new", "ok-case", "ok-new"]) await addCase(id);
  await addAmendment("old-amendment", "old-case");
  await addAmendment("new-amendment", "new-case");
  await addAmendment("ok-amendment", "ok-case");
  // Task 4 wrote a return to the Ministry before this change.
  await sql(...allocationReturn("old", "MINISTRY"));

  await run(VALUES);
  await run(TABLE);
});

afterAll(async () => {
  await sql(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await client.end();
});

describe("the nominations' migrations (change 0009, task 5)", () => {
  it("adds the two notices and the request's statuses", async () => {
    const { rows } = await sql(
      `SELECT t."typname", e."enumlabel" FROM pg_enum e JOIN pg_type t ON t."oid" = e."enumtypid"
       JOIN pg_namespace n ON n."oid" = t."typnamespace"
       WHERE t."typname" IN ('NotificationType', 'NominationStatus') AND n."nspname" = $1
       ORDER BY t."typname", e."enumsortorder"`,
      [schema],
    );
    const of = (type: string) => rows.filter((r) => r.typname === type).map((r) => r.enumlabel as string);
    expect(of("NominationStatus")).toEqual(["WAITING", "NOMINATED", "SENT_BACK"]);
    expect(of("NotificationType").slice(-2)).toEqual(["NOMINATION_ASKED", "NOMINATION_SENT_BACK"]);
  });

  it("keeps a return to the Ministry written before it, and takes no new one (AMD-11)", async () => {
    const { rows } = await sql(`SELECT "returned_to"::text AS to FROM "allocation_return" WHERE "id" = 'old'`);
    expect(rows).toEqual([{ to: "MINISTRY" }]);
    const [text, values] = allocationReturn("new", "MINISTRY");
    await refused(text, values, "allocation_return_to_district_only");
    await sql(...allocationReturn("ok", "DISTRICT"));
  });

  it("takes a waiting request, and refuses a second one for the case (AMD-12)", async () => {
    await sql(...request({}));
    const { rows } = await sql(`SELECT "status"::text AS status, "version", "asked_at" FROM "nomination"`);
    expect(rows[0]).toMatchObject({ status: "WAITING", version: 1 });
    const [text, values] = request({ id: "second" });
    await refused(text, values, "nomination_one_waiting_per_case", "23505");
  });

  it("holds the reasons and the amendment to the request's status (AMD-13)", async () => {
    const bad: [Record<string, unknown>, string][] = [
      [{ reason: "අඩු" }, "nomination_reason_5_to_1000"],
      [{ status: "NOMINATED" }, "nomination_amendment_when_nominated"],
      [{ amendment_id: "ok-amendment" }, "nomination_amendment_when_nominated"],
      [{ status: "SENT_BACK", sent_back_at: new Date() }, "nomination_sent_back_reason_when_sent_back"],
      [{ status: "SENT_BACK", sent_back_reason: "හේතුවක් ඇත" }, "nomination_sent_back_at_when_sent_back"],
      [
        { status: "SENT_BACK", sent_back_reason: "අඩු", sent_back_at: new Date() },
        "nomination_sent_back_reason_5_to_1000",
      ],
    ];
    for (const [values, constraint] of bad) {
      const [text, params] = request({ id: "bad", case_id: "ok-case", ...values });
      await refused(text, params, constraint);
    }
    await sql(...request({ id: "nominated", case_id: "ok-case", status: "NOMINATED", amendment_id: "ok-amendment" }));
    await sql(
      ...request({
        id: "sent-back",
        case_id: "ok-case",
        status: "SENT_BACK",
        sent_back_reason: "වෙනත් ප්‍රතිලාභියෙකු නැත",
        sent_back_at: new Date(),
      }),
    );
  });
});
