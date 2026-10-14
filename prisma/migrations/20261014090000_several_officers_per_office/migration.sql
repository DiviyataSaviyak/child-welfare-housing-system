-- ADM-3 (14 Oct 2026): a DS office can have more than one active DS officer, so the index that allowed
-- only one (migration one_crpo_per_office) goes. Added by hand: Prisma never knew about the index.
DROP INDEX "app_user_one_active_ds_officer_per_office";
