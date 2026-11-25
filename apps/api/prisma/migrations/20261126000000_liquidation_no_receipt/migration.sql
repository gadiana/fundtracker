-- Expenses that come without an official receipt (gas, fares, ...): no receipt number and no photo needed.
ALTER TABLE "liquidation_entries" ADD COLUMN "has_receipt" BOOLEAN NOT NULL DEFAULT true;
