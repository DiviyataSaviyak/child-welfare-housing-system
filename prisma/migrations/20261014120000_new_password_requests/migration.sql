-- AUTH-7 (14 Oct 2026): an officer who has forgotten their password asks for a new one on the sign-in page,
-- and the request waits here until the admin gives one or closes it.
ALTER TABLE "app_user" ADD COLUMN     "new_password_asked_at" TIMESTAMP(3);
