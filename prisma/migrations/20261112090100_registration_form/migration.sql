-- Written by hand (12 Nov 2026), change 0007 (the registration form), task 1: the new details of a case
-- (CASE-14 to CASE-17), a care leaver's child development centres, installments of other amounts for the
-- land kinds (INS-7) and stage lists for the house kinds only (LST-4).
--
-- Expand only, so the release before it keeps working: every new column may be NULL, and is NULL on every
-- case entered before it (the form asks for the required ones on the next save, CASE-9). Every check holds
-- on the existing rows, since their new columns are NULL, every installment is Rs. 500,000 and every stage
-- list is a house kind's. Nothing is moved or dropped except the installment amount's check, which widens.
BEGIN;

-- 1. The case's new details. A NULL aid list is a case entered before this change; the form saves an empty
--    list for "none".

ALTER TABLE "case"
    ADD COLUMN "date_of_birth" DATE,
    ADD COLUMN "care_group" "CareGroup",
    ADD COLUMN "marital_status" "MaritalStatus",
    ADD COLUMN "relationship" "Relationship",
    ADD COLUMN "relationship_other" TEXT,
    ADD COLUMN "family_members" INTEGER,
    ADD COLUMN "disabled_children" BOOLEAN,
    ADD COLUMN "aid" "Aid"[],
    ADD COLUMN "aid_other" TEXT,
    ADD COLUMN "land_gn_division" TEXT;

-- A care leaver's details stay off a child at risk, and a child at risk's off a care leaver (CASE-14,
-- CASE-15), even if a code path forgot to drop them.
ALTER TABLE "case" ADD CONSTRAINT "case_care_leaver_details"
  CHECK ("category" = 'CARE_LEAVER' OR ("care_group" IS NULL AND "marital_status" IS NULL));
ALTER TABLE "case" ADD CONSTRAINT "case_child_at_risk_details"
  CHECK ("category" = 'CHILD_AT_RISK' OR "relationship" IS NULL);
ALTER TABLE "case" ADD CONSTRAINT "case_relationship_other_only_for_other"
  CHECK ("relationship_other" IS NULL OR "relationship" = 'OTHER');
ALTER TABLE "case" ADD CONSTRAINT "case_family_members_1_to_30"
  CHECK ("family_members" BETWEEN 1 AND 30);
ALTER TABLE "case" ADD CONSTRAINT "case_aid_other_only_for_other"
  CHECK ("aid_other" IS NULL OR 'OTHER' = ANY ("aid"));

-- 2. A care leaver's child development centres (CASE-14), one row each, in order. Each date is a year, a
--    year and month, or a full day, or none; that the day exists and isn't in the future is the form's rule.

CREATE TABLE "care_centre" (
    "case_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "province_id" INTEGER NOT NULL,
    "from_year" INTEGER,
    "from_month" INTEGER,
    "from_day" INTEGER,
    "until_year" INTEGER,
    "until_month" INTEGER,
    "until_day" INTEGER,

    CONSTRAINT "care_centre_pkey" PRIMARY KEY ("case_id", "position"),
    CONSTRAINT "care_centre_position_1_to_10" CHECK ("position" BETWEEN 1 AND 10),
    CONSTRAINT "care_centre_name_2_to_150" CHECK (char_length("name") BETWEEN 2 AND 150),
    CONSTRAINT "care_centre_from_month_1_to_12" CHECK ("from_month" BETWEEN 1 AND 12),
    CONSTRAINT "care_centre_from_day_1_to_31" CHECK ("from_day" BETWEEN 1 AND 31),
    CONSTRAINT "care_centre_from_month_needs_year" CHECK ("from_month" IS NULL OR "from_year" IS NOT NULL),
    CONSTRAINT "care_centre_from_day_needs_month" CHECK ("from_day" IS NULL OR "from_month" IS NOT NULL),
    CONSTRAINT "care_centre_until_month_1_to_12" CHECK ("until_month" BETWEEN 1 AND 12),
    CONSTRAINT "care_centre_until_day_1_to_31" CHECK ("until_day" BETWEEN 1 AND 31),
    CONSTRAINT "care_centre_until_month_needs_year" CHECK ("until_month" IS NULL OR "until_year" IS NOT NULL),
    CONSTRAINT "care_centre_until_day_needs_month" CHECK ("until_day" IS NULL OR "until_month" IS NOT NULL)
);

CREATE INDEX "care_centre_province_id_idx" ON "care_centre"("province_id");

-- The centres go with their case (CASE-8).
ALTER TABLE "care_centre" ADD CONSTRAINT "care_centre_case_id_fkey"
  FOREIGN KEY ("case_id") REFERENCES "case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "care_centre" ADD CONSTRAINT "care_centre_province_id_fkey"
  FOREIGN KEY ("province_id") REFERENCES "province"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 3. A land kind's installments are of the amounts the purchase needs (INS-1, INS-7). The commands keep a
--    house kind's at 500,000 and a land case's total at no more than 2,000,000.

ALTER TABLE "installment" DROP CONSTRAINT "installment_amount_fixed";
ALTER TABLE "installment" ADD CONSTRAINT "installment_amount_1_to_2000000" CHECK ("amount" BETWEEN 1 AND 2000000);

-- 4. Stage lists are kept for the house kinds only (LST-4); a LAND_AND_BUILD case reads NEW_HOUSE's (STG-4).

ALTER TABLE "stage_definition" ADD CONSTRAINT "stage_definition_house_kinds"
  CHECK ("kind" IN ('NEW_HOUSE', 'RENOVATION'));

COMMIT;
