-- Written by hand (18 Nov 2026), change 0009 (changes from testing), task 5: the two notices of a request
-- that the District nominate a new beneficiary (AMD-12, AMD-13) and the request's own statuses.
--
-- On their own, because PostgreSQL can't use an enum value in the transaction that adds it; the next
-- migration's checks use them. Expand only: the release before this one never sees the new values.

ALTER TYPE "NotificationType" ADD VALUE 'NOMINATION_ASKED';
ALTER TYPE "NotificationType" ADD VALUE 'NOMINATION_SENT_BACK';

CREATE TYPE "NominationStatus" AS ENUM ('WAITING', 'NOMINATED', 'SENT_BACK');
