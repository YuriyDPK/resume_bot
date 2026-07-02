CREATE TABLE "SeenVacancy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL,
    "externalId" TEXT,
    "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "SeenVacancy_url_key" ON "SeenVacancy"("url");

INSERT OR IGNORE INTO "SeenVacancy" ("url", "externalId", "firstSeenAt")
SELECT "url", "externalId", "createdAt" FROM "Vacancy";
