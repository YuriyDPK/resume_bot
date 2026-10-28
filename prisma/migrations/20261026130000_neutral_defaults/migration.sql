-- Historical migrations seeded executive queries even on an empty database.
-- Remove that seed only before a user profile exists. Preserve existing user settings.
DELETE FROM "SearchKeyword" WHERE NOT EXISTS (SELECT 1 FROM "Setting");
