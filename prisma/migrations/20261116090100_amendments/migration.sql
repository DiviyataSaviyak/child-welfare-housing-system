-- Written by hand (16 Nov 2026), change 0008 (amendments, filters and exports), task 1: the amendment, a DS's
-- request to the Ministry to replace a case's beneficiary (AMD-1 to AMD-6), and its documents.
--
-- Expand only, so the release before it keeps working: a new table, and a new nullable column on "file" with
-- checks that hold on every existing row (each has no amendment). Nothing is moved or dropped. Version 1's
-- links between cases ("case"."replaces_case_id") stay as they are.
BEGIN;

-- 1. The amendment. The new beneficiary waits in "details", as the case form's values, until the Ministry
--    approves it and the approval makes their case (AMD-5).

CREATE TABLE "amendment" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "ds_office_id" INTEGER NOT NULL,
    "application_key" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "AmendmentStatus" NOT NULL DEFAULT 'WAITING',
    "submitted_by_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "new_case_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "amendment_pkey" PRIMARY KEY ("id"),
    -- AMD-1: the reason for the amendment; AMD-4: the reason for rejecting it, given only then.
    CONSTRAINT "amendment_reason_5_to_1000" CHECK (char_length("reason") BETWEEN 5 AND 1000),
    CONSTRAINT "amendment_rejection_reason_only_when_rejected"
      CHECK (("status" = 'REJECTED') = ("rejection_reason" IS NOT NULL)),
    CONSTRAINT "amendment_rejection_reason_5_to_1000"
      CHECK ("rejection_reason" IS NULL OR char_length("rejection_reason") BETWEEN 5 AND 1000),
    -- Who decided and when, set together and only once it is decided.
    CONSTRAINT "amendment_decided_by_only_when_decided"
      CHECK (("status" = 'WAITING') = ("decided_by_id" IS NULL)),
    CONSTRAINT "amendment_decided_at_only_when_decided"
      CHECK (("status" = 'WAITING') = ("decided_at" IS NULL)),
    -- AMD-5: the case the approval made, set only when approved, and never the case it replaces.
    CONSTRAINT "amendment_new_case_only_when_approved"
      CHECK (("status" = 'APPROVED') = ("new_case_id" IS NOT NULL)),
    CONSTRAINT "amendment_new_case_not_itself" CHECK ("new_case_id" <> "case_id")
);

-- The case made by an approval belongs to one amendment only.
CREATE UNIQUE INDEX "amendment_new_case_id_key" ON "amendment"("new_case_id");
CREATE INDEX "amendment_case_id_idx" ON "amendment"("case_id");
CREATE INDEX "amendment_ds_office_id_idx" ON "amendment"("ds_office_id");
-- The lists (AMD-9): each status, newest or oldest first.
CREATE INDEX "amendment_status_submitted_at_idx" ON "amendment"("status", "submitted_at");

-- Rules the Prisma schema can't express.
-- AMD-3: a case has at most one amendment waiting for the Ministry.
CREATE UNIQUE INDEX "amendment_one_waiting_per_case" ON "amendment"("case_id") WHERE "status" = 'WAITING';
-- AMD-8, CASE-12: no two waiting amendments of a DS hold the same Application Number. The command also
-- checks it against the DS's cases.
CREATE UNIQUE INDEX "amendment_one_waiting_per_application_number" ON "amendment"("ds_office_id", "application_key")
  WHERE "status" = 'WAITING';

-- A case with an amendment can't be deleted (CASE-8), nor an account that submitted or decided one (ADM-7).
ALTER TABLE "amendment" ADD CONSTRAINT "amendment_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "amendment" ADD CONSTRAINT "amendment_ds_office_id_fkey" FOREIGN KEY ("ds_office_id") REFERENCES "ds_office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "amendment" ADD CONSTRAINT "amendment_submitted_by_id_fkey" FOREIGN KEY ("submitted_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "amendment" ADD CONSTRAINT "amendment_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "amendment" ADD CONSTRAINT "amendment_new_case_id_fkey" FOREIGN KEY ("new_case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. An amendment's documents: a new beneficiary's other documents (CASE-2), until the approval moves them
--    to the new case. A document belongs to a case or to an amendment, never both.

ALTER TABLE "file" ADD COLUMN "amendment_id" TEXT;
CREATE INDEX "file_amendment_id_idx" ON "file"("amendment_id");
ALTER TABLE "file" ADD CONSTRAINT "file_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "amendment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "file" ADD CONSTRAINT "file_case_or_amendment" CHECK ("case_id" IS NULL OR "amendment_id" IS NULL);
ALTER TABLE "file" ADD CONSTRAINT "file_only_documents_on_amendments" CHECK ("amendment_id" IS NULL OR "kind" = 'DOCUMENT');

COMMIT;
