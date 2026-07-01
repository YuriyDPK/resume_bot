-- CreateTable
CREATE TABLE "Vacancy" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "externalId" TEXT,
    "title" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "salary" TEXT,
    "city" TEXT,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "matchScore" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'found',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Application" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "vacancyId" INTEGER NOT NULL,
    "coverLetter" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "appliedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Application_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "city" TEXT NOT NULL DEFAULT 'Москва',
    "minSalary" INTEGER,
    "coverLetterTemplate" TEXT NOT NULL DEFAULT 'Здравствуйте! Заинтересовала ваша вакансия. Буду рад обсудить, чем мой опыт может быть полезен команде.',
    "resumeText" TEXT NOT NULL DEFAULT '',
    "dailyLimit" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SearchKeyword" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "value" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Log" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "level" TEXT NOT NULL DEFAULT 'info',
    "message" TEXT NOT NULL,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Vacancy_url_key" ON "Vacancy"("url");

-- CreateIndex
CREATE INDEX "Vacancy_status_idx" ON "Vacancy"("status");

-- CreateIndex
CREATE INDEX "Vacancy_matchScore_idx" ON "Vacancy"("matchScore");

-- CreateIndex
CREATE INDEX "Vacancy_createdAt_idx" ON "Vacancy"("createdAt");

-- CreateIndex
CREATE INDEX "Application_status_idx" ON "Application"("status");

-- CreateIndex
CREATE INDEX "Application_appliedAt_idx" ON "Application"("appliedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SearchKeyword_value_key" ON "SearchKeyword"("value");

-- CreateIndex
CREATE INDEX "Log_level_idx" ON "Log"("level");

-- CreateIndex
CREATE INDEX "Log_createdAt_idx" ON "Log"("createdAt");
