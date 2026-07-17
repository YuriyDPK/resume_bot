import type { Vacancy } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { HHAutomationError, HHPlaywrightService, type ScrapedVacancy } from "@/lib/hh/playwright";
import { writeLog } from "@/lib/log";
import { buildSearchQueries, calculateMatchScore, deriveSearchKeywordsFromResume, isRelevantVacancy, parseExcludedWords, vacancyHasExcludedWords } from "@/lib/matching";
import { prisma } from "@/lib/prisma";
import { ensureSettings } from "@/lib/settings";

export type RunnerMode = "idle" | "login" | "search" | "resume" | "apply" | "auto";

export type RunnerState = {
  running: boolean;
  mode: RunnerMode;
  stopRequested: boolean;
  message: string;
  processed: number;
  target: number;
  startedAt?: string;
  lastError?: string;
};

const idleState: RunnerState = {
  running: false,
  mode: "idle",
  stopRequested: false,
  message: "Готов к работе",
  processed: 0,
  target: 0
};

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Неизвестная ошибка";
}

class HHRunner {
  private automation = new HHPlaywrightService();
  private state: RunnerState = { ...idleState };

  getState() {
    return { ...this.state };
  }

  private assertFree() {
    if (this.state.running) {
      throw new Error("Уже запущен процесс: " + this.state.message);
    }
  }

  private start(mode: RunnerMode, message: string, target = 0) {
    this.assertFree();
    this.state = {
      running: true,
      mode,
      stopRequested: false,
      message,
      processed: 0,
      target,
      startedAt: new Date().toISOString()
    };
  }

  private finish(message: string, lastError?: string) {
    this.state = {
      ...idleState,
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

  startLogin() {
    this.start("login", "Открыл HH для ручного входа", 1);
    void this.runLogin();
    return this.getState();
  }

  private async runLogin() {
    try {
      await this.automation.ensureAuthorized(() => this.state.stopRequested);
      this.state.processed = 1;
      this.finish("Сессия HH сохранена");
    } catch (error) {
      const message = errorMessage(error);
      await writeLog("error", "Ошибка авторизации HH", { message });
      await this.automation.close();
      this.finish("Вход остановлен: " + message, message);
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
      let settings = await ensureSettings();

      if (!settings.resumeText.trim() && settings.resumeUrl) {
        this.state.message = "Загружаю резюме перед поиском";
        const resumeText = await this.automation.importResumeText(settings.resumeUrl, () => this.state.stopRequested);
        const derivedKeywords = deriveSearchKeywordsFromResume(resumeText);
        await prisma.setting.update({ where: { id: 1 }, data: { resumeText } });
        if (derivedKeywords.length > 0) {
          await prisma.searchKeyword.deleteMany();
          await prisma.searchKeyword.createMany({ data: derivedKeywords.map((value) => ({ value, enabled: true })) });
        }
        settings = await ensureSettings();
      }

      const storedKeywords = settings.keywords.map((keyword) => keyword.value.trim()).filter(Boolean);
      const keywords = buildSearchQueries(storedKeywords, settings.resumeText);
      const excludedWords = parseExcludedWords(settings.excludedWords);

      if (keywords.length === 0) {
        throw new Error("Добавьте хотя бы одно ключевое слово в Settings");
      }

      this.state.target = settings.searchLimit;
      await prisma.setting.update({ where: { id: 1 }, data: { activeSearchBatchId: null } });
      const knownVacancies = await prisma.seenVacancy.findMany({ select: { url: true } });
      const searchBatchId = randomUUID();
      activeBatchId = searchBatchId;
      const city = settings.searchAllRussia ? null : settings.city;

      await this.automation.searchVacancies({
        keywords,
        city,
        minSalary: settings.minSalary,
        allRussia: settings.searchAllRussia,
        remoteOnly: settings.remoteOnly,
        maxResults: settings.searchLimit,
        excludedUrls: knownVacancies.map((vacancy) => vacancy.url),
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

      await prisma.setting.update({ where: { id: 1 }, data: { activeSearchBatchId: searchBatchId } });

      this.state.processed = saved;
      await writeLog("info", "Поиск завершен", { saved, skippedKnown: knownVacancies.length, searchBatchId });
      this.finish("Поиск завершен. Найдено новых вакансий: " + saved);
    } catch (error) {
      const message = errorMessage(error);
      const stoppedByUser = error instanceof HHAutomationError && error.code === "stopped";

      if (activeBatchId && savedDuringSearch > 0) {
        await prisma.setting.update({ where: { id: 1 }, data: { activeSearchBatchId: activeBatchId } });
      }

      await writeLog(stoppedByUser ? "warn" : "error", "Поиск остановлен", { message, saved: savedDuringSearch, searchBatchId: activeBatchId });
      if (error instanceof HHAutomationError && (error.code === "captcha" || error.code === "auth")) {
        await this.automation.close();
      }

      if (stoppedByUser && savedDuringSearch > 0) {
        this.finish("Поиск остановлен. Сохранено вакансий: " + savedDuringSearch);
        return;
      }

      this.finish("Поиск остановлен: " + message, message);
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
      const existing = await prisma.vacancy.findUnique({ where: { url: vacancy.url }, select: { id: true } });
      if (!existing) {
        await prisma.$transaction([
          prisma.seenVacancy.upsert({
            where: { url: vacancy.url },
            create: { url: vacancy.url, externalId: vacancy.externalId },
            update: {}
          }),
          prisma.vacancy.create({
            data: {
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

  async importResume(resumeUrl: string) {
    this.start("resume", "Загружаю резюме из HH", 1);

    try {
      const text = await this.automation.importResumeText(resumeUrl, () => this.state.stopRequested);
      const keywords = deriveSearchKeywordsFromResume(text);

      await prisma.setting.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          city: "Москва",
          minSalary: null,
          coverLetterTemplate:
            "Здравствуйте! Заинтересовала ваша вакансия. Буду рад обсудить, чем мой опыт может быть полезен команде.",
          resumeText: text,
          resumeUrl,
          dailyLimit: 5
        },
        update: {
          resumeText: text,
          resumeUrl
        }
      });

      if (keywords.length > 0) {
        await prisma.searchKeyword.deleteMany();
        await prisma.searchKeyword.createMany({
          data: keywords.map((value) => ({ value, enabled: true }))
        });
      }

      this.state.processed = 1;
      await writeLog("info", "Резюме загружено из HH", { resumeUrl, keywords });
      this.finish("Резюме загружено. Ключевые слова обновлены: " + (keywords.join(", ") || "не найдены"));
      return { state: this.getState(), resumeText: text, keywords };
    } catch (error) {
      const message = errorMessage(error);
      await writeLog("error", "Загрузка резюме остановлена", { message, resumeUrl });
      if (error instanceof HHAutomationError && (error.code === "captcha" || error.code === "auth")) {
        await this.automation.close();
      }
      this.finish("Загрузка резюме остановлена: " + message, message);
      throw error;
    }
  }

  async applyVacancy(id: number) {
    this.start("apply", "Откликаюсь на выбранную вакансию", 1);

    try {
      await this.applyVacancyInternal(id);
      this.state.processed = 1;
      this.finish("Отклик отправлен");
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof HHAutomationError && (error.code === "captcha" || error.code === "auth")) {
        await this.automation.close();
      }
      this.finish("Отклик остановлен: " + message, message);
      throw error;
    }

    return this.getState();
  }

  private async applyVacancyInternal(id: number) {
    const vacancy = await prisma.vacancy.findUnique({ where: { id } });
    if (!vacancy) throw new Error("Вакансия не найдена");
    if (vacancy.status === "skipped") throw new Error("Вакансия пропущена");
    if (vacancy.status === "applied") throw new Error("На эту вакансию уже был отправлен отклик");
    if (this.state.stopRequested) throw new HHAutomationError("stopped", "Процесс остановлен пользователем");

    const settings = await ensureSettings();
    await prisma.vacancy.update({ where: { id }, data: { status: "pending" } });

    try {
      const result = await this.automation.applyToVacancy(
        vacancy as Vacancy,
        settings.coverLetterTemplate,
        {
          minSeconds: settings.applyDelayMinSeconds ?? 3,
          maxSeconds: settings.applyDelayMaxSeconds ?? 8
        },
        () => this.state.stopRequested
      );
      await prisma.application.create({
        data: {
          vacancyId: id,
          coverLetter: settings.coverLetterTemplate,
          status: "applied",
          appliedAt: new Date()
        }
      });
      await prisma.vacancy.update({ where: { id }, data: { status: "applied" } });
      await writeLog("info", result.alreadyApplied ? "Вакансия уже была откликнута" : "Отклик отправлен", {
        vacancyId: id
      });
    } catch (error) {
      const message = errorMessage(error);
      if (error instanceof HHAutomationError && error.code === "stopped") {
        await prisma.vacancy.update({ where: { id }, data: { status: "pending" } });
        await writeLog("warn", "Отклик остановлен пользователем", { vacancyId: id });
        throw error;
      }
      await prisma.application.create({
        data: {
          vacancyId: id,
          coverLetter: settings.coverLetterTemplate,
          status: "failed",
          error: message
        }
      });
      await prisma.vacancy.update({ where: { id }, data: { status: "failed" } });
      await writeLog("error", "Ошибка отклика", { vacancyId: id, message });
      throw error;
    }
  }

  async startAutoApply(options: { limit: number }) {
    this.start("auto", "Автоотклики запущены вручную", options.limit);
    void this.runAutoApply(options);
    return this.getState();
  }

  private async runAutoApply(options: { limit: number }) {
    try {
      const settings = await ensureSettings();
      const appliedToday = await prisma.application.count({
        where: { status: "applied", appliedAt: { gte: startOfToday() } }
      });
      const remainingDailyLimit = Math.max(0, settings.dailyLimit - appliedToday);
      const target = Math.min(options.limit, remainingDailyLimit);

      this.state.target = target;

      if (target <= 0) {
        this.finish("Дневной лимит уже исчерпан");
        return;
      }

      const vacancies = await prisma.vacancy.findMany({
        where: {
          status: { in: ["found", "pending"] }
        },
        orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }],
        take: target
      });

      this.state.target = vacancies.length;

      if (vacancies.length === 0) {
        this.finish("Нет новых вакансий из последнего поиска для отклика");
        return;
      }

      for (const vacancy of vacancies) {
        if (this.state.stopRequested) break;
        this.state.message = "Откликаюсь: " + vacancy.title;
        try {
          await this.applyVacancyInternal(vacancy.id);
        } catch (error) {
          if (error instanceof HHAutomationError && (error.code === "captcha" || error.code === "auth" || error.code === "stopped")) {
            throw error;
          }
          await writeLog("warn", "Пропускаю вакансию из-за ошибки отклика", { vacancyId: vacancy.id, title: vacancy.title, message: errorMessage(error) });
        }
        this.state.processed += 1;
      }

      const stopped = this.state.stopRequested;
      this.finish(stopped ? "Автоотклики остановлены" : "Автоотклики завершены");
    } catch (error) {
      const message = errorMessage(error);
      await writeLog("error", "Автоотклики остановлены", { message });
      if (error instanceof HHAutomationError && (error.code === "captcha" || error.code === "auth")) {
        await this.automation.close();
      }
      this.finish("Автоотклики остановлены: " + message, message);
    }
  }
}

const globalForRunner = globalThis as unknown as { hhRunner?: HHRunner };
export const hhRunner = globalForRunner.hhRunner ?? new HHRunner();

if (process.env.NODE_ENV !== "production") {
  globalForRunner.hhRunner = hhRunner;
}
