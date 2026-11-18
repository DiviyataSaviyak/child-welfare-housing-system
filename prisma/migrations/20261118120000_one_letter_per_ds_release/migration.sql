-- Written by hand (18 Nov 2026), change 0009 (changes from testing), task 7: each District release belongs
-- to one Ministry letter (REL-6, REL-12). A release that holds cases of several letters is split into one
-- release for each letter. The part of the oldest letter keeps the release's id and its scan; each other
-- part is a new release with the same district, DS office, reference, date, note, author and time. A stored
-- file belongs to one release, so the scan stays with the first part. Each case of a split release gets an
-- audit record, so its history says so.
--
-- With a maintenance note: the previous release writes District releases without a letter.
BEGIN;

ALTER TABLE "ds_release" ADD COLUMN "letter_id" TEXT;

-- Each release's letters, from its cases and from its allocations that went back (AMD-11), oldest first.
CREATE TEMP TABLE "ds_release_part" ON COMMIT DROP AS
WITH "parts" AS (
  SELECT "ds_release_id" AS "ds_id", "letter_id" FROM "release" WHERE "ds_release_id" IS NOT NULL
  UNION
  SELECT "ds_release_id", "letter_id" FROM "allocation_return" WHERE "ds_release_id" IS NOT NULL
)
SELECT p."ds_id", p."letter_id",
       row_number() OVER (PARTITION BY p."ds_id" ORDER BY l."letter_date", l."id") AS "n",
       count(*) OVER (PARTITION BY p."ds_id") AS "letters"
FROM "parts" p
JOIN "release_letter" l ON l."id" = p."letter_id";

ALTER TABLE "ds_release_part" ADD COLUMN "new_id" TEXT;
UPDATE "ds_release_part"
SET "new_id" = CASE WHEN "n" = 1 THEN "ds_id" ELSE md5("ds_id" || ':' || "letter_id")::uuid::text END;

-- The first part keeps the release.
UPDATE "ds_release" d SET "letter_id" = p."letter_id"
FROM "ds_release_part" p
WHERE p."ds_id" = d."id" AND p."n" = 1;

-- Each other part is a release of its own.
INSERT INTO "ds_release" ("id", "district_id", "ds_office_id", "letter_id", "reference_number", "released_on",
                          "note", "by_id", "at")
SELECT p."new_id", d."district_id", d."ds_office_id", p."letter_id", d."reference_number", d."released_on",
       d."note", d."by_id", d."at"
FROM "ds_release_part" p
JOIN "ds_release" d ON d."id" = p."ds_id"
WHERE p."n" > 1;

-- Every case of a split release, by the system, before its allocation moves.
INSERT INTO "audit_log" ("actor_id", "action", "entity_type", "entity_id", "case_id", "after")
SELECT NULL, 'ds_release_split', 'ds_release', p."new_id", r."case_id",
       jsonb_build_object(
         'fromDsReleaseId', p."ds_id",
         'dsReleaseId', p."new_id",
         'referenceNumber', d."reference_number",
         'letterNumber', l."letter_number",
         'reason', 'migration_one_letter_per_ds_release'
       )
FROM "ds_release_part" p
JOIN "release" r ON r."ds_release_id" = p."ds_id" AND r."letter_id" = p."letter_id"
JOIN "ds_release" d ON d."id" = p."ds_id"
JOIN "release_letter" l ON l."id" = p."letter_id"
WHERE p."letters" > 1;

UPDATE "release" r SET "ds_release_id" = p."new_id"
FROM "ds_release_part" p
WHERE r."ds_release_id" = p."ds_id" AND r."letter_id" = p."letter_id" AND p."n" > 1;

UPDATE "allocation_return" a SET "ds_release_id" = p."new_id"
FROM "ds_release_part" p
WHERE a."ds_release_id" = p."ds_id" AND a."letter_id" = p."letter_id" AND p."n" > 1;

-- A release with no case and no return would have no letter; none exists, and if one did this fails.
ALTER TABLE "ds_release" ALTER COLUMN "letter_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "ds_release_letter_id_idx" ON "ds_release"("letter_id");

-- AddForeignKey
ALTER TABLE "ds_release" ADD CONSTRAINT "ds_release_letter_id_fkey" FOREIGN KEY ("letter_id") REFERENCES "release_letter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
