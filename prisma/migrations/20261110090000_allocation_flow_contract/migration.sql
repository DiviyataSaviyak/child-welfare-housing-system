-- Written by hand (10 Nov 2026), change 0006 (the allocation flow), task 5: drops what the migration
-- 20261109120000_allocation_flow kept for version 1's code, now that the drafts, the check, stopping and the
-- request for another name are gone. Version 1's statuses, the submit and verify times, the status before a
-- stop, the request for another name and the case-number counter go. The Application Number, its key, the
-- category and the kind become required, since no case is a draft any more.
--
-- The decisions and the notifications of version 1 stay, for the cases that have them.
BEGIN;

-- No case may still hold anything this drops: that migration moved every case. Anything else stops here,
-- and nothing changes.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "case"
    WHERE "status" NOT IN ('AWAITING_ALLOCATION', 'ALLOCATED_TO_DISTRICT', 'ALLOCATION_RECEIVED', 'IN_PROGRESS', 'COMPLETED')
       OR "application_number" IS NULL OR "application_key" IS NULL OR "category" IS NULL OR "kind" IS NULL
  ) THEN
    RAISE EXCEPTION 'allocation_flow_contract: a case still has a version 1 status or an empty required field';
  END IF;
END $$;

-- The checks that name the old statuses or columns go first.
ALTER TABLE "case" DROP CONSTRAINT "case_status_before_stop";
ALTER TABLE "case" DROP CONSTRAINT "case_another_name_only_when_closed";
ALTER TABLE "case" DROP CONSTRAINT "case_application_key_with_number";

DROP INDEX "case_status_submitted_at_idx";
DROP INDEX "case_status_verified_at_idx";
ALTER TABLE "case"
  DROP COLUMN "another_name_requested",
  DROP COLUMN "status_before_stop",
  DROP COLUMN "submitted_at",
  DROP COLUMN "verified_at",
  ALTER COLUMN "application_number" SET NOT NULL,
  ALTER COLUMN "application_key" SET NOT NULL,
  ALTER COLUMN "category" SET NOT NULL,
  ALTER COLUMN "kind" SET NOT NULL;

-- The five statuses only (STS-1).
CREATE TYPE "CaseStatus_new" AS ENUM (
  'AWAITING_ALLOCATION', 'ALLOCATED_TO_DISTRICT', 'ALLOCATION_RECEIVED', 'IN_PROGRESS', 'COMPLETED'
);
ALTER TABLE "case" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "case" ALTER COLUMN "status" TYPE "CaseStatus_new" USING ("status"::text::"CaseStatus_new");
ALTER TYPE "CaseStatus" RENAME TO "CaseStatus_old";
ALTER TYPE "CaseStatus_new" RENAME TO "CaseStatus";
DROP TYPE "CaseStatus_old";
ALTER TABLE "case" ALTER COLUMN "status" SET DEFAULT 'AWAITING_ALLOCATION';

-- The system gives no numbers any more (CASE-12).
DROP TABLE "case_number_counter";

COMMIT;
