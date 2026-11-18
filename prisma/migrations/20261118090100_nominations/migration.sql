-- Written by hand (18 Nov 2026), change 0009 (changes from testing), task 5: a DS's request that the District
-- nominate a new beneficiary (AMD-12, AMD-13), and no more returns to the Ministry (AMD-11, the owner on
-- 18 Nov 2026).
--
-- Expand only, so the release before it keeps working: a new table it never reads, and a check that holds
-- only new rows (NOT VALID), so a return to the Ministry written by task 4 in a test database stays.
BEGIN;

-- CreateTable
CREATE TABLE "nomination" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "ds_office_id" INTEGER NOT NULL,
    "district_id" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "NominationStatus" NOT NULL DEFAULT 'WAITING',
    "asked_by_id" TEXT NOT NULL,
    "asked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendment_id" TEXT,
    "sent_back_reason" TEXT,
    "sent_back_by_id" TEXT,
    "sent_back_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "nomination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "nomination_amendment_id_key" ON "nomination"("amendment_id");

-- CreateIndex
CREATE INDEX "nomination_case_id_idx" ON "nomination"("case_id");

-- CreateIndex
CREATE INDEX "nomination_ds_office_id_idx" ON "nomination"("ds_office_id");

-- CreateIndex
CREATE INDEX "nomination_district_id_status_idx" ON "nomination"("district_id", "status");

-- AddForeignKey
ALTER TABLE "nomination" ADD CONSTRAINT "nomination_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomination" ADD CONSTRAINT "nomination_ds_office_id_fkey" FOREIGN KEY ("ds_office_id") REFERENCES "ds_office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomination" ADD CONSTRAINT "nomination_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomination" ADD CONSTRAINT "nomination_asked_by_id_fkey" FOREIGN KEY ("asked_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomination" ADD CONSTRAINT "nomination_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "amendment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nomination" ADD CONSTRAINT "nomination_sent_back_by_id_fkey" FOREIGN KEY ("sent_back_by_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rules the Prisma schema can't express.
ALTER TABLE "nomination"
  ADD CONSTRAINT "nomination_reason_5_to_1000" CHECK (char_length("reason") BETWEEN 5 AND 1000),
  ADD CONSTRAINT "nomination_amendment_when_nominated"
    CHECK (("status" = 'NOMINATED') = ("amendment_id" IS NOT NULL)),
  ADD CONSTRAINT "nomination_sent_back_reason_when_sent_back"
    CHECK (("status" = 'SENT_BACK') = ("sent_back_reason" IS NOT NULL)),
  ADD CONSTRAINT "nomination_sent_back_reason_5_to_1000"
    CHECK ("sent_back_reason" IS NULL OR char_length("sent_back_reason") BETWEEN 5 AND 1000),
  ADD CONSTRAINT "nomination_sent_back_at_when_sent_back"
    CHECK (("status" = 'SENT_BACK') = ("sent_back_at" IS NOT NULL));

-- AMD-12: one request waits per case at most.
CREATE UNIQUE INDEX "nomination_one_waiting_per_case" ON "nomination"("case_id") WHERE "status" = 'WAITING';

-- AMD-11: once the Ministry's letter has gone, the money never goes back to the Ministry.
ALTER TABLE "allocation_return"
  ADD CONSTRAINT "allocation_return_to_district_only" CHECK ("returned_to" = 'DISTRICT') NOT VALID;

COMMIT;
