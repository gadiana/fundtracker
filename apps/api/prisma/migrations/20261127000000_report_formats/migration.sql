-- How each kind of report is printed (paper, letterhead, signatories), by report kind.
-- A kind not in the object uses its default, built from the older report settings.
ALTER TABLE "ay_settings" ADD COLUMN "report_formats" JSONB NOT NULL DEFAULT '{}';
