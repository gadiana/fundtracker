-- The superadmin is gone: the first account in an academic year is its adviser again, the adviser
-- has all the logs, and the organization's name and logos are set in the code (src/branding.ts).
ALTER TABLE "users" DROP COLUMN "is_superadmin", DROP COLUMN "must_change_password";
