-- An approved liquidation above the approved amount is allowed when the approver accepted the
-- excess (reimbursed to the requestor), or when only the approved amount was charged to the fund
-- (the requestor absorbed the excess).
ALTER TABLE "liquidation_receipts" DROP CONSTRAINT "ck_liq_over";
ALTER TABLE "liquidation_receipts"
  ADD CONSTRAINT "ck_liq_over" CHECK (
    "status" <> 'approved'
    OR COALESCE("charged_amount", "fund_used") <= "approved_amount"
    OR "over_approved_accepted"
  );
