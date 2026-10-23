-- SEC-4 and AUTH-2 (22 Oct 2026): the sign-in and reset-code rate limits, and the wrong tries of
-- usernames that have no account, move from each app process's memory into the database. The servers
-- run two app containers, and each counting on its own would let twice as many attempts through. Both
-- tables start empty and nothing else changes, so the release before this one runs on beside them.

-- CreateTable
CREATE TABLE "rate_limit" (
    "key" TEXT NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "rate_limit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "unknown_sign_in_name" (
    "name_hash" TEXT NOT NULL,
    "failed_sign_ins" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "last_tried_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unknown_sign_in_name_pkey" PRIMARY KEY ("name_hash")
);

-- CreateIndex
CREATE INDEX "unknown_sign_in_name_last_tried_at_idx" ON "unknown_sign_in_name"("last_tried_at");
