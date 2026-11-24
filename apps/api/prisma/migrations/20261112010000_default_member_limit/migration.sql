-- Positions allow one member unless the adviser sets more. Positions that had no limit get
-- one, or as many as already hold them, so nobody is pushed out.
UPDATE "designations" d
SET "max_members" = GREATEST(1, (
  SELECT count(*) FROM "user_ay_roles" m WHERE m."designation_id" = d."id" AND m."status" = 'active'
))
WHERE d."max_members" IS NULL;
