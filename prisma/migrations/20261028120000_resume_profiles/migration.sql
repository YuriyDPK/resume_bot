-- Existing settings, vacancies, applications and logs stay in profile 1.
ALTER TABLE "Setting" ADD COLUMN "name" TEXT NOT NULL DEFAULT 'Основное резюме';
ALTER TABLE "Vacancy" ADD COLUMN "profileId" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SeenVacancy" ADD COLUMN "profileId" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "SearchKeyword" ADD COLUMN "profileId" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Log" ADD COLUMN "profileId" INTEGER NOT NULL DEFAULT 1;
DROP INDEX "Vacancy_url_key";
DROP INDEX "SeenVacancy_url_key";
DROP INDEX "SearchKeyword_value_key";
CREATE UNIQUE INDEX "Vacancy_profileId_url_key" ON "Vacancy"("profileId", "url");
CREATE UNIQUE INDEX "SeenVacancy_profileId_url_key" ON "SeenVacancy"("profileId", "url");
CREATE UNIQUE INDEX "SearchKeyword_profileId_value_key" ON "SearchKeyword"("profileId", "value");
CREATE INDEX "Vacancy_profileId_status_idx" ON "Vacancy"("profileId", "status");
CREATE INDEX "Log_profileId_createdAt_idx" ON "Log"("profileId", "createdAt");
CREATE TABLE "AppState" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "activeProfileId" INTEGER NOT NULL DEFAULT 1
);
INSERT INTO "AppState" ("id", "activeProfileId") VALUES (1, 1);
