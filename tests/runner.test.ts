import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Vacancy } from "@/generated/prisma/client";
import { HHRunner } from "@/lib/hh/runner";
import { HHAutomationError, HHPlaywrightService } from "@/lib/hh/playwright";
import { prisma } from "@/lib/prisma";
import { ensureSettings, saveImportedResume } from "@/lib/settings";
import type { Page } from "playwright";
import * as account from "@/lib/hh/account";
import { writeLog } from "@/lib/log";

vi.mock("@/lib/log", () => ({ writeLog: vi.fn() }));
vi.mock("@/lib/settings", () => ({ ensureSettings: vi.fn(), saveImportedResume: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: {
  setting: { update: vi.fn() },
  vacancy: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), update: vi.fn() },
  application: { count: vi.fn(), create: vi.fn() },
  $transaction: vi.fn((operations: Promise<unknown>[]) => Promise.all(operations))
} }));

const vacancy: Vacancy = {
  profileId: 1, id: 1, title: "Frontend React", company: "Example", description: "Разработка", url: "https://hh.ru/vacancy/123",
  externalId: "123", salary: null, city: null, status: "pending", matchScore: 80,
  searchBatchId: "latest", createdAt: new Date(), updatedAt: new Date()
};

const settings: Awaited<ReturnType<typeof ensureSettings>> = {
  hhAccountId: null, resumeVerifiedAt: null, name: "Основное резюме", id: 1, city: "Москва", minSalary: null, coverLetterTemplate: "Здравствуйте", resumeText: "React", resumeUrl: "https://hh.ru/resume/test",
  excludedWords: "junior", excludedDescriptionWords: "", browserHeadless: true, dailyLimit: 5, searchLimit: 50, searchAllRussia: false, remoteOnly: false,
  activeSearchBatchId: "latest", searchDelayMinSeconds: 0, searchDelayMaxSeconds: 0, applyDelayMinSeconds: 0, applyDelayMaxSeconds: 0,
  createdAt: new Date(), updatedAt: new Date(), keywords: []
};

describe("application orchestration", () => {
  const automation = {
    close: vi.fn(async () => undefined),
    getBrowserView: vi.fn<HHPlaywrightService["getBrowserView"]>(),
    sendBrowserInput: vi.fn<HHPlaywrightService["sendBrowserInput"]>(),
    sendCaptchaInput: vi.fn<HHPlaywrightService["sendCaptchaInput"]>(),
    reloadLoginPage: vi.fn<HHPlaywrightService["reloadLoginPage"]>(),
    setCaptchaHandler: vi.fn<HHPlaywrightService["setCaptchaHandler"]>(),
    completeApplicationManually: vi.fn<HHPlaywrightService["completeApplicationManually"]>(),
    ensureAuthorized: vi.fn<HHPlaywrightService["ensureAuthorized"]>(),
    applyToVacancy: vi.fn<HHPlaywrightService["applyToVacancy"]>(),
    verifyResumeOwnership: vi.fn<HHPlaywrightService["verifyResumeOwnership"]>(),
    importResumeData: vi.fn<HHPlaywrightService["importResumeData"]>()
  };
  let runner: HHRunner;

  beforeEach(() => {
    vi.clearAllMocks();
    automation.verifyResumeOwnership.mockResolvedValue({ accountId: "fixture-account", resumeId: "test", title: "Резюме", uniqueTitle: true });
    vi.mocked(prisma.vacancy.findFirst).mockResolvedValue(null);
    automation.ensureAuthorized.mockReset();
    automation.importResumeData.mockReset();
    automation.getBrowserView.mockReturnValue({ available: true, pageId: "test-page", url: vacancy.url });
    automation.completeApplicationManually.mockReset();
    runner = new HHRunner(automation as unknown as HHPlaywrightService);
    vi.mocked(ensureSettings).mockResolvedValue({ ...settings });
    vi.mocked(prisma.vacancy.findUnique).mockResolvedValue(vacancy);
    vi.mocked(prisma.vacancy.findMany).mockResolvedValue([vacancy]);
    vi.mocked(prisma.application.count).mockResolvedValue(0);
    automation.applyToVacancy.mockResolvedValue({ alreadyApplied: false, selectedResume: "Frontend React", coverLetterDelivery: "form" });
  });

  it("parses a resume into a preview without persisting any settings or search keywords", async () => {
    automation.importResumeData.mockResolvedValue({ position: "Повар", city: "Казань", salary: "90000 руб.", workFormat: "На месте работодателя", text: "Желаемая должность: Повар\nОпыт работы в ресторане" });
    const result = await runner.parseResume("https://hh.ru/resume/test");
    expect(result.parsed.fields).toMatchObject({ keywords: "Повар", city: "Казань", minSalary: 90000, remoteOnly: false });
    expect(saveImportedResume).not.toHaveBeenCalled();
    expect(ensureSettings).not.toHaveBeenCalled();
    expect(prisma.vacancy.update).not.toHaveBeenCalled();
    expect(prisma.application.create).not.toHaveBeenCalled();
    expect(automation.close).toHaveBeenCalledTimes(1);
    expect(result.state.running).toBe(false);
  });

  it("rechecks current exclusions for saved vacancies before manual apply", async () => {
    vi.mocked(ensureSettings).mockResolvedValue({ ...settings, excludedDescriptionWords: "разработка" });
    const state = await runner.applyVacancy(1);
    expect(automation.applyToVacancy).not.toHaveBeenCalled();
    expect(prisma.vacancy.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: "skipped" } });
    expect(prisma.application.create).not.toHaveBeenCalled();
    expect(state.processed).toBe(0);
    expect(writeLog).toHaveBeenCalledWith("info", expect.stringContaining("описание: разработка"), expect.objectContaining({ url: vacancy.url, matches: expect.objectContaining({ description: ["разработка"] }) }));
  });

  it("explains when a search result does not match any configured query", async () => {
    const result = await runner["saveVacancies"]([vacancy], { keywords: ["директор"], excludedWords: { title: [], description: [] }, searchBatchId: "search-test" });
    expect(result).toBe(0);
    expect(writeLog).toHaveBeenCalledWith("info", expect.stringContaining("ни один поисковый запрос не совпал"), expect.objectContaining({ url: vacancy.url, keywords: ["директор"], searchBatchId: "search-test" }));
  });

  it("marks fresh description exclusions skipped rather than failed", async () => {
    automation.applyToVacancy.mockRejectedValueOnce(new HHAutomationError("excluded", "junior"));
    await runner.applyVacancy(1);
    expect(prisma.vacancy.update).toHaveBeenLastCalledWith({ where: { id: 1 }, data: { status: "skipped" } });
    expect(prisma.application.create).not.toHaveBeenCalled();
  });

  it("restricts auto apply to the latest batch and does not spend the target on rejected vacancies", async () => {
    vi.mocked(prisma.vacancy.findMany).mockResolvedValue([{ ...vacancy, id: 2, title: "Junior" }, vacancy]);
    vi.mocked(prisma.vacancy.findUnique).mockResolvedValueOnce({ ...vacancy, id: 2, title: "Junior" }).mockResolvedValueOnce(vacancy);
    await runner.startAutoApply({ limit: 1 });
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    expect(prisma.vacancy.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { profileId: 1, status: { in: ["found", "pending"] }, searchBatchId: "latest" }
    }));
    expect(automation.applyToVacancy).toHaveBeenCalledTimes(1);
    expect(runner.getState().processed).toBe(1);
    expect(automation.close).toHaveBeenCalled();
  });

  it("enforces the daily limit on manual apply too", async () => {
    vi.mocked(prisma.application.count).mockResolvedValue(5);
    await expect(runner.applyVacancy(1)).rejects.toMatchObject({ code: "stopped" });
    expect(automation.applyToVacancy).not.toHaveBeenCalled();
    expect(runner.getState().running).toBe(false);
  });
  it("uses the selected profile for the queue, daily statistics and the submitted resume", async () => {
    vi.mocked(ensureSettings).mockResolvedValue({ ...settings, id: 2, resumeUrl: "https://hh.ru/resume/second" });
    vi.mocked(prisma.vacancy.findUnique).mockResolvedValue({ ...vacancy, profileId: 2 });
    await runner.startAutoApply({ limit: 1 });
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    expect(prisma.vacancy.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ profileId: 2 }) }));
    expect(prisma.vacancy.findUnique).toHaveBeenCalledWith({ where: { id: 1, profileId: 2 } });
    expect(prisma.application.count).toHaveBeenCalledWith({ where: expect.objectContaining({ vacancy: { profileId: 2 } }) });
    expect(automation.applyToVacancy.mock.calls[0][4]).toMatchObject({ preferredResumeUrl: "https://hh.ru/resume/second", requirePreferredResume: true });
  });
  it("skips an application already sent from another profile", async () => {
    vi.mocked(prisma.vacancy.findFirst).mockResolvedValue({ ...vacancy, profileId: 2 });
    await runner.applyVacancy(1);
    expect(automation.applyToVacancy).not.toHaveBeenCalled();
    expect(prisma.application.create).not.toHaveBeenCalled();
    expect(prisma.vacancy.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: "skipped" } });
  });

  it("limits a selected-vacancy run to explicit ids even without a latest search batch", async () => {
    vi.mocked(ensureSettings).mockResolvedValue({ ...settings, activeSearchBatchId: null });
    const selected = { ...vacancy, id: 42 };
    vi.mocked(prisma.vacancy.findMany).mockResolvedValue([selected]);
    vi.mocked(prisma.vacancy.findUnique).mockResolvedValue(selected);
    await runner.startAutoApply({ limit: 1, vacancyIds: [42] });
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    expect(prisma.vacancy.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { profileId: 1, id: { in: [42] }, status: { in: ["found", "pending", "failed"] } } }));
    expect(automation.applyToVacancy.mock.calls[0][0].id).toBe(42);
    expect(runner.getState().processed).toBe(1);
  });

  it("requires a search batch before auto apply", async () => {
    vi.mocked(ensureSettings).mockResolvedValue({ ...settings, activeSearchBatchId: null });
    await runner.startAutoApply({ limit: 1 });
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    expect(prisma.vacancy.findMany).not.toHaveBeenCalled();
    expect(automation.applyToVacancy).not.toHaveBeenCalled();
  });

  it("persists a successful application and its vacancy status in one transaction", async () => {
    const state = await runner.applyVacancy(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.application.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "applied" }) }));
    expect(state.processed).toBe(1);
  });

  it("marks an already-applied vacancy applied and immediately advances to the next without manual waiting", async () => {
    const next = { ...vacancy, id: 2, url: "https://hh.ru/vacancy/456" };
    vi.mocked(prisma.vacancy.findMany).mockResolvedValue([vacancy, next]);
    vi.mocked(prisma.vacancy.findUnique).mockResolvedValueOnce(vacancy).mockResolvedValueOnce(next);
    automation.applyToVacancy.mockResolvedValueOnce({ alreadyApplied: true, coverLetterDelivery: "none" });
    await runner.startAutoApply({ limit: 1 });
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    expect(prisma.vacancy.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: "applied" } });
    expect(prisma.application.create).toHaveBeenCalledWith({ data: expect.objectContaining({ vacancyId: 1, status: "applied", appliedAt: null }) });
    expect(automation.applyToVacancy).toHaveBeenCalledTimes(2);
    expect(automation.applyToVacancy.mock.calls[1][0].id).toBe(2);
    expect(automation.completeApplicationManually).not.toHaveBeenCalled();
    expect(runner.getState().processed).toBe(1);
  });

  it.each(["archived", "unavailable", "requirements"] as const)("marks %s vacancies skipped and continues to the next without consuming the target or opening manual recovery", async (code) => {
    const next = { ...vacancy, id: 2, url: "https://hh.ru/vacancy/456" };
    vi.mocked(prisma.vacancy.findMany).mockResolvedValue([vacancy, next]);
    vi.mocked(prisma.vacancy.findUnique).mockResolvedValueOnce(vacancy).mockResolvedValueOnce(next);
    automation.applyToVacancy.mockRejectedValueOnce(new HHAutomationError(code, "Вакансия недоступна или в архиве"));
    await runner.startAutoApply({ limit: 1, skipAdditionalRequirements: code === "requirements" });
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    expect(prisma.vacancy.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { status: "skipped" } });
    expect(prisma.application.create).toHaveBeenCalledTimes(1);
    expect(prisma.application.create).toHaveBeenCalledWith({ data: expect.objectContaining({ vacancyId: 2, status: "applied" }) });
    expect(automation.applyToVacancy).toHaveBeenCalledTimes(2);
    expect(automation.applyToVacancy.mock.calls[0][4]?.skipAdditionalRequirements).toBe(code === "requirements");
    expect(automation.completeApplicationManually).not.toHaveBeenCalled();
    expect(runner.getState().processed).toBe(1);
  });

  it("allows embedded input during a manual pause and rejects stale or autonomous input", async () => {
    let finish!: (result: Awaited<ReturnType<HHPlaywrightService["applyToVacancy"]>>) => void;
    automation.applyToVacancy.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await runner.startAutoApply({ limit: 1 });
    await vi.waitFor(() => expect(automation.applyToVacancy).toHaveBeenCalled());
    await expect(runner.sendBrowserInput("test-page", 0, { type: "text", text: "blocked" })).rejects.toThrow("недоступно");
    const pause = automation.setCaptchaHandler.mock.calls[0][0];
    pause(true);
    const id = runner.getState().manualPauseId;
    await runner.sendBrowserInput("test-page", id, { type: "text", text: "human input" });
    expect(automation.sendCaptchaInput).toHaveBeenCalledWith({ type: "text", text: "human input" });
    expect(automation.sendBrowserInput).not.toHaveBeenCalled();
    pause(false);
    pause(true);
    await expect(runner.sendBrowserInput("test-page", id, { type: "continue" })).rejects.toThrow("недоступно");
    await expect(runner.sendBrowserInput("stale-page", id + 1, { type: "text", text: "stale" })).rejects.toThrow("недоступно");
    pause(false);
    finish({ alreadyApplied: false, coverLetterDelivery: "none" });
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
  });

  it("allows embedded login input without a CAPTCHA pause", async () => {
    let finish!: (page: Page) => void;
    automation.ensureAuthorized.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    runner.startLogin();
    await runner.sendBrowserInput("test-page", 0, { type: "text", text: "human login" });
    expect(automation.sendBrowserInput).toHaveBeenCalledWith("test-page", { type: "text", text: "human login" });
    finish({} as Page);
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    await expect(runner.sendBrowserInput("test-page", 0, { type: "text", text: "late login" })).rejects.toThrow("недоступно");
  });

  it("refuses logout during a job and clears the local session only after it is idle", async () => {
    const clear = vi.spyOn(account, "clearHHAccount").mockResolvedValue();
    try {
      let finish!: (page: Page) => void;
      automation.ensureAuthorized.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
      runner.startLogin();
      await expect(runner.logout()).rejects.toThrow("Уже запущен процесс");
      expect(clear).not.toHaveBeenCalled();
      finish({} as Page);
      await vi.waitFor(() => expect(runner.getState().running).toBe(false));
      await runner.logout();
      expect(clear).toHaveBeenCalledTimes(1);
      expect(runner.getState()).toMatchObject({ running: false, mode: "idle" });
    } finally { clear.mockRestore(); }
  });

  it("keeps a failed login window open", async () => {
    automation.ensureAuthorized.mockRejectedValueOnce(new HHAutomationError("auth", "Вход не подтверждён"));
    runner.startLogin();
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    expect(automation.close).not.toHaveBeenCalled();
    expect(runner.getState().lastError).toContain("Вход не подтверждён");
  });

  it("waits for login confirmation before closing the window", async () => {
    let confirm!: (page: Page) => void;
    automation.ensureAuthorized.mockImplementationOnce((_stop, _interactive, onProgress) => {
      onProgress?.("Ожидаю ручной вход");
      return new Promise((resolve) => { confirm = resolve; });
    });
    runner.startLogin();
    expect(runner.getState().running).toBe(true);
    expect(runner.getState().message).toBe("Ожидаю ручной вход");
    expect(automation.close).not.toHaveBeenCalled();
    confirm({} as Page);
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    expect(automation.close).toHaveBeenCalledTimes(1);
    expect(runner.getState().processed).toBe(1);
  });

  it("closes login only when explicitly stopped", async () => {
    let cancel!: (error: Error) => void;
    automation.ensureAuthorized.mockImplementationOnce(() => new Promise((_resolve, reject) => { cancel = reject; }));
    runner.startLogin();
    runner.stop();
    cancel(new HHAutomationError("stopped", "Остановлено пользователем"));
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    expect(automation.close).toHaveBeenCalledTimes(1);
  });

  it("keeps the active auto apply job and progress while waiting for the human, then continues once", async () => {
    const onCaptcha = automation.setCaptchaHandler.mock.calls[0][0];
    let resume!: () => void;
    automation.applyToVacancy.mockImplementationOnce(async () => {
      onCaptcha(true);
      await new Promise<void>((resolve) => { resume = resolve; });
      onCaptcha(false);
      return { alreadyApplied: false, selectedResume: "Frontend React", coverLetterDelivery: "form" };
    });
    await runner.startAutoApply({ limit: 1 });
    await vi.waitFor(() => expect(runner.getState().waitingForCaptcha).toBe(true));
    expect(runner.getState()).toMatchObject({ running: true, mode: "auto", processed: 0, target: 1 });
    expect(automation.close).not.toHaveBeenCalled();
    expect(prisma.application.create).not.toHaveBeenCalled();
    resume();
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    expect(runner.getState()).toMatchObject({ waitingForCaptcha: false, processed: 1 });
    expect(prisma.application.create).toHaveBeenCalledTimes(1);
    expect(automation.applyToVacancy).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("does not skip an unfamiliar form without recognized requirements (skip setting: %s)", async (skipAdditionalRequirements) => {
    const onManual = automation.setCaptchaHandler.mock.calls[0][0];
    let finish!: () => void;
    const second = { ...vacancy, id: 2, url: "https://hh.ru/vacancy/456" };
    vi.mocked(prisma.vacancy.findMany).mockResolvedValue([vacancy, second]);
    vi.mocked(prisma.vacancy.findUnique).mockResolvedValueOnce(vacancy).mockResolvedValueOnce(second);
    automation.applyToVacancy.mockRejectedValueOnce(new Error("Неизвестная форма HH"));
    automation.completeApplicationManually.mockImplementationOnce(async () => {
      onManual(true, { reason: "form", message: "Ждём пользователя" });
      await new Promise<void>((resolve) => { finish = resolve; });
      onManual(false);
      return { alreadyApplied: false, coverLetterDelivery: "none" };
    });
    await runner.startAutoApply({ limit: 2, skipAdditionalRequirements });
    await vi.waitFor(() => expect(runner.getState().waitingForUser).toBe(true));
    expect(runner.getState()).toMatchObject({ processed: 0, running: true, manualActionReason: "form" });
    expect(automation.applyToVacancy).toHaveBeenCalledTimes(1);
    expect(prisma.vacancy.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.application.create).not.toHaveBeenCalled();
    expect(automation.close).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(runner.getState().running).toBe(false));
    expect(automation.applyToVacancy).toHaveBeenCalledTimes(2);
    expect(prisma.application.create).toHaveBeenCalledTimes(2);
    expect(runner.getState().processed).toBe(2);
  });
});
