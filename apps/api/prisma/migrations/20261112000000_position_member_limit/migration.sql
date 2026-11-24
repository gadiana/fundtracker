-- How many members may hold a position at once. President and Vice President are fixed at one;
-- the adviser sets the others (no limit until they do).

-- AlterTable
ALTER TABLE "designations" ADD COLUMN     "max_members" INTEGER,
ADD COLUMN     "seats_locked" BOOLEAN NOT NULL DEFAULT false;

-- ───────────── hand-written ─────────────

ALTER TABLE "designations"
  ADD CONSTRAINT "ck_designations_max_members" CHECK ("max_members" IS NULL OR "max_members" >= 1),
  ADD CONSTRAINT "ck_designations_locked_one" CHECK (NOT "seats_locked" OR "max_members" = 1);

UPDATE "designations"
SET "max_members" = 1, "seats_locked" = true
WHERE lower(trim("name")) IN ('president', 'vice president');
