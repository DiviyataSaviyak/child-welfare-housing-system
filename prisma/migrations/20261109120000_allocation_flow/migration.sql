-- Written by hand (9 Nov 2026), change 0006 (the allocation flow), task 2: the five statuses, the
-- Application Number (CASE-12), the DS where a house is built (CASE-13) and the District's release to a DS
-- (REL-6), with every existing case moved to them (the design's "Migration", AC-59).
--
-- Version 1's statuses, the columns the check and stopping use, and the case-number counter stay for now:
-- the code for drafts, the check, stopping and version 1's letter still reads them until the later tasks of
-- change 0006 remove it, and a later migration drops them. No case holds one of those statuses after this.
-- Anything unexpected stops the migration, and nothing changes.
BEGIN;

-- 1. The District's release to a DS office (REL-6), and where each case is built (CASE-13).

CREATE TABLE "ds_release" (
    "id" TEXT NOT NULL,
    "district_id" INTEGER NOT NULL,
    "ds_office_id" INTEGER NOT NULL,
    "reference_number" TEXT NOT NULL,
    "released_on" DATE NOT NULL,
    "note" TEXT,
    "by_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ds_release_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ds_release_district_id_at_idx" ON "ds_release"("district_id", "at");
CREATE INDEX "ds_release_ds_office_id_idx" ON "ds_release"("ds_office_id");
ALTER TABLE "ds_release" ADD CONSTRAINT "ds_release_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ds_release" ADD CONSTRAINT "ds_release_ds_office_id_fkey" FOREIGN KEY ("ds_office_id") REFERENCES "ds_office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ds_release" ADD CONSTRAINT "ds_release_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ds_release" ADD CONSTRAINT "ds_release_reference_length" CHECK (char_length("reference_number") BETWEEN 1 AND 50);
ALTER TABLE "ds_release" ADD CONSTRAINT "ds_release_note_length" CHECK ("note" IS NULL OR char_length("note") <= 500);

-- Each case's release, once the District releases it to the DS, and the day it did (REL-7).
ALTER TABLE "release" ADD COLUMN "ds_release_id" TEXT, ADD COLUMN "ds_released_on" DATE;
CREATE INDEX "release_ds_release_id_idx" ON "release"("ds_release_id");
ALTER TABLE "release" ADD CONSTRAINT "release_ds_release_id_fkey" FOREIGN KEY ("ds_release_id") REFERENCES "ds_release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "release" ADD CONSTRAINT "release_ds_release_both_or_neither" CHECK (("ds_release_id" IS NULL) = ("ds_released_on" IS NULL));

-- A District release's scan, as file.letter_id holds the Ministry letter's. Only a scan has one, and never both.
ALTER TABLE "file" ADD COLUMN "ds_release_id" TEXT;
CREATE INDEX "file_ds_release_id_idx" ON "file"("ds_release_id");
ALTER TABLE "file" ADD CONSTRAINT "file_ds_release_id_fkey" FOREIGN KEY ("ds_release_id") REFERENCES "ds_release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "file" ADD CONSTRAINT "file_only_scans_on_ds_releases" CHECK ("ds_release_id" IS NULL OR "kind" = 'LETTER');
ALTER TABLE "file" ADD CONSTRAINT "file_scan_on_one_release" CHECK ("letter_id" IS NULL OR "ds_release_id" IS NULL);

-- The DS where it is built: the DS of residence for every case so far.
ALTER TABLE "case" ADD COLUMN "build_ds_office_id" INTEGER;
UPDATE "case" SET "build_ds_office_id" = "ds_office_id";
ALTER TABLE "case" ALTER COLUMN "build_ds_office_id" SET NOT NULL;
CREATE INDEX "case_build_ds_office_id_status_idx" ON "case"("build_ds_office_id", "status");
ALTER TABLE "case" ADD CONSTRAINT "case_build_ds_office_id_fkey" FOREIGN KEY ("build_ds_office_id") REFERENCES "ds_office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The two notices change 0006 adds (NTF-1). Not used in this transaction, so adding them here is safe.
ALTER TYPE "NotificationType" ADD VALUE 'ALLOCATED';
ALTER TYPE "NotificationType" ADD VALUE 'DISTRICT_LETTER';

-- 2. Drafts are deleted with their documents, as CASE-8 allowed for a draft, and each deletion is logged
-- as the command logs it, by the system. The stored files themselves are left where they are.

INSERT INTO "audit_log" ("actor_id", "action", "entity_type", "entity_id", "case_id", "after")
SELECT NULL, 'case_draft_deleted', 'case', "id", "id",
       jsonb_build_object('dsOfficeId', "ds_office_id", 'reason', 'migration_allocation_flow')
FROM "case" WHERE "status" = 'DRAFT';
DELETE FROM "notification" WHERE "case_id" IN (SELECT "id" FROM "case" WHERE "status" = 'DRAFT');
DELETE FROM "decision" WHERE "case_id" IN (SELECT "id" FROM "case" WHERE "status" = 'DRAFT');
DELETE FROM "file" WHERE "case_id" IN (SELECT "id" FROM "case" WHERE "status" = 'DRAFT');
DELETE FROM "case" WHERE "status" = 'DRAFT';

-- 3. The Application Number (CASE-12): each case number becomes one. The key is the number in capitals
-- without spaces, unique within the DS office of residence.

DROP INDEX "case_case_number_key";
ALTER TABLE "case" RENAME COLUMN "case_number" TO "application_number";
ALTER TABLE "case" ADD COLUMN "application_key" TEXT;
UPDATE "case" SET "application_key" = upper(regexp_replace("application_number", '\s', '', 'g'))
WHERE "application_number" IS NOT NULL;
CREATE UNIQUE INDEX "case_ds_office_id_application_key_key" ON "case"("ds_office_id", "application_key");
ALTER TABLE "case" ADD CONSTRAINT "case_application_number_length" CHECK (
  "application_number" IS NULL OR char_length("application_number") BETWEEN 1 AND 30
);
ALTER TABLE "case" ADD CONSTRAINT "case_application_key_with_number" CHECK (
  ("application_number" IS NULL) = ("application_key" IS NULL)
);

-- 4. The statuses. The type is made again with the five new ones first (version 1's stay at the end for
-- now), so the cases can move to them in this transaction. The checks that name the type go and come back.

ALTER TABLE "case" DROP CONSTRAINT "case_status_before_stop";
ALTER TABLE "case" DROP CONSTRAINT "case_another_name_only_when_closed";
CREATE TYPE "CaseStatus_new" AS ENUM (
  'AWAITING_ALLOCATION', 'ALLOCATED_TO_DISTRICT', 'ALLOCATION_RECEIVED', 'IN_PROGRESS', 'COMPLETED',
  'DRAFT', 'SUBMITTED', 'RETURNED', 'VERIFIED', 'REJECTED', 'STOPPED'
);
ALTER TABLE "case" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "case" ALTER COLUMN "status" TYPE "CaseStatus_new" USING ("status"::text::"CaseStatus_new");
ALTER TABLE "case" ALTER COLUMN "status_before_stop" TYPE "CaseStatus_new" USING ("status_before_stop"::text::"CaseStatus_new");
ALTER TYPE "CaseStatus" RENAME TO "CaseStatus_old";
ALTER TYPE "CaseStatus_new" RENAME TO "CaseStatus";
DROP TYPE "CaseStatus_old";
-- Version 1's form still saves drafts until change 0006's task 4.
ALTER TABLE "case" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- A stopped case takes the status it had before it was stopped (or, if it never noted one, the one its
-- money says), then moves on as below.
UPDATE "case" c SET "status" = COALESCE(
  c."status_before_stop",
  CASE WHEN EXISTS (SELECT 1 FROM "release" r WHERE r."case_id" = c."id") THEN 'IN_PROGRESS' ELSE 'VERIFIED' END::"CaseStatus"
)
WHERE c."status" = 'STOPPED';

-- Nobody checks a case any more: entered, sent back, verified or rejected, it awaits the Ministry's allocation.
UPDATE "case" SET "status" = 'AWAITING_ALLOCATION' WHERE "status" IN ('SUBMITTED', 'RETURNED', 'VERIFIED', 'REJECTED');

-- Version 1's letter released the money to the DS at once. So each letter becomes, as well, one District
-- release to each DS office of its cases, with the letter's number, date and author.
INSERT INTO "ds_release" ("id", "district_id", "ds_office_id", "reference_number", "released_on", "by_id", "at")
SELECT DISTINCT md5(l."id" || ':' || c."build_ds_office_id")::uuid::text, l."district_id", c."build_ds_office_id",
       l."letter_number", l."letter_date", l."by_id", l."at"
FROM "release" r
JOIN "release_letter" l ON l."id" = r."letter_id"
JOIN "case" c ON c."id" = r."case_id";

UPDATE "release" r
SET "ds_release_id" = md5(r."letter_id" || ':' || c."build_ds_office_id")::uuid::text,
    "ds_released_on" = l."letter_date"
FROM "case" c, "release_letter" l
WHERE c."id" = r."case_id" AND l."id" = r."letter_id";

-- In progress means installment 1 is paid (INS-5); a case released with nothing paid has received its allocation.
UPDATE "case" c SET "status" = 'ALLOCATION_RECEIVED'
WHERE c."status" = 'IN_PROGRESS'
  AND NOT EXISTS (
    SELECT 1 FROM "installment" i WHERE i."case_id" = c."id" AND i."number" = 1 AND i."status" = 'RELEASED'
  );

-- Nothing is stopped or rejected any more, so nothing waits to be reopened or for another name.
UPDATE "case" SET "status_before_stop" = NULL, "another_name_requested" = false
WHERE "status_before_stop" IS NOT NULL OR "another_name_requested";

ALTER TABLE "case" ADD CONSTRAINT "case_status_before_stop" CHECK (
  "status_before_stop" IS NULL OR ("status" = 'STOPPED' AND "status_before_stop" IN ('VERIFIED', 'IN_PROGRESS'))
);
ALTER TABLE "case" ADD CONSTRAINT "case_another_name_only_when_closed" CHECK (
  NOT "another_name_requested" OR "status" IN ('REJECTED', 'STOPPED')
);

-- Every case past the allocation has its allocation, and every case past the District's release has
-- that too; anything else stops the migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "case" c LEFT JOIN "release" r ON r."case_id" = c."id"
    WHERE (c."status" IN ('ALLOCATED_TO_DISTRICT', 'ALLOCATION_RECEIVED', 'IN_PROGRESS', 'COMPLETED') AND r."id" IS NULL)
       OR (c."status" IN ('ALLOCATION_RECEIVED', 'IN_PROGRESS', 'COMPLETED') AND r."ds_release_id" IS NULL)
       OR (c."status" NOT IN ('AWAITING_ALLOCATION', 'ALLOCATED_TO_DISTRICT', 'ALLOCATION_RECEIVED', 'IN_PROGRESS', 'COMPLETED'))
       OR c."application_number" IS NULL
  ) THEN
    RAISE EXCEPTION 'allocation_flow: a case is left without its status, allocation, release or Application Number';
  END IF;
END $$;

COMMIT;
