-- Settling the difference between the cash advance (approved amount) and the amount actually used.
--   * used MORE than approved → the org owes the requestor: "reimburse"
--   * used LESS than approved → the requestor owes the org the change: "return"
-- The request waits in "settlement_due" until the treasurer (or adviser) records the hand-over,
-- and only then becomes "cleared".

ALTER TYPE "fund_request_status" ADD VALUE IF NOT EXISTS 'settlement_due' BEFORE 'cleared';

CREATE TYPE "settlement_kind" AS ENUM ('reimburse', 'return');

ALTER TABLE "liquidation_receipts"
  -- what approving took out of the fund: fund_used, or only the approved amount when the
  -- approver did not accept the excess (the requestor absorbs it)
  ADD COLUMN "charged_amount" BIGINT,
  ADD COLUMN "settlement_kind" "settlement_kind",
  ADD COLUMN "settlement_amount" BIGINT,
  ADD COLUMN "settled_at" TIMESTAMPTZ(6),
  ADD COLUMN "settled_by" UUID,
  ADD COLUMN "settled_by_name" TEXT,
  ADD COLUMN "settled_by_designation" TEXT,
  ADD COLUMN "settlement_note" TEXT,
  ADD COLUMN "settlement_file_id" UUID;

UPDATE "liquidation_receipts" SET "charged_amount" = "fund_used" WHERE "status" = 'approved';

ALTER TABLE "liquidation_receipts"
  ADD CONSTRAINT "liquidation_receipts_settled_by_fkey"
    FOREIGN KEY ("settled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "liquidation_receipts_settlement_file_fkey"
    FOREIGN KEY ("settlement_file_id", "academic_year_id") REFERENCES "stored_files"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ck_lr_charged" CHECK ("charged_amount" IS NULL OR "charged_amount" >= 0),
  ADD CONSTRAINT "ck_lr_settlement" CHECK (
    ("settlement_kind" IS NULL AND "settlement_amount" IS NULL AND "settled_at" IS NULL)
    OR ("settlement_kind" IS NOT NULL AND "settlement_amount" > 0)
  ),
  ADD CONSTRAINT "ck_lr_settled_by" CHECK ("settled_at" IS NULL OR ("settled_by" IS NOT NULL AND "settled_by_name" IS NOT NULL));
