-- The active mess is now a stored pointer on the user, verified against
-- mess_member on every mess-scoped service call instead of living in the JWT.
ALTER TABLE "User" ADD COLUMN "activeMessId" TEXT;

ALTER TABLE "User"
  ADD CONSTRAINT "User_activeMessId_fkey"
  FOREIGN KEY ("activeMessId") REFERENCES "mess"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill from existing ACTIVE memberships (one active mess per user).
UPDATE "User" u
SET "activeMessId" = m."messId"
FROM "mess_member" m
WHERE m."userId" = u.id AND m.status = 'ACTIVE';
