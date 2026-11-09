-- Written by hand (9 Nov 2026), change 0006 (UI-10): Head Office becomes the Ministry, and its
-- officers' role HO_OFFICER becomes MINISTRY_OFFICER. Usernames, passwords and designations stay (AC-59).

ALTER TABLE "app_user" DROP CONSTRAINT "app_user_designation_check";
ALTER TABLE "app_user" DROP CONSTRAINT "app_user_role_check";

UPDATE "app_user" SET "role" = 'MINISTRY_OFFICER' WHERE "role" = 'HO_OFFICER';

ALTER TABLE "app_user" ADD CONSTRAINT "app_user_role_check"
  CHECK ("role" IN ('DS_OFFICER', 'DISTRICT_OFFICER', 'MINISTRY_OFFICER', 'VIEWER', 'ADMIN'));

-- The role always follows the designation (src/server/auth/designations.ts), and an admin has none.
-- A check passes on NULL, so "designation" = 'x' alone would let a role through with no designation.
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_designation_check" CHECK (
  ("role" = 'ADMIN' AND "designation" IS NULL)
  OR ("designation" IS NOT NULL AND (
    ("role" = 'DS_OFFICER' AND "designation" = 'DS_CRPO')
    OR ("role" = 'DISTRICT_OFFICER' AND "designation" = 'DISTRICT_CRPO')
    OR ("role" = 'MINISTRY_OFFICER' AND "designation" IN ('MINISTRY_PROGRAMME_OFFICER', 'MINISTRY_CHIEF_ACCOUNTANT'))
    OR ("role" = 'VIEWER' AND "designation" IN (
      'DS_SECRETARY', 'DS_ASSISTANT_SECRETARY', 'DS_ACCOUNTANT',
      'DISTRICT_SECRETARY', 'DISTRICT_ADDITIONAL_SECRETARY', 'DISTRICT_CHIEF_ACCOUNTANT',
      'PROVINCE_COMMISSIONER', 'PROVINCE_PROBATION_OFFICER',
      'DEPARTMENT_ASSISTANT_COMMISSIONER', 'DEPARTMENT_COMMISSIONER',
      'MINISTRY_SECRETARY', 'MINISTRY_ADDITIONAL_SECRETARY'
    ))
  ))
);
