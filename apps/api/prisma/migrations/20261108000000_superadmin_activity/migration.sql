-- Superadmin, more than one adviser per AY, sign-in activity (visits), and no idle-session timeout.
-- ay_settings.session_timeout_minutes is no longer used but stays in the table, so an older
-- copy of the app running against the same database keeps working.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "is_superadmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_visits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_visits_user_id_started_at_idx" ON "user_visits"("user_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "user_visits_session_id_started_at_idx" ON "user_visits"("session_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "user_visits_last_seen_at_idx" ON "user_visits"("last_seen_at");

-- AddForeignKey
ALTER TABLE "user_visits" ADD CONSTRAINT "user_visits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_visits" ADD CONSTRAINT "user_visits_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "user_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── hand-written ─────────────

-- an academic year may have more than one adviser now (the superadmin adds them)
DROP INDEX IF EXISTS "ux_one_active_adviser";

ALTER TABLE "user_visits"
  ADD CONSTRAINT "ck_user_visits_order" CHECK ("last_seen_at" >= "started_at" AND ("ended_at" IS NULL OR "ended_at" >= "started_at"));
