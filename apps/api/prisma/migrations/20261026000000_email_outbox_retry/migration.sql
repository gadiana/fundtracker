-- Phase 7: failed emails are retried from the outbox when the stored copy is complete.

-- AlterTable
ALTER TABLE "email_outbox" ADD COLUMN     "retryable" BOOLEAN NOT NULL DEFAULT true;

-- ───────────── hand-written ─────────────

-- emails sent before this migration with a redacted body (one-time links) can't be re-sent
UPDATE "email_outbox" SET "retryable" = false WHERE "html_body" LIKE '[contains a one-time link%';
