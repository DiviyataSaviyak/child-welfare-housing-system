-- Written by hand (16 Nov 2026), change 0008 (amendments, filters and exports), task 1: the replaced status
-- (STS-2, AMD-5), the two notices of a decided amendment (AMD-10) and the amendment's own statuses (AMD-1).
--
-- On their own, because PostgreSQL can't use an enum value in the transaction that adds it; the next
-- migration's checks use them. Expand only: the release before this one never sees the new values.

ALTER TYPE "CaseStatus" ADD VALUE 'REPLACED';

ALTER TYPE "NotificationType" ADD VALUE 'AMENDMENT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'AMENDMENT_REJECTED';

CREATE TYPE "AmendmentStatus" AS ENUM ('WAITING', 'APPROVED', 'REJECTED');
