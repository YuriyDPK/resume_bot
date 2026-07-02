ALTER TABLE "Setting" ADD COLUMN "searchLimit" INTEGER NOT NULL DEFAULT 50;
ALTER TABLE "Setting" ADD COLUMN "searchAllRussia" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setting" ADD COLUMN "remoteOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Setting" ADD COLUMN "activeSearchBatchId" TEXT;

ALTER TABLE "Vacancy" ADD COLUMN "searchBatchId" TEXT;
CREATE INDEX "Vacancy_searchBatchId_idx" ON "Vacancy"("searchBatchId");
