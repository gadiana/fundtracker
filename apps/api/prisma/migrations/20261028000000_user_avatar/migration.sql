-- Profile pictures.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "avatar_key" TEXT,
ADD COLUMN     "avatar_mime" VARCHAR(30),
ADD COLUMN     "avatar_updated_at" TIMESTAMPTZ(6);
