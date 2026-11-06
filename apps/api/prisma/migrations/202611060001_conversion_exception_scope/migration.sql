ALTER TABLE "conversion_exceptions"
  ADD COLUMN "product" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "species_scientific" TEXT NOT NULL DEFAULT '';
