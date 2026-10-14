-- AUTH-7 (14 Oct 2026, the same day): an officer who has forgotten their password resets it with a code
-- sent by SMS to the mobile number in their account, instead of asking the admin. The admin's requests
-- go, and each code sent gets a row here.
ALTER TABLE "app_user" DROP COLUMN "new_password_asked_at";

-- CreateTable
CREATE TABLE "password_reset_code" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "code_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "checked_at" TIMESTAMP(3),

    CONSTRAINT "password_reset_code_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "password_reset_code_user_id_created_at_idx" ON "password_reset_code"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "password_reset_code" ADD CONSTRAINT "password_reset_code_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
