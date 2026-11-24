-- Positions get a "See funds" permission: whether members holding them may open the Funds page
-- and see fund balances. On for every existing position, so nobody loses access by this change.

-- AlterTable
ALTER TABLE "designations" ADD COLUMN     "can_view_funds" BOOLEAN NOT NULL DEFAULT true;
