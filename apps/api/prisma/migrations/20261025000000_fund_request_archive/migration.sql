-- Finished fund requests can be archived (hidden from the default lists, never deleted).

-- AlterTable
ALTER TABLE "fund_requests" ADD COLUMN     "archived_at" TIMESTAMPTZ(6),
ADD COLUMN     "archived_by" UUID,
ADD COLUMN     "archived_by_name" TEXT;

-- CreateIndex
CREATE INDEX "fund_requests_academic_year_id_archived_at_idx" ON "fund_requests"("academic_year_id", "archived_at");

-- ───────────── hand-written ─────────────

-- only finished requests can be archived, and an archived request can't change status
ALTER TABLE "fund_requests" ADD CONSTRAINT "ck_fund_requests_archive_finished"
  CHECK ("archived_at" IS NULL OR "status" IN ('cleared', 'rejected', 'canceled'));
