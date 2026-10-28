import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { resolveDatabaseUrl } from "@/lib/database-url";

describe("Prisma upgrade and existing SQLite conventions", () => {
  let directory: string;
  let client: PrismaClient;

  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "resume-bot-db-test-"));
    const url = "file:" + path.join(directory, "test.db");
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
      env: { ...process.env, DATABASE_URL: url }, stdio: "pipe"
    });
    client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }, { timestampFormat: "unixepoch-ms" }) });
  });
  afterAll(async () => {
    await client?.$disconnect();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("keeps relative URLs pointed at the legacy prisma directory", () => {
    expect(resolveDatabaseUrl("file:./dev.db")).toBe("file:" + path.resolve("prisma/dev.db"));
    const absolute = path.join(directory, "test.db");
    expect(resolveDatabaseUrl("file:" + absolute)).toBe("file:" + absolute);
  });
  it("applies every migration to a fresh database and defaults to hidden mode", async () => {
    const setting = await client.setting.create({ data: { id: 1 } });
    expect(setting.browserHeadless).toBe(true);
    expect(setting.excludedWords).toBe("");
    expect(setting.resumeText).toBe("");
    expect(setting.resumeUrl).toBeNull();
    expect(setting.city).toBe("");
    expect(setting.searchAllRussia).toBe(true);
    expect(setting.minSalary).toBeNull();
    expect(setting.remoteOnly).toBe(false);
    expect(await client.searchKeyword.count()).toBe(0);
  });
  it("reads old epoch timestamps and writes compatible dates", async () => {
    const timestamp = Date.UTC(2026, 9, 26, 12);
    await client.$executeRaw`INSERT INTO "Log" ("level", "message", "createdAt") VALUES ('info', 'legacy', ${timestamp})`;
    const log = await client.log.findFirstOrThrow({ where: { message: "legacy" } });
    expect(log.createdAt.getTime()).toBe(timestamp);
    const written = await client.log.create({ data: { message: "new", createdAt: new Date(timestamp) } });
    expect(written.createdAt.getTime()).toBe(timestamp);
    const stored = await client.$queryRaw<{ storage: string }[]>`SELECT typeof("createdAt") AS storage FROM "Log" WHERE "id" = ${written.id}`;
    expect(stored[0].storage).toBe("integer");
  });
  it("migrates populated legacy data into the first resume without losing statuses or applications", async () => {
    const url = "file:" + path.join(directory, "legacy.db");
    const legacy = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }, { timestampFormat: "unixepoch-ms" }) });
    try {
      const migrations = (await readdir("prisma/migrations")).filter((name) => /^\d/.test(name)).sort();
      for (const name of migrations) {
        if (name >= "20261028120000_resume_profiles") continue;
        const sql = await readFile(path.join("prisma/migrations", name, "migration.sql"), "utf8");
        for (const statement of sql.split(";").filter((part) => part.trim())) await legacy.$executeRawUnsafe(statement);
      }
      const timestamp = Date.UTC(2026, 9, 28, 9);
      await legacy.$executeRaw`INSERT INTO Setting (id, resumeText, city, updatedAt) VALUES (1, 'Мой опыт', 'Казань', ${timestamp})`;
      await legacy.$executeRaw`INSERT INTO Vacancy (id,title,company,url,status,updatedAt) VALUES (1,'Врач','Клиника','https://hh.ru/vacancy/123','applied',${timestamp})`;
      await legacy.$executeRaw`INSERT INTO Application (vacancyId,status,appliedAt,updatedAt) VALUES (1,'applied',${timestamp},${timestamp})`;
      await legacy.$executeRaw`INSERT INTO Log (message) VALUES ('Моя история')`;
      const sql = await readFile("prisma/migrations/20261028120000_resume_profiles/migration.sql", "utf8");
      for (const statement of sql.split(";").filter((part) => part.trim())) await legacy.$executeRawUnsafe(statement);
      const inboxSql = await readFile("prisma/migrations/20261028150000_inbox_and_ownership/migration.sql", "utf8");
      for (const statement of inboxSql.split(";").filter((part) => part.trim())) await legacy.$executeRawUnsafe(statement);
      expect(await legacy.setting.findUnique({ where: { id: 1 } })).toMatchObject({ resumeText: "Мой опыт", city: "Казань", name: "Основное резюме" });
      expect(await legacy.vacancy.findUnique({ where: { id: 1 } })).toMatchObject({ profileId: 1, status: "applied" });
      expect(await legacy.application.findFirst()).toMatchObject({ vacancyId: 1, status: "applied", appliedAt: new Date(timestamp) });
      expect(await legacy.log.findFirst()).toMatchObject({ profileId: 1, message: "Моя история" });
      expect(await legacy.appState.findUnique({ where: { id: 1 } })).toMatchObject({ activeProfileId: 1 });
    } finally { await legacy.$disconnect(); }
  });
});
