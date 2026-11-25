-- Sections now belong to one program and one year level, so every program can have its own
-- sections for each year. Each existing section is copied to every program and year level of its
-- academic year (what was possible before), and students move to the copy that matches them.

ALTER TABLE "sections" ADD COLUMN "program_id" UUID, ADD COLUMN "year_level" SMALLINT;

DROP INDEX "sections_academic_year_id_name_key";

INSERT INTO "sections" ("id", "academic_year_id", "program_id", "year_level", "name", "is_active")
SELECT gen_random_uuid(), s."academic_year_id", p."id", y.lvl, s."name", s."is_active"
FROM "sections" s
JOIN "programs" p ON p."academic_year_id" = s."academic_year_id"
JOIN "ay_settings" st ON st."academic_year_id" = s."academic_year_id"
CROSS JOIN LATERAL generate_series(1, st."year_level_count") AS y(lvl)
WHERE s."program_id" IS NULL;

UPDATE "students" st SET "section_id" = n."id"
FROM "sections" o, "sections" n
WHERE st."section_id" = o."id" AND o."program_id" IS NULL
  AND n."academic_year_id" = o."academic_year_id" AND n."name" = o."name"
  AND n."program_id" = st."program_id" AND n."year_level" = st."year_level";

UPDATE "students" SET "section_id" = NULL
WHERE "section_id" IN (SELECT "id" FROM "sections" WHERE "program_id" IS NULL);

DELETE FROM "sections" WHERE "program_id" IS NULL;

ALTER TABLE "sections" ALTER COLUMN "program_id" SET NOT NULL, ALTER COLUMN "year_level" SET NOT NULL;

CREATE UNIQUE INDEX "sections_academic_year_id_program_id_year_level_name_key" ON "sections"("academic_year_id", "program_id", "year_level", "name");

ALTER TABLE "sections" ADD CONSTRAINT "sections_program_id_academic_year_id_fkey" FOREIGN KEY ("program_id", "academic_year_id") REFERENCES "programs"("id", "academic_year_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sections" ADD CONSTRAINT ck_section_year_level CHECK ("year_level" BETWEEN 1 AND 10);
