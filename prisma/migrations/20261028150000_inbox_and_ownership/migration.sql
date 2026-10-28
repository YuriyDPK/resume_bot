-- CreateTable
CREATE TABLE "Conversation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "accountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "vacancyUrl" TEXT,
    "vacancyTitle" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "resumeId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'neutral',
    "statusLabel" TEXT NOT NULL DEFAULT '',
    "unread" BOOLEAN NOT NULL DEFAULT false,
    "lastMessage" TEXT NOT NULL DEFAULT '',
    "messagesJson" TEXT NOT NULL DEFAULT '[]',
    "hhUrl" TEXT NOT NULL,
    "lastMessageAt" DATETIME,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Setting" (
    "hhAccountId" TEXT,
    "resumeVerifiedAt" DATETIME,
    "name" TEXT NOT NULL DEFAULT 'Основное резюме',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "city" TEXT NOT NULL DEFAULT '',
    "minSalary" INTEGER,
    "coverLetterTemplate" TEXT NOT NULL DEFAULT 'Здравствуйте! Заинтересовала ваша вакансия. Буду рад обсудить, чем мой опыт может быть полезен команде.',
    "resumeText" TEXT NOT NULL DEFAULT '',
    "resumeUrl" TEXT,
    "excludedWords" TEXT NOT NULL DEFAULT '',
    "browserHeadless" BOOLEAN NOT NULL DEFAULT true,
    "dailyLimit" INTEGER NOT NULL DEFAULT 5,
    "searchLimit" INTEGER NOT NULL DEFAULT 50,
    "searchAllRussia" BOOLEAN NOT NULL DEFAULT true,
    "remoteOnly" BOOLEAN NOT NULL DEFAULT false,
    "activeSearchBatchId" TEXT,
    "searchDelayMinSeconds" INTEGER NOT NULL DEFAULT 1,
    "searchDelayMaxSeconds" INTEGER NOT NULL DEFAULT 3,
    "applyDelayMinSeconds" INTEGER NOT NULL DEFAULT 3,
    "applyDelayMaxSeconds" INTEGER NOT NULL DEFAULT 8,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Setting" ("activeSearchBatchId", "applyDelayMaxSeconds", "applyDelayMinSeconds", "browserHeadless", "city", "coverLetterTemplate", "createdAt", "dailyLimit", "excludedWords", "id", "minSalary", "name", "remoteOnly", "resumeText", "resumeUrl", "searchAllRussia", "searchDelayMaxSeconds", "searchDelayMinSeconds", "searchLimit", "updatedAt") SELECT "activeSearchBatchId", "applyDelayMaxSeconds", "applyDelayMinSeconds", "browserHeadless", "city", "coverLetterTemplate", "createdAt", "dailyLimit", "excludedWords", "id", "minSalary", "name", "remoteOnly", "resumeText", "resumeUrl", "searchAllRussia", "searchDelayMaxSeconds", "searchDelayMinSeconds", "searchLimit", "updatedAt" FROM "Setting";
DROP TABLE "Setting";
ALTER TABLE "new_Setting" RENAME TO "Setting";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Conversation_accountId_outcome_idx" ON "Conversation"("accountId", "outcome");

-- CreateIndex
CREATE INDEX "Conversation_accountId_lastMessageAt_idx" ON "Conversation"("accountId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_accountId_externalId_key" ON "Conversation"("accountId", "externalId");

