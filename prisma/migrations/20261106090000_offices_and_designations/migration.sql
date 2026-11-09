-- Change 0005: six office types, each with its designations. The designation decides the role, and
-- each office type has its own place (ADM-2, ADM-8). Every existing account is a sample, so the free
-- text in "designation" is overwritten (change 0005, design).

ALTER TABLE "app_user" DROP CONSTRAINT "app_user_role_check";
ALTER TABLE "app_user" DROP CONSTRAINT "app_user_ds_office_check";

-- AlterTable
ALTER TABLE "app_user" ADD COLUMN     "district_id" INTEGER,
ADD COLUMN     "province_id" INTEGER;

-- CreateIndex
CREATE INDEX "app_user_district_id_idx" ON "app_user"("district_id");

-- CreateIndex
CREATE INDEX "app_user_province_id_idx" ON "app_user"("province_id");

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_district_id_fkey" FOREIGN KEY ("district_id") REFERENCES "district"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_province_id_fkey" FOREIGN KEY ("province_id") REFERENCES "province"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing accounts keep their usernames, passwords and rights (AC-43).
UPDATE "app_user" SET "designation" = CASE "role"
  WHEN 'DS_OFFICER' THEN 'DS_CRPO'
  WHEN 'HO_OFFICER' THEN 'MINISTRY_PROGRAMME_OFFICER'
  ELSE NULL
END;

-- Rules the Prisma schema cannot express (added by hand).

ALTER TABLE "app_user" ADD CONSTRAINT "app_user_role_check"
  CHECK ("role" IN ('DS_OFFICER', 'DISTRICT_OFFICER', 'HO_OFFICER', 'VIEWER', 'ADMIN'));

-- The role always follows the designation (src/server/auth/designations.ts), and an admin has none.
-- A check passes on NULL, so "designation" = 'x' alone would let a role through with no designation.
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_designation_check" CHECK (
  ("role" = 'ADMIN' AND "designation" IS NULL)
  OR ("designation" IS NOT NULL AND (
    ("role" = 'DS_OFFICER' AND "designation" = 'DS_CRPO')
    OR ("role" = 'DISTRICT_OFFICER' AND "designation" = 'DISTRICT_CRPO')
    OR ("role" = 'HO_OFFICER' AND "designation" IN ('MINISTRY_PROGRAMME_OFFICER', 'MINISTRY_CHIEF_ACCOUNTANT'))
    OR ("role" = 'VIEWER' AND "designation" IN (
      'DS_SECRETARY', 'DS_ASSISTANT_SECRETARY', 'DS_ACCOUNTANT',
      'DISTRICT_SECRETARY', 'DISTRICT_ADDITIONAL_SECRETARY', 'DISTRICT_CHIEF_ACCOUNTANT',
      'PROVINCE_COMMISSIONER', 'PROVINCE_PROBATION_OFFICER',
      'DEPARTMENT_ASSISTANT_COMMISSIONER', 'DEPARTMENT_COMMISSIONER',
      'MINISTRY_SECRETARY', 'MINISTRY_ADDITIONAL_SECRETARY'
    ))
  ))
);

-- An account has the one place its office type belongs to, and no other.
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_place_check" CHECK (
  ("ds_office_id" IS NOT NULL) = COALESCE("designation" IN ('DS_CRPO', 'DS_SECRETARY', 'DS_ASSISTANT_SECRETARY', 'DS_ACCOUNTANT'), false)
  AND ("district_id" IS NOT NULL) = COALESCE("designation" IN ('DISTRICT_SECRETARY', 'DISTRICT_ADDITIONAL_SECRETARY', 'DISTRICT_CRPO', 'DISTRICT_CHIEF_ACCOUNTANT'), false)
  AND ("province_id" IS NOT NULL) = COALESCE("designation" IN ('PROVINCE_COMMISSIONER', 'PROVINCE_PROBATION_OFFICER'), false)
);
