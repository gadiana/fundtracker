-- Itemized liquidation: a liquidation holds one or more receipts, each with one or more items
-- and its own files. Also: the public QR page can show the payment history (on by default).

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "liquidation_entry_id" UUID;

-- AlterTable
ALTER TABLE "ay_settings" ALTER COLUMN "public_fields" SET DEFAULT '["name","status","breakdown","transactions"]';

-- CreateTable
CREATE TABLE "liquidation_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "liquidation_receipt_id" UUID NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "used_for" VARCHAR(200) NOT NULL,
    "payee" VARCHAR(150),
    "receipt_no" VARCHAR(60),
    "receipt_date" DATE NOT NULL,
    "total" BIGINT NOT NULL,

    CONSTRAINT "liquidation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidation_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "academic_year_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "sort_order" SMALLINT NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_cost" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "liquidation_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "liquidation_entries_liquidation_receipt_id_sort_order_key" ON "liquidation_entries"("liquidation_receipt_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "liquidation_entries_id_academic_year_id_key" ON "liquidation_entries"("id", "academic_year_id");

-- CreateIndex
CREATE UNIQUE INDEX "liquidation_items_entry_id_sort_order_key" ON "liquidation_items"("entry_id", "sort_order");

-- AddForeignKey
ALTER TABLE "liquidation_entries" ADD CONSTRAINT "liquidation_entries_liquidation_receipt_id_academic_year_i_fkey" FOREIGN KEY ("liquidation_receipt_id", "academic_year_id") REFERENCES "liquidation_receipts"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidation_items" ADD CONSTRAINT "liquidation_items_entry_id_academic_year_id_fkey" FOREIGN KEY ("entry_id", "academic_year_id") REFERENCES "liquidation_entries"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_liquidation_entry_id_academic_year_id_fkey" FOREIGN KEY ("liquidation_entry_id", "academic_year_id") REFERENCES "liquidation_entries"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ───────────── hand-written ─────────────

ALTER TABLE "liquidation_entries"
  ADD CONSTRAINT "ck_liquidation_entries_total" CHECK ("total" > 0),
  ADD CONSTRAINT "ck_liquidation_entries_order" CHECK ("sort_order" >= 1);

ALTER TABLE "liquidation_items"
  ADD CONSTRAINT "ck_liquidation_items_quantity" CHECK ("quantity" > 0),
  ADD CONSTRAINT "ck_liquidation_items_unit_cost" CHECK ("unit_cost" > 0),
  ADD CONSTRAINT "ck_liquidation_items_amount" CHECK ("amount" = "quantity" * "unit_cost");

-- a receipt's file is always also a file of that liquidation
ALTER TABLE "attachments"
  ADD CONSTRAINT "ck_attachment_entry_in_liquidation" CHECK ("liquidation_entry_id" IS NULL OR "liquidation_receipt_id" IS NOT NULL);

CREATE INDEX "attachments_liquidation_entry_id_idx" ON "attachments"("liquidation_entry_id");

-- submitted receipts are a record: never edited or deleted (a revision is a new liquidation)
CREATE TRIGGER trg_le_append_only BEFORE UPDATE OR DELETE ON liquidation_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
CREATE TRIGGER trg_li_append_only BEFORE UPDATE OR DELETE ON liquidation_items
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Liquidations filed before this change become one receipt with one line for the amount used,
-- dated the day they were submitted (in the year's time zone), with all their files.
INSERT INTO "liquidation_entries" ("academic_year_id", "liquidation_receipt_id", "sort_order", "used_for", "receipt_date", "total")
SELECT lr."academic_year_id", lr."id", 1, 'Amount used (recorded before itemized receipts)',
       (lr."submitted_at" AT TIME ZONE COALESCE(s."timezone", 'Asia/Manila'))::date, lr."fund_used"
FROM "liquidation_receipts" lr
LEFT JOIN "ay_settings" s ON s."academic_year_id" = lr."academic_year_id";

INSERT INTO "liquidation_items" ("academic_year_id", "entry_id", "sort_order", "description", "quantity", "unit_cost", "amount")
SELECT e."academic_year_id", e."id", 1, 'Amount used', 1, e."total", e."total"
FROM "liquidation_entries" e;

UPDATE "attachments" a
SET "liquidation_entry_id" = e."id"
FROM "liquidation_entries" e
WHERE a."liquidation_receipt_id" = e."liquidation_receipt_id";

-- the QR page shows the payment history unless the adviser turns it off
UPDATE "ay_settings"
SET "public_fields" = "public_fields" || '["transactions"]'::jsonb
WHERE NOT ("public_fields" ? 'transactions');
