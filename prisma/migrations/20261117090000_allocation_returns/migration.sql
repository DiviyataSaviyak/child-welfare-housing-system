-- Written by hand (17 Nov 2026), change 0009 (changes from testing), task 4: a replaced beneficiary's
-- allocation that goes back, when the approved amendment's new beneficiary is built outside the place the
-- money had reached (AMD-11).
--
-- Expand only, so the release before it keeps working: a new type and a new table that it never reads.
BEGIN;

-- CreateEnum
CREATE TYPE "ReturnedTo" AS ENUM ('DISTRICT', 'MINISTRY');

-- CreateTable
CREATE TABLE "allocation_return" (
    "id" TEXT NOT NULL,
    "amendment_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "new_case_id" TEXT NOT NULL,
    "letter_id" TEXT NOT NULL,
    "ds_release_id" TEXT,
    "district_id" INTEGER NOT NULL,
    "ds_office_id" INTEGER,
    "returned_to" "ReturnedTo" NOT NULL,
    "amount" INTEGER NOT NULL,
    "returned_on" DATE NOT NULL,
    "reference_number" TEXT NOT NULL,
    "note" TEXT,
    "by_id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_return_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "allocation_return_amendment_id_key" ON "allocation_return"("amendment_id");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_return_case_id_key" ON "allocation_return"("case_id");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_return_new_case_id_key" ON "allocation_return"("new_case_id");

-- CreateIndex
CREATE INDEX "allocation_return_letter_id_idx" ON "allocation_return"("letter_id");

-- CreateIndex
CREATE INDEX "allocation_return_ds_release_id_idx" ON "allocation_return"("ds_release_id");

-- CreateIndex
CREATE INDEX "allocation_return_district_id_idx" ON "allocation_return"("district_id");

-- CreateIndex
CREATE INDEX "allocation_return_ds_office_id_idx" ON "allocation_return"("ds_office_id");

-- AddForeignKey
ALTER TABLE "allocation_return" ADD CONSTRAINT "allocation_return_amendment_id_fkey" FOREIGN KEY ("amendment_id") REFERENCES "amendment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_return" ADD CONSTRAINT "allocation_return_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_return" ADD CONSTRAINT "allocation_return_new_case_id_fkey" FOREIGN KEY ("new_case_id") REFERENCES "case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_return" ADD CONSTRAINT "allocation_return_letter_id_fkey" FOREIGN KEY ("letter_id") REFERENCES "release_letter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_return" ADD CONSTRAINT "allocation_return_ds_release_id_fkey" FOREIGN KEY ("ds_release_id") REFERENCES "ds_release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_return" ADD CONSTRAINT "allocation_return_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_return" ADD CONSTRAINT "allocation_return_ds_office_id_fkey" FOREIGN KEY ("ds_office_id") REFERENCES "ds_office"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_return" ADD CONSTRAINT "allocation_return_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the Prisma schema can't express.
ALTER TABLE "allocation_return"
  ADD CONSTRAINT "allocation_return_amount_2000000" CHECK ("amount" = 2000000),
  ADD CONSTRAINT "allocation_return_reference_1_to_50" CHECK (char_length("reference_number") BETWEEN 1 AND 50),
  ADD CONSTRAINT "allocation_return_note_up_to_1000" CHECK ("note" IS NULL OR char_length("note") <= 1000),
  -- The DS office it came back from is the District release's, so both or neither.
  ADD CONSTRAINT "allocation_return_ds_office_with_its_release" CHECK (("ds_release_id" IS NULL) = ("ds_office_id" IS NULL)),
  -- Back to the District only from a DS office the District had released it to.
  ADD CONSTRAINT "allocation_return_to_district_from_a_ds_office"
    CHECK ("returned_to" <> 'DISTRICT' OR "ds_release_id" IS NOT NULL),
  ADD CONSTRAINT "allocation_return_new_case_not_itself" CHECK ("new_case_id" <> "case_id");

COMMIT;
