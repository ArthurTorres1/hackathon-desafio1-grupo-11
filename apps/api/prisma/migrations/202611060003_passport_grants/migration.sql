ALTER TABLE "passports"
  ADD COLUMN "allowed_organization_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
