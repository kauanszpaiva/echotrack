-- Links the Postgres user mirror to its Clerk identity.
--
-- Additive and non-destructive: both columns are nullable and no existing data
-- is read, rewritten or deleted. Rows created before Clerk (Supabase Auth UUIDs
-- or cuids) keep their primary key — and therefore every relation pointing at
-- it — and are linked to Clerk by `clerk_user_id` on first sign-in (or by
-- `prisma/backfill-clerk-auth.ts`).

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "clerk_user_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_expires_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_clerk_user_id_key" ON "users"("clerk_user_id");
