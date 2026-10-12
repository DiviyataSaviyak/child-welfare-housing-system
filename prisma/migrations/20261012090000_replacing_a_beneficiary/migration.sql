-- AlterTable
ALTER TABLE "case" ADD COLUMN     "another_name_requested" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "replaces_case_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "case_replaces_case_id_key" ON "case"("replaces_case_id");

-- AddForeignKey
ALTER TABLE "case" ADD CONSTRAINT "case_replaces_case_id_fkey" FOREIGN KEY ("replaces_case_id") REFERENCES "case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Written by hand; Prisma doesn't model check constraints, and `migrate dev` leaves them alone.
-- Head Office asks for another name only when it rejects or stops a case (CASE-11).
ALTER TABLE "case" ADD CONSTRAINT "case_another_name_only_when_closed" CHECK (
  NOT "another_name_requested" OR "status" IN ('REJECTED', 'STOPPED')
);
-- A case is never entered in its own place.
ALTER TABLE "case" ADD CONSTRAINT "case_not_its_own_replacement" CHECK ("replaces_case_id" <> "id");
