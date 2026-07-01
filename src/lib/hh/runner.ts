import type { Vacancy } from "@prisma/client";
import { HHAutomationError, HHPlaywrightService, type ScrapedVacancy } from "@/lib/hh/playwright";
import { writeLog } from "@/lib/log";
import { buildSearchQueries, calculateMatchScore, deriveSearchKeywordsFromResume } from "@/lib/matching";
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
    this.start("search", "Ищу вакансии на HH", 0);
    void this.runSearch();
    return this.getState();
  }

  private async runSearch() {
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

      if (keywords.length === 0) {
        throw new Error("Добавьте хотя бы одно ключевое слово в Settings");
      }

      const scraped = await this.automation.searchVacancies({
        keywords,
        city: settings.city,
        minSalary: settings.minSalary,
        stopRequested: () => this.state.stopRequested
      });

      const saved = await this.saveVacancies(scraped, {
        city: settings.city,
        minSalary: settings.minSalary,
        resumeText: settings.resumeText,
        keywords: storedKeywords
      });

      this.state.processed = saved;
      await writeLog("info", "Поиск завершен", { saved });
      this.finish("Поиск завершен. Сохранено вакансий: " + saved);
    } catch (error) {
      const message = errorMessage(error);
      await writeLog("error", "Поиск остановлен", { message });
      if (error instanceof HHAutomationError && (error.code === "captcha" || error.code === "auth")) {
        await this.automation.close();
      }
      this.finish("Поиск остановлен: " + message, message);
    }
  }

  private async saveVacancies(
    vacancies: ScrapedVacancy[],
    settings: { city?: string | null; minSalary?: number | null; resumeText?: string | null; keywords: string[] }
  ) {
    let saved = 0;

    for (const vacancy of vacancies) {
      if (!vacancy.url) {
        await writeLog("warn", "Вакансия пропущена: нет ссылки", { title: vacancy.title, externalId: vacancy.externalId });
        continue;
      }

      const matchScore = calculateMatchScore(vacancy, settings);
      const existing = await prisma.vacancy.findUnique({ where: { url: vacancy.url } });
      const nextStatus = "pending";

      if (existing) {
        const keepStatus = ["applied", "skipped"].includes(existing.status);
        await prisma.vacancy.update({
          where: { id: existing.id },
          data: {
            externalId: vacancy.externalId,
            title: vacancy.title,
            company: vacancy.company,
            salary: vacancy.salary,
            city: vacancy.city,
            description: vacancy.description,
            matchScore,
            status: keepStatus ? existing.status : nextStatus
          }
        });
      } else {
        await prisma.vacancy.create({
          data: {
            externalId: vacancy.externalId,
            title: vacancy.title,
            company: vacancy.company,
            salary: vacancy.salary,
            city: vacancy.city,
            description: vacancy.description,
            url: vacancy.url,
            matchScore,
            status: nextStatus
          }
        });
      }

      saved += 1;
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
        orderBy: [{ createdAt: "desc" }],
        take: target
      });

      this.state.target = vacancies.length;

      if (vacancies.length === 0) {
        this.finish("Нет вакансий под выбранный match score");
        return;
      }

      for (const vacancy of vacancies) {
        if (this.state.stopRequested) break;
        this.state.message = "Откликаюсь: " + vacancy.title;
        await this.applyVacancyInternal(vacancy.id);
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
