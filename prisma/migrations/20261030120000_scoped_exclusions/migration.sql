ALTER TABLE "Setting" ADD COLUMN "excludedDescriptionWords" TEXT NOT NULL DEFAULT '';
UPDATE "Setting" SET "excludedDescriptionWords" = "excludedWords";
