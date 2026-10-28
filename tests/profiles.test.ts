import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const db = vi.hoisted(() => ({ client: undefined as PrismaClient | undefined }));
vi.mock("@/lib/prisma", () => ({ get prisma() { return db.client!; } }));
vi.mock("@/lib/hh/runner", () => ({ hhRunner: { getState: vi.fn(() => ({ running: false })), supportsVerifiedResumes: true, inspectOwnResume: vi.fn(), supportsResumeProfiles: true, supportsSelectedVacancies: true, resetProfileState: vi.fn(), startAutoApply: vi.fn() } }));
vi.mock("@/lib/hh/account", () => ({ getHHAccount: vi.fn(async () => ({ status: "connected", accountId: "fixture-owner", name: "Тестовый аккаунт" })) }));
import { activeProfileId, createProfile, listProfiles, withProfileChange } from "@/lib/profiles";
import { ensureSettings, saveImportedResume } from "@/lib/settings";
import { listVacancies } from "@/lib/vacancy-store";
import { listLogs } from "@/lib/log-store";
import { dashboardData } from "@/lib/dashboard-store";
import { writeLog } from "@/lib/log";
import { POST as profiles } from "@/app/api/profiles/route";
import { PUT as settings } from "@/app/api/settings/route";
import { POST as bulk } from "@/app/api/vacancies/bulk/route";
import { DELETE as logs } from "@/app/api/logs/route";
import { DELETE as removeVacancy } from "@/app/api/vacancies/[id]/route";
import { POST as skipVacancy } from "@/app/api/vacancies/[id]/skip/route";
import { hhRunner } from "@/lib/hh/runner";
import { inboxData, saveConversation } from "@/lib/inbox-store";
import { POST as exclusions } from "@/app/api/settings/exclusions/route";

const request = (url: string, body: unknown, method = "POST") => new Request("http://localhost:3011" + url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

describe("isolated resume workspaces on real SQLite", () => {
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "hh-profiles-"));
    const url = "file:" + path.join(directory, "test.db");
    execFileSync(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
    db.client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }, { timestampFormat: "unixepoch-ms" }) });
  });
  afterAll(async () => { await db.client?.$disconnect(); await rm(directory, { recursive: true, force: true }); });
  beforeEach(async () => {
    vi.mocked(hhRunner.getState).mockReturnValue({ running: false } as ReturnType<typeof hhRunner.getState>);
    vi.mocked(hhRunner.inspectOwnResume).mockResolvedValue({ parsed: { fields: {}, notes: [] }, accountId: "fixture-owner" });
    const client = db.client!;
    await client.conversation.deleteMany();
    await client.application.deleteMany(); await client.vacancy.deleteMany(); await client.log.deleteMany();
    await client.searchKeyword.deleteMany(); await client.seenVacancy.deleteMany(); await client.setting.deleteMany();
    await client.setting.create({ data: { id: 1, name: "Бухгалтер", city: "Казань", resumeText: "Желаемая должность: Бухгалтер", activeSearchBatchId: "first" } });
    await client.setting.create({ data: { id: 2, name: "Водитель", city: "Москва", resumeText: "Желаемая должность: Водитель", activeSearchBatchId: "second" } });
    await client.appState.upsert({ where: { id: 1 }, create: { id: 1 }, update: { activeProfileId: 1 } });
    await client.searchKeyword.createMany({ data: [{ profileId: 1, value: "Бухгалтер" }, { profileId: 2, value: "Водитель" }] });
    for (const profileId of [1, 2]) {
      const vacancy = await client.vacancy.create({ data: { profileId, title: "Вакансия " + profileId, company: "Компания", url: "https://hh.ru/vacancy/123", status: profileId === 1 ? "applied" : "pending", searchBatchId: profileId === 1 ? "first" : "second", matchScore: profileId * 30 } });
      if (profileId === 1) await client.application.create({ data: { vacancyId: vacancy.id, status: "applied", appliedAt: new Date() } });
      await writeLog("info", "Лог " + profileId, undefined, profileId);
      await client.seenVacancy.create({ data: { profileId, url: vacancy.url } });
    }
  });

  it("allows the same URL and keyword in different profiles and scopes every dashboard statistic", async () => {
    const client = db.client!;
    await client.searchKeyword.create({ data: { profileId: 2, value: "Бухгалтер" } });
    const first = await dashboardData();
    expect(first).toMatchObject({ vacanciesFound: 1, appliedToday: 1, pending: 0, skipped: 0, failed: 0 });
    expect(first.activity.logs.map((row) => row.message)).toEqual(["Лог 1"]);
    await client.appState.update({ where: { id: 1 }, data: { activeProfileId: 2 } });
    expect(await dashboardData()).toMatchObject({ vacanciesFound: 1, appliedToday: 0, pending: 1, settings: { name: "Водитель", city: "Москва" } });
    expect((await listVacancies(new URLSearchParams("status=all&latest=true"))).vacancies[0]).toMatchObject({ matchScore: 60, title: "Вакансия 2" });
    expect((await listLogs(new URLSearchParams())).logs.map((row) => row.message)).toEqual(["Лог 2"]);
  });

  it("saves only the active resume's settings and keywords", async () => {
    expect((await settings(request("/api/settings", { profileId: 1, keywords: "Повар", city: "Пермь", resumeText: "Повар" }, "PUT"))).status).toBe(200);
    expect(await ensureSettings(1)).toMatchObject({ city: "Пермь", keywords: [{ value: "Повар" }] });
    expect(await ensureSettings(2)).toMatchObject({ city: "Москва", keywords: [{ value: "Водитель" }] });
    await saveImportedResume("https://hh.ru/resume/test", "Желаемая должность: Менеджер", 2);
    expect((await ensureSettings(1)).resumeText).toBe("Повар");
    expect((await ensureSettings(2)).resumeText).toContain("Менеджер");
  });

  it("starts a neutral profile and preserves every previous profile's history", async () => {
    const next = await createProfile("Повар", "https://hh.ru/resume/cook", false);
    expect(await activeProfileId()).toBe(next.id);
    expect(await ensureSettings()).toMatchObject({ name: "Повар", resumeText: "", keywords: [], activeSearchBatchId: null });
    expect(await dashboardData()).toMatchObject({ vacanciesFound: 0, appliedToday: 0, pending: 0 });
    expect(await db.client!.application.count()).toBe(1);
    expect((await listProfiles()).profiles).toHaveLength(3);
  });

  it("copies only chosen search preferences, never resume text, letters, queues or history", async () => {
    await db.client!.setting.update({ where: { id: 1 }, data: { minSalary: 150000, coverLetterTemplate: "Личное письмо", excludedWords: "стажёр" } });
    const next = await createProfile("Другой профиль", null, true);
    expect(await ensureSettings(next.id)).toMatchObject({ city: "Казань", minSalary: 150000, excludedWords: "стажёр", keywords: [{ value: "Бухгалтер" }], resumeText: "", resumeUrl: null, activeSearchBatchId: null });
    expect((await ensureSettings(next.id)).coverLetterTemplate).not.toBe("Личное письмо");
    expect(await db.client!.vacancy.count({ where: { profileId: next.id } })).toBe(0);
  });

  it("switches profiles and derives their names from resume titles", async () => {
    expect((await profiles(request("/api/profiles", { action: "switch", profileId: 1, id: 2 }))).status).toBe(200);
    expect(await activeProfileId()).toBe(2);
    expect(hhRunner.resetProfileState).toHaveBeenCalled();
    expect((await listProfiles()).profiles.map((profile) => profile.name)).toEqual(["Бухгалтер", "Водитель"]);
    expect((await profiles(request("/api/profiles", { action: "rename", profileId: 2, name: "Ручное имя" }))).status).toBe(400);
  });

  it("adds a resume by link without a manually supplied profile name", async () => {
    const response = await profiles(request("/api/profiles", { action: "create", profileId: 1, resumeUrl: "https://hh.ru/resume/newresume" }));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.activeId).toBe(3);
    expect(await ensureSettings()).toMatchObject({ resumeUrl: "https://hh.ru/resume/newresume", resumeText: "" });
    await saveImportedResume("https://hh.ru/resume/newresume", "Желаемая должность: Медицинская сестра", 3);
    expect((await listProfiles()).profiles.at(-1)?.name).toBe("Медицинская сестра");
    expect((await profiles(request("/api/profiles", { action: "create", profileId: 3, resumeUrl: "https://hh.ru/resume/newresume?from=profile" }))).status).toBe(409);
  });

  it("refuses profile changes during a run, nested mutations and stale settings", async () => {
    vi.mocked(hhRunner.getState).mockReturnValue({ running: true } as ReturnType<typeof hhRunner.getState>);
    expect((await profiles(request("/api/profiles", { action: "switch", id: 2 }))).status).toBe(409);
    expect(await activeProfileId()).toBe(1);
    vi.mocked(hhRunner.getState).mockReturnValue({ running: false } as ReturnType<typeof hhRunner.getState>);
    await withProfileChange(async () => {
      expect((await profiles(request("/api/profiles", { action: "switch", id: 2 }))).status).toBe(409);
    });
    expect((await settings(request("/api/settings", { profileId: 2, city: "Чужие правки" }, "PUT"))).status).toBe(409);
    expect((await ensureSettings()).city).toBe("Казань");
  });

  it("does not mutate another resume's rows through bulk, single-row or log actions", async () => {
    const foreign = await db.client!.vacancy.findFirstOrThrow({ where: { profileId: 2 } });
    for (const action of ["skip", "queue", "delete"]) {
      const response = await bulk(request("/api/vacancies/bulk", { action, ids: [foreign.id], profileId: 1 }));
      expect(await response.json()).toMatchObject({ changed: 0 });
    }
    const context = { params: Promise.resolve({ id: String(foreign.id) }) };
    expect((await skipVacancy(request("/", {}), context)).status).toBe(404);
    expect((await removeVacancy(request("/", {}, "DELETE"), context)).status).toBe(404);
    const foreignLog = await db.client!.log.findFirstOrThrow({ where: { profileId: 2 } });
    expect(await (await logs(request("/api/logs", { ids: [foreignLog.id], profileId: 1 }, "DELETE"))).json()).toEqual({ deleted: 0 });
    await logs(request("/api/logs", { allMatching: true, filters: { level: "all" }, profileId: 1 }, "DELETE"));
    expect(await db.client!.log.count({ where: { profileId: 2 } })).toBe(1);
  });
  it("adds and removes a short stop-phrase only in the active resume", async () => {
    const vacancy = await db.client!.vacancy.findFirstOrThrow({ where: { profileId: 1 } });
    const response = await exclusions(request("/api/settings/exclusions", { action: "add", word: "холодные звонки", vacancyId: vacancy.id, profileId: 1 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ words: ["холодные звонки"] });
    expect((await ensureSettings(2)).excludedWords).toBe("");
    expect((await db.client!.vacancy.findUniqueOrThrow({ where: { id: vacancy.id } })).status).toBe("applied");
    const removed = await exclusions(request("/api/settings/exclusions", { action: "remove", word: "Холодные звонки", profileId: 1 }));
    expect(await removed.json()).toEqual({ words: [] });
    expect((await exclusions(request("/api/settings/exclusions", { action: "add", word: "слово", profileId: 2 }))).status).toBe(409);
  });
  it("rejects a foreign resume before creating a profile or changing the active one", async () => {
    vi.mocked(hhRunner.inspectOwnResume).mockRejectedValueOnce(new Error("Резюме не принадлежит текущему аккаунту"));
    expect((await profiles(request("/api/profiles", { action: "create", resumeUrl: "https://hh.ru/resume/foreign", profileId: 1 }))).status).toBe(409);
    expect((await listProfiles()).profiles).toHaveLength(2);
    expect(await activeProfileId()).toBe(1);
  });
  it("keeps inbox messages private to the connected HH account and filters by outcome and resume", async () => {
    const row = { externalId: "vacancy:1", vacancyUrl: "https://hh.ru/vacancy/123", vacancyTitle: "Врач", company: "Клиника", resumeId: "resume-one", statusLabel: "Приглашение", unread: true, lastMessage: "Приглашаем вас на собеседование", messages: [{ id: "m1", text: "Приглашаем вас на собеседование", author: "employer" as const, at: null }], hhUrl: "https://hh.ru/applicant/negotiations", lastMessageAt: null };
    await db.client!.setting.update({ where: { id: 1 }, data: { resumeUrl: "https://hh.ru/resume/resume-one" } });
    await saveConversation("fixture-owner", row);
    await saveConversation("different-account", { ...row, company: "Чужая компания" });
    await saveConversation("fixture-owner", { ...row, externalId: "vacancy:2", resumeId: "different-resume", statusLabel: "Отказ", unread: false, company: "Лаборатория" });
    const all = await inboxData(new URLSearchParams());
    expect(all.total).toBe(2); expect(all.stats).toEqual({ all: 2, positive: 1, negative: 1, unread: 1 });
    expect(all.conversations.every((conversation) => conversation.company !== "Чужая компания")).toBe(true);
    expect((await inboxData(new URLSearchParams("scope=profile"))).total).toBe(1);
    expect((await inboxData(new URLSearchParams("outcome=negative&q=лаборатория"))).conversations[0].company).toBe("Лаборатория");
    await saveConversation("fixture-owner", { ...row, lastMessage: "Обновлённый ответ" });
    expect(await db.client!.conversation.count({ where: { accountId: "fixture-owner" } })).toBe(2);
  });
});
