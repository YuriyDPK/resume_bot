import { randomUUID } from "node:crypto";
import { HHAutomationError, HHPlaywrightService, type ScrapedVacancy } from "@/lib/hh/playwright";
import { writeLog } from "@/lib/log";
import { buildSearchQueries, calculateMatchScore, isRelevantVacancy, parseExcludedWords, vacancyHasExcludedWords } from "@/lib/matching";
import { prisma } from "@/lib/prisma";
import { ensureSettings, saveImportedResume } from "@/lib/settings";
import { findExcludedWords } from "@/lib/vacancy-filter";
import type { CaptchaInput } from "@/lib/hh/captcha";
import { parseResumeSettings } from "@/lib/resume-parser";
import type { AutoApplyOptions } from "@/lib/hh/types";
import { clearHHAccount } from "@/lib/hh/account";
import { profileChangePending } from "@/lib/profiles";
import { saveConversation } from "@/lib/inbox-store";
import { dayStart } from "@/lib/list-filters";

export type RunnerMode = "idle" | "login" | "search" | "resume" | "apply" | "auto" | "inbox";

export type RunnerState = {
  profileId?: number;
  running: boolean;
  mode: RunnerMode;
  stopRequested: boolean;
  waitingForCaptcha: boolean;
  waitingForUser: boolean;
  manualPauseId: number;
  manualActionReason?: "captcha" | "form";
  message: string;
  processed: number;
  target: number;
  skipAdditionalRequirements?: boolean;
  startedAt?: string;
  lastError?: string;
};

const idleState: RunnerState = {
  running: false,
  mode: "idle",
  stopRequested: false,
  waitingForCaptcha: false,
  waitingForUser: false,
  manualPauseId: 0,
  message: "Готов к работе",
  processed: 0,
  target: 0
};

function startOfToday() {
  return dayStart();
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Неизвестная ошибка";
}

// Bump after runner/browser changes so dev updates apply safely between jobs.
const RUNNER_REVISION = "2026-10-28-inbox-and-ownership-v3";

export class HHRunner {
  readonly runtimeRevision = RUNNER_REVISION;
  readonly supportsSelectedVacancies = true;
  readonly supportsResumeProfiles = true;
  readonly supportsVerifiedResumes = true;
  private verifiedResume?: string;
  private verifiedOwner?: { accountId: string; title: string; uniqueTitle: boolean };
  private profileId?: number;
  private async settings() {
    const settings = await ensureSettings(this.profileId);
    this.profileId = settings.id;
    this.state.profileId = settings.id;
    return settings;
  }
  constructor(private automation = new HHPlaywrightService()) {
    let previousMessage = "";
    this.automation.setCaptchaHandler?.((waiting, details) => {
      if (waiting) previousMessage = this.state.message;
      this.state = {
        ...this.state,
        waitingForCaptcha: waiting && !details,
        waitingForUser: waiting,
        manualPauseId: this.state.manualPauseId + (waiting ? 1 : 0),
        manualActionReason: waiting ? details ? "form" : "captcha" : undefined,
        message: waiting ? details?.message ?? "Ожидаю CAPTCHA. После решения нажмите «Проверить и продолжить» в интерфейсе бота" :
          this.state.stopRequested ? this.state.message : previousMessage
      };
      void writeLog("info", waiting ? "Очередь заблокирована до ручного подтверждения" : "Ручное ожидание завершено", details);
    });
  }
  private state: RunnerState = { ...idleState };
  private loginSession = false;
  private browserInputs: Promise<void> = Promise.resolve();

  getState() {
    return { ...this.state };
  }

  resetProfileState() {
    this.assertFree();
    this.profileId = undefined;
    this.state = { ...idleState };
  }

  getCaptchaScreenshot() { return this.state.waitingForUser ? this.automation.getCaptchaScreenshot() : Promise.resolve(null); }
  sendCaptchaInput(input: CaptchaInput) {
    if (!this.state.waitingForUser || this.state.stopRequested) throw new Error("Проверка HH сейчас не ожидается");
    return this.automation.sendCaptchaInput(input);
  }

  getBrowserView() {
    const view = this.automation.getBrowserView();
    return { ...view, state: this.getState(), login: this.loginSession, interactive: view.available && !this.state.stopRequested &&
      (this.state.waitingForUser || this.loginSession) };
  }

  getBrowserFrame() { return this.automation.getBrowserFrame(); }

  sendBrowserInput(pageId: string, pauseId: number, input: CaptchaInput | { type: "reload" }) {
    const action = this.browserInputs.then(async () => {
      if (!this.getBrowserView().interactive || this.state.manualPauseId !== pauseId || this.automation.getBrowserView().pageId !== pageId) {
        throw new Error("Управление HH сейчас недоступно. Дождитесь ручной проверки или входа");
      }
      if (input.type === "reload") {
        if (!this.loginSession || this.state.waitingForUser) throw new Error("Перезагрузка доступна только при входе в HH");
        await this.automation.reloadLoginPage(pageId);
      } else if (this.state.waitingForUser) await this.automation.sendCaptchaInput(input);
      else if (input.type === "continue") throw new Error("HH подтвердит вход автоматически");
      else await this.automation.sendBrowserInput(pageId, input);
    });
    this.browserInputs = action.catch(() => undefined);
    return action;
  }

  private assertFree() {
    if (this.state.running) {
      throw new Error("Уже запущен процесс: " + this.state.message);
    }
  }

  private start(mode: RunnerMode, message: string, target = 0) {
    this.assertFree();
    if (profileChangePending()) throw new Error("Дождитесь завершения переключения резюме");
    this.profileId = undefined;
    this.verifiedResume = undefined;
    this.verifiedOwner = undefined;
    this.loginSession = mode === "login";
    this.state = {
      running: true,
      mode,
      stopRequested: false,
      waitingForCaptcha: false,
      waitingForUser: false,
      manualPauseId: this.state.manualPauseId,
      message,
      processed: 0,
      target,
      startedAt: new Date().toISOString()
    };
  }

  private async finish(message: string, lastError?: string, closeBrowser = true) {
    if (closeBrowser) {
      this.loginSession = false;
      await this.automation.close();
    }
    this.state = {
      ...this.state,
      running: false,
      mode: "idle",
      stopRequested: false,
      waitingForCaptcha: false,
      waitingForUser: false,
      manualActionReason: undefined,
      message,
      lastError
    };
  }

  stop() {
    if (!this.state.running) {
      return this.getState();
    }

    this.state = {
      ...this.state,
      stopRequested: true,
      message: "Останавливаю после текущего безопасного шага"
    };

    return this.getState();
  }

  async logout() {
    this.assertFree();
    await this.automation.close();
    await clearHHAccount();
    this.state = { ...idleState, message: "Вы вышли из HH. Можно войти заново" };
    return this.getState();
  }

  startLogin() {
    this.start("login", "Открываю HH для ручного входа", 1);
    void this.runLogin();
    return this.getState();
  }

  private async runLogin() {
    try {
      await this.automation.ensureAuthorized(() => this.state.stopRequested, true, (message) => {
        this.state.message = message;
      });
      this.state.processed = 1;
      await this.finish("Сессия HH сохранена");
    } catch (error) {
      const message = errorMessage(error);
      await writeLog("error", "Ошибка авторизации HH", { message });
      // Login failures must leave the user's window available for recovery.
      // Explicit Stop still closes it, without saving an unverified session.
      await this.finish("Вход остановлен: " + message, message, this.state.stopRequested);
    }
  }

  startSearch() {
    this.start("search", "Ищу новые вакансии на HH", 0);
    void this.runSearch();
    return this.getState();
  }

  private async runSearch() {
    let savedDuringSearch = 0;
    let activeBatchId: string | null = null;

    try {
      let settings = await this.settings();

      if (!settings.resumeText.trim() && settings.resumeUrl) {
        this.state.message = "Загружаю резюме перед поиском";
        const resumeText = await this.automation.importResumeText(settings.resumeUrl, () => this.state.stopRequested);
        await saveImportedResume(settings.resumeUrl, resumeText, this.profileId);
        settings = await this.settings();
      }

      const storedKeywords = settings.keywords.map((keyword) => keyword.value.trim()).filter(Boolean);
      const keywords = buildSearchQueries(storedKeywords, settings.resumeText);
      const excludedWords = parseExcludedWords(settings.excludedWords);

      if (keywords.length === 0) {
        throw new Error("Добавьте хотя бы одно ключевое слово в Settings");
      }

      this.state.target = settings.searchLimit;
      await prisma.setting.update({ where: { id: this.profileId! }, data: { activeSearchBatchId: null } });
      const [currentVacancies, seenVacancies] = await Promise.all([
        prisma.vacancy.findMany({ where: { profileId: this.profileId }, select: { url: true } }),
        prisma.seenVacancy.findMany({ where: { profileId: this.profileId }, select: { url: true } })
      ]);
      const knownUrls = Array.from(new Set([...currentVacancies, ...seenVacancies].map((vacancy) => vacancy.url)));
      const searchBatchId = randomUUID();
      activeBatchId = searchBatchId;
      const city = settings.searchAllRussia ? null : settings.city;
      const searchStats = {
        pages: 0,
        scraped: 0,
        accepted: 0,
        skippedKnown: 0,
        skippedCity: 0,
        skippedInvalid: 0,
        skippedRejected: 0
      };

      await writeLog("info", "Поиск запущен", {
        keywords,
        city,
        minSalary: settings.minSalary,
        searchLimit: settings.searchLimit,
        searchAllRussia: settings.searchAllRussia,
        remoteOnly: settings.remoteOnly,
        excludedWords,
        knownVacancies: knownUrls.length
      });

      await this.automation.searchVacancies({
        keywords,
        city,
        minSalary: settings.minSalary,
        allRussia: settings.searchAllRussia,
        remoteOnly: settings.remoteOnly,
        maxResults: settings.searchLimit,
        excludedUrls: knownUrls,
        excludedWords,
        delayRange: {
          minSeconds: settings.searchDelayMinSeconds ?? 1,
          maxSeconds: settings.searchDelayMaxSeconds ?? 3
        },
        stopRequested: () => this.state.stopRequested,
        onVacancy: async (vacancy) => {
          const saved = await this.saveVacancies([vacancy], {
            city,
            minSalary: settings.minSalary,
            resumeText: settings.resumeText,
            keywords: storedKeywords,
            excludedWords,
            searchBatchId
          });
          savedDuringSearch += saved;
          this.state.processed = savedDuringSearch;
          this.state.message = "Поиск: сохранено " + savedDuringSearch + " из " + settings.searchLimit;
          return saved > 0;
        },
        onPage: (progress) => {
          searchStats.pages += 1;
          searchStats.scraped += progress.scraped;
          searchStats.accepted += progress.accepted;
          searchStats.skippedKnown += progress.skippedKnown;
          searchStats.skippedCity += progress.skippedCity;
          searchStats.skippedInvalid += progress.skippedInvalid;
          searchStats.skippedRejected += progress.skippedRejected;

          if (progress.accepted > 0) return;
          this.state.message =
            "Поиск: сохранено " +
            savedDuringSearch +
            " из " +
            settings.searchLimit +
            ". Проверяю " +
            progress.keyword +
            ", стр. " +
            progress.page;
        }
      });

      const saved = savedDuringSearch;

      await prisma.setting.update({ where: { id: this.profileId! }, data: { activeSearchBatchId: searchBatchId } });

      this.state.processed = saved;
      await writeLog("info", "Поиск завершен", { saved, skippedKnown: knownUrls.length, searchStats, searchBatchId });
      if (saved === 0) {
        await this.finish(
          "Поиск завершен. Найдено новых вакансий: 0. HH-карточек проверено: " +
            searchStats.scraped +
            ", уже видели: " +
            searchStats.skippedKnown +
            ", не подошли по фильтрам: " +
            (searchStats.skippedCity + searchStats.skippedInvalid + searchStats.skippedRejected)
        );
        return;
      }

      await this.finish("Поиск завершен. Найдено новых вакансий: " + saved);
    } catch (error) {
      const message = errorMessage(error);
      const stoppedByUser = error instanceof HHAutomationError && error.code === "stopped";

      if (activeBatchId && savedDuringSearch > 0) {
        await prisma.setting.update({ where: { id: this.profileId! }, data: { activeSearchBatchId: activeBatchId } });
      }

      await writeLog(stoppedByUser ? "warn" : "error", "Поиск остановлен", { message, saved: savedDuringSearch, searchBatchId: activeBatchId });

      if (stoppedByUser && savedDuringSearch > 0) {
        await this.finish("Поиск остановлен. Сохранено вакансий: " + savedDuringSearch);
        return;
      }

      await this.finish("Поиск остановлен: " + message, message);
    }
  }

  private async saveVacancies(
    vacancies: ScrapedVacancy[],
    settings: {
      city?: string | null;
      minSalary?: number | null;
      resumeText?: string | null;
      keywords: string[];
      excludedWords: string[];
      searchBatchId: string;
    }
  ) {
    let saved = 0;

    for (const vacancy of vacancies) {
      if (!vacancy.url) {
        await writeLog("warn", "Вакансия пропущена: нет ссылки", { title: vacancy.title, externalId: vacancy.externalId });
        continue;
      }

      if (vacancyHasExcludedWords(vacancy, settings.excludedWords)) {
        await writeLog("info", "Вакансия пропущена по стоп-словам", { title: vacancy.title, url: vacancy.url });
        continue;
      }

      if (!isRelevantVacancy(vacancy, settings)) {
        await writeLog("info", "Вакансия пропущена: не по специальности", { title: vacancy.title, url: vacancy.url });
        continue;
      }

      const matchScore = calculateMatchScore(vacancy, settings);
      const existing = await prisma.vacancy.findUnique({ where: { profileId_url: { profileId: this.profileId!, url: vacancy.url } }, select: { id: true } });
      if (!existing) {
        await prisma.$transaction([
          prisma.seenVacancy.upsert({
            where: { profileId_url: { profileId: this.profileId!, url: vacancy.url } },
            create: { profileId: this.profileId!, url: vacancy.url, externalId: vacancy.externalId },
            update: {}
          }),
          prisma.vacancy.create({
            data: {
              profileId: this.profileId!,
              externalId: vacancy.externalId,
              title: vacancy.title,
              company: vacancy.company,
              salary: vacancy.salary,
              city: vacancy.city,
              description: vacancy.description,
              url: vacancy.url,
              matchScore,
              status: "pending",
              searchBatchId: settings.searchBatchId
            }
          })
        ]);
        saved += 1;
      }
    }

    return saved;
  }

  async parseResume(resumeUrl: string) {
    this.start("resume", "Разбираю резюме по ссылке HH", 1);
    try {
      const source = await this.automation.importResumeData(resumeUrl, () => this.state.stopRequested);
      const parsed = parseResumeSettings(source);
      this.state.processed = 1;
      await writeLog("info", "Резюме разобрано для проверки в настройках", { fields: Object.keys(parsed.fields) });
      await this.finish("Резюме разобрано. Проверьте поля в настройках и сохраните изменения");
      return { state: this.getState(), parsed };
    } catch (error) {
      const message = errorMessage(error);
      await writeLog("error", "Разбор резюме остановлен", { message });
      await this.finish("Разбор резюме остановлен: " + message, message);
      throw error;
    }
  }

  async inspectOwnResume(resumeUrl: string) {
    this.start("resume", "Проверяю владельца и читаю резюме HH", 1);
    try {
      const source = await this.automation.importResumeData(resumeUrl, () => this.state.stopRequested);
      if (!source.ownerAccountId) throw new HHAutomationError("auth", "HH не подтвердил владельца резюме");
      const parsed = parseResumeSettings(source);
      this.state.processed = 1;
      await this.finish("Своё резюме HH подтверждено");
      return { parsed, accountId: source.ownerAccountId };
    } catch (error) {
      await this.finish("Резюме не добавлено: " + errorMessage(error), errorMessage(error)); throw error;
    }
  }
  async verifyOwnResume(resumeUrl: string) {
    this.start("resume", "Проверяю, что резюме принадлежит вашему HH-аккаунту", 1);
    try {
      const owner = await this.automation.verifyResumeOwnership(resumeUrl, () => this.state.stopRequested);
      this.state.processed = 1; await this.finish("Владелец резюме подтверждён"); return owner;
    } catch (error) { await this.finish(errorMessage(error), errorMessage(error)); throw error; }
  }

  startInboxSync() {
    this.start("inbox", "Читаю ответы и чаты HH", 100);
    void this.runInboxSync(); return this.getState();
  }
  private async runInboxSync() {
    try {
      const count = await this.automation.syncInbox(() => this.state.stopRequested, async (accountId, conversation) => {
        await saveConversation(accountId, conversation);
        this.state.processed += 1; this.state.message = "Загружено ответов: " + this.state.processed;
      });
      this.state.target = count;
      await this.finish("Ответы HH обновлены: " + count);
    } catch (error) {
      if (error instanceof HHAutomationError && error.code === "stopped") await this.finish("Загрузка ответов остановлена. Сохранено диалогов: " + this.state.processed);
      else await this.finish("Чтение ответов остановлено: " + errorMessage(error), errorMessage(error));
    }
  }

  private async verifyProfileResume(settings: Awaited<ReturnType<typeof ensureSettings>>) {
    if (!settings.resumeUrl) throw new HHAutomationError("resume", "Добавьте своё резюме HH перед отправкой откликов");
    if (this.verifiedResume === settings.resumeUrl) return;
    const owner = await this.automation.verifyResumeOwnership(settings.resumeUrl, () => this.state.stopRequested);
    if (settings.hhAccountId && settings.hhAccountId !== owner.accountId) throw new HHAutomationError("auth", "Это резюме связано с другим HH-аккаунтом. Войдите как его владелец");
    await prisma.setting.update({ where: { id: settings.id }, data: { hhAccountId: owner.accountId, resumeVerifiedAt: new Date() } });
    this.verifiedResume = settings.resumeUrl;
    this.verifiedOwner = owner;
  }

  async importResume(resumeUrl: string) {
    this.start("resume", "Загружаю резюме из HH", 1);

    try {
      const text = await this.automation.importResumeText(resumeUrl, () => this.state.stopRequested);
      const keywords = await saveImportedResume(resumeUrl, text, this.profileId);

      this.state.processed = 1;
      await writeLog("info", "Резюме загружено из HH", { resumeUrl, keywords });
      await this.finish("Резюме загружено. Поисковые запросы: " + (keywords.join(", ") || "не найдены"));
      return { state: this.getState(), resumeText: text, keywords };
    } catch (error) {
      const message = errorMessage(error);
      await writeLog("error", "Загрузка резюме остановлена", { message, resumeUrl });
      await this.finish("Загрузка резюме остановлена: " + message, message);
      throw error;
    }
  }

  async applyVacancy(id: number) {
    this.start("apply", "Откликаюсь на выбранную вакансию", 1);

    try {
      const applied = await this.applyVacancyInternal(id);
      this.state.processed = applied ? 1 : 0;
      await this.finish(applied ? "Отклик отправлен" : "Вакансия пропущена или отклик уже был отправлен");
    } catch (error) {
      const message = errorMessage(error);
      await this.finish("Отклик остановлен: " + message, message);
      throw error;
    }

    return this.getState();
  }

  private async applyVacancyInternal(id: number, skipAdditionalRequirements = false) {
    const settings = await this.settings();
    const vacancy = await prisma.vacancy.findUnique({ where: { id, profileId: settings.id } });
    if (!vacancy) throw new Error("Вакансия не найдена");
    if (vacancy.status === "skipped") throw new Error("Вакансия пропущена");
    if (vacancy.status === "applied") throw new Error("На эту вакансию уже был отправлен отклик");
    if (this.state.stopRequested) throw new HHAutomationError("stopped", "Процесс остановлен пользователем");

    const alreadySent = await prisma.vacancy.findFirst({ where: { url: vacancy.url, status: "applied", profileId: { not: settings.id } }, select: { id: true } });
    if (alreadySent) {
      await prisma.vacancy.update({ where: { id }, data: { status: "skipped" } });
      await writeLog("info", "Вакансия пропущена: отклик уже отправлен из другого профиля", { vacancyId: id }, settings.id);
      return false;
    }
    const excludedWords = parseExcludedWords(settings.excludedWords);
    const matches = findExcludedWords(vacancy, excludedWords);
    if (matches.length > 0) {
      await prisma.vacancy.update({ where: { id }, data: { status: "skipped" } });
      await writeLog("info", "Отклик заблокирован стоп-словами", { vacancyId: id, matches });
      return false;
    }
    const appliedToday = await prisma.application.count({
      where: { vacancy: { profileId: this.profileId }, status: "applied", appliedAt: { gte: startOfToday() } }
    });
    if (appliedToday >= settings.dailyLimit) throw new HHAutomationError("stopped", "Дневной лимит откликов исчерпан");
    await this.verifyProfileResume(settings);
    await prisma.vacancy.update({ where: { id }, data: { status: "pending" } });

    try {
      let result;
      try {
        result = await this.automation.applyToVacancy(
          vacancy,
          settings.coverLetterTemplate,
          { minSeconds: settings.applyDelayMinSeconds ?? 3, maxSeconds: settings.applyDelayMaxSeconds ?? 8 },
          () => this.state.stopRequested,
          { excludedWords, preferredResumeUrl: settings.resumeUrl, requirePreferredResume: Boolean(settings.resumeUrl), preferredResumeTitle: this.verifiedOwner?.title, allowTitleMatch: this.verifiedOwner?.uniqueTitle, expectedAccountId: this.verifiedOwner?.accountId, skipAdditionalRequirements }
        );
      } catch (error) {
        if (error instanceof HHAutomationError && ["auth", "excluded", "archived", "unavailable", "requirements", "stopped"].includes(error.code)) throw error;
        // A selector timeout or an unfamiliar HH form is not permission to skip
        // the user's unfinished CAPTCHA. Keep the same application interactive.
        result = await this.automation.completeApplicationManually(vacancy, () => this.state.stopRequested, errorMessage(error), skipAdditionalRequirements);
      }
      await prisma.$transaction([prisma.application.create({
        data: {
          vacancyId: id,
          coverLetter: settings.coverLetterTemplate,
          status: "applied",
          appliedAt: result.alreadyApplied ? null : new Date()
        }
      }), prisma.vacancy.update({ where: { id }, data: { status: "applied" } })]);
      await writeLog("info", result.alreadyApplied ? "Вакансия уже была откликнута" : "Отклик отправлен", {
        vacancyId: id,
        selectedResume: result.selectedResume,
        coverLetterDelivery: result.coverLetterDelivery
      });
      return !result.alreadyApplied;
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof HHAutomationError && ["excluded", "archived", "unavailable", "requirements"].includes(error.code)) {
        await prisma.vacancy.update({ where: { id }, data: { status: "skipped" } });
        await writeLog("info", error.code === "requirements" ? "Вакансия пропущена: дополнительные требования" : error.code === "archived" ? "Вакансия в архиве, пропускаю" : error.code === "unavailable" ? "Вакансия недоступна, пропускаю" : "Отклик заблокирован стоп-словами в полном описании", { vacancyId: id, message });
        return false;
      }
      if (error instanceof HHAutomationError && error.code === "stopped") {
        await prisma.vacancy.update({ where: { id }, data: { status: "pending" } });
        await writeLog("warn", "Отклик остановлен пользователем", { vacancyId: id });
        throw error;
      }
      await prisma.$transaction([prisma.application.create({
        data: {
          vacancyId: id,
          coverLetter: settings.coverLetterTemplate,
          status: "failed",
          error: message
        }
      }), prisma.vacancy.update({ where: { id }, data: { status: "failed" } })]);
      await writeLog("error", "Ошибка отклика", { vacancyId: id, message });
      throw error;
    }
  }

  async startAutoApply(options: AutoApplyOptions) {
    this.start("auto", "Автоотклики запущены вручную", options.limit);
    this.state.skipAdditionalRequirements = options.skipAdditionalRequirements ?? false;
    void this.runAutoApply(options);
    return this.getState();
  }

  private async runAutoApply(options: AutoApplyOptions) {
    try {
      const settings = await this.settings();
      if (!settings.activeSearchBatchId && !options.vacancyIds?.length) {
        await this.finish("Сначала запустите поиск новых вакансий");
        return;
      }
      const appliedToday = await prisma.application.count({
        where: { vacancy: { profileId: this.profileId }, status: "applied", appliedAt: { gte: startOfToday() } }
      });
      const remainingDailyLimit = Math.max(0, settings.dailyLimit - appliedToday);
      const target = Math.min(options.limit, remainingDailyLimit);

      this.state.target = target;

      if (target <= 0) {
        await this.finish("Дневной лимит уже исчерпан");
        return;
      }

      const vacancies = await prisma.vacancy.findMany({
        where: {
          profileId: settings.id,
          status: { in: options.vacancyIds?.length ? ["found", "pending", "failed"] : ["found", "pending"] },
          ...(options.vacancyIds?.length ? { id: { in: options.vacancyIds } } : { searchBatchId: settings.activeSearchBatchId })
        },
        orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }]
      });

      this.state.target = Math.min(vacancies.length, target);

      if (vacancies.length === 0) {
        await this.finish(options.vacancyIds?.length ? "Среди выбранных нет вакансий для отклика" : "Нет новых вакансий из последнего поиска для отклика");
        return;
      }

      for (const vacancy of vacancies) {
        if (this.state.stopRequested || this.state.processed >= target) break;
        this.state.message = "Откликаюсь: " + vacancy.title;
        try {
          const applied = await this.applyVacancyInternal(vacancy.id, options.skipAdditionalRequirements ?? false);
          if (applied) this.state.processed += 1;
        } catch (error) {
          if (error instanceof HHAutomationError && ["captcha", "auth", "access", "stopped", "resume"].includes(error.code)) {
            throw error;
          }
          await writeLog("warn", "Пропускаю вакансию из-за ошибки отклика", { vacancyId: vacancy.id, title: vacancy.title, message: errorMessage(error) });
        }
      }

      const stopped = this.state.stopRequested;
      await this.finish(stopped ? "Автоотклики остановлены" : "Автоотклики завершены");
    } catch (error) {
      const message = errorMessage(error);
      await writeLog("error", "Автоотклики остановлены", { message });
      await this.finish("Автоотклики остановлены: " + message, message);
    }
  }
}

const globalForRunner = globalThis as unknown as { hhRunner?: HHRunner };

export function getHHRunner(): HHRunner {
  const current = globalForRunner.hhRunner;
  // Next dev keeps this singleton through module updates. Preserve an active
  // job or recoverable login page; replace stale code only between jobs.
  if (!current || (current.runtimeRevision !== RUNNER_REVISION && !current.getState().running && !current.getBrowserView?.().available)) {
    globalForRunner.hhRunner = new HHRunner();
  }
  return globalForRunner.hhRunner!;
}

export const hhRunner = new Proxy({} as HHRunner, {
  get(_target, property) {
    const runner = getHHRunner();
    const value = Reflect.get(runner, property, runner);
    return typeof value === "function" ? value.bind(runner) : value;
  }
});
