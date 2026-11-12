-- Written by hand (12 Nov 2026), change 0007 (the registration form), task 1: the three land kinds of help
-- (CASE-17) and the four new lists of values (CASE-14 to CASE-16).
--
-- On their own, because PostgreSQL can't use an enum value in the transaction that adds it; the next
-- migration's columns and checks use them. Expand only: the release before this one never sees the new values.

ALTER TYPE "Kind" ADD VALUE 'LAND_ONLY';
ALTER TYPE "Kind" ADD VALUE 'LAND_AND_BUILD';
ALTER TYPE "Kind" ADD VALUE 'LAND_WITH_HOUSE';

CREATE TYPE "CareGroup" AS ENUM ('IN_CARE', 'LEFT_CARE');
CREATE TYPE "MaritalStatus" AS ENUM ('UNMARRIED', 'MARRIED');
CREATE TYPE "Relationship" AS ENUM ('MOTHER', 'FATHER', 'OTHER');
CREATE TYPE "Aid" AS ENUM ('ARTHA', 'KIDNEY', 'SAMURDHI', 'ASWESUMA', 'ELDERLY', 'DISABILITY', 'OTHER');
