-- Phase 9: refresh-token rotation with reuse detection, and two-factor sign-in (TOTP).

-- AlterTable
ALTER TABLE "user_sessions" ADD COLUMN     "previous_refresh_token_hash" CHAR(64),
ADD COLUMN     "rotated_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "totp_enabled_at" TIMESTAMPTZ(6),
ADD COLUMN     "totp_last_step" BIGINT,
ADD COLUMN     "totp_pending_secret_enc" TEXT,
ADD COLUMN     "totp_recovery_hashes" JSONB NOT NULL DEFAULT '[]';

-- CreateIndex
CREATE UNIQUE INDEX "user_sessions_previous_refresh_token_hash_key" ON "user_sessions"("previous_refresh_token_hash");

-- ───────────── hand-written ─────────────

-- two-factor is on only with a confirmed secret (the allowed modes are checked by ck_settings_twofa)
ALTER TABLE "users" ADD CONSTRAINT "ck_users_totp_secret"
  CHECK (NOT "totp_enabled" OR "totp_secret_enc" IS NOT NULL);
