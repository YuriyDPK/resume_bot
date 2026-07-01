import { existsSync } from "node:fs";
import type { Vacancy } from "@prisma/client";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { hhConfig } from "@/lib/env";
import { writeLog } from "@/lib/log";

export type StopSignal = () => boolean;

export type ScrapedVacancy = {
  externalId?: string;
  title: string;
  company: string;
  salary?: string | null;
  city?: string | null;
  url: string;
  description?: string | null;
};

export type HHAutomationErrorCode = "captcha" | "auth" | "stopped" | "apply" | "browser";

export class HHAutomationError extends Error {
  code: HHAutomationErrorCode;

  constructor(code: HHAutomationErrorCode, message: string) {
    super(message);
    this.name = "HHAutomationError";
    this.code = code;
  }
}

function extractExternalId(url: string) {
  return url.match(/vacancy\/(\d+)/)?.[1];
}

function normalizeUrl(url: string | null | undefined) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeForCompare(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/ё/g, "е").trim();
}

function isVacancyUrl(url: string) {
  return /^https:\/\/(www\.)?hh\.ru\/vacancy\/\d+/.test(url);
}

function cityMatches(vacancyCity: string | null | undefined, expectedCity: string | null | undefined) {
  if (!expectedCity?.trim() || !vacancyCity?.trim()) return true;
  return normalizeForCompare(vacancyCity).includes(normalizeForCompare(expectedCity));
}

export class HHPlaywrightService {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;

  async ensureBrowser() {
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: hhConfig.headless });
      await writeLog("info", "Браузер Playwright запущен в видимом режиме", { headless: hhConfig.headless });
    }

    if (!this.context) {
      const contextOptions: Parameters<Browser["newContext"]>[0] = {
        locale: "ru-RU",
        viewport: { width: 1366, height: 900 }
      };

      if (existsSync(hhConfig.storageStatePath)) {
        contextOptions.storageState = hhConfig.storageStatePath;
      }

      this.context = await this.browser.newContext(contextOptions);
      this.page = await this.context.newPage();
    }

    return this.page!;
  }

  async close() {
    await this.context?.storageState({ path: hhConfig.storageStatePath }).catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
  }

  private assertNotStopped(stopRequested?: StopSignal) {
    if (stopRequested?.()) {
      throw new HHAutomationError("stopped", "Процесс остановлен пользователем");
    }
  }

  private async bodyText(page: Page) {
    return page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  }

  async detectCaptcha(page: Page) {
    const url = page.url().toLowerCase();
    if (url.includes("captcha")) return true;
    const text = await this.bodyText(page);
    return /captcha|капч|не робот|подтвердите, что вы человек/i.test(text);
  }

  private async detectAuthRequired(page: Page) {
    const loginVisible = await page
      .locator('a[data-qa="login"], button[data-qa="login"], [data-qa="account-login"]')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (loginVisible) return true;

    const text = await this.bodyText(page);
    return /войти|зарегистрироваться|авторизуйтесь/i.test(text) && !/мои резюме|отклики/i.test(text);
  }

  async ensureAuthorized(stopRequested?: StopSignal) {
    const page = await this.ensureBrowser();
    this.assertNotStopped(stopRequested);

    await page.goto("https://hh.ru", { waitUntil: "domcontentloaded", timeout: 60000 });

    if (await this.detectCaptcha(page)) {
      throw new HHAutomationError("captcha", "HH показал CAPTCHA. Процесс остановлен, обход не выполняется.");
    }

    if (!(await this.detectAuthRequired(page))) {
      await this.context?.storageState({ path: hhConfig.storageStatePath });
      return page;
    }

    await writeLog("warn", "Требуется ручной вход в HH. Открыл страницу авторизации в видимом браузере.");
    await page.goto("https://hh.ru/account/login", { waitUntil: "domcontentloaded", timeout: 60000 });

    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      this.assertNotStopped(stopRequested);
      if (await this.detectCaptcha(page)) {
        throw new HHAutomationError("captcha", "HH показал CAPTCHA во время входа. Процесс остановлен.");
      }
      if (!(await this.detectAuthRequired(page))) {
        await this.context?.storageState({ path: hhConfig.storageStatePath });
        await writeLog("info", "Сессия HH сохранена", { path: hhConfig.storageStatePath });
        return page;
      }
      await page.waitForTimeout(5000);
    }

    throw new HHAutomationError("auth", "Не удалось подтвердить авторизацию за 10 минут");
  }

  async waitHumanDelay(page: Page, delayRange: { minSeconds: number; maxSeconds: number }, stopRequested?: StopSignal) {
    const minMs = Math.max(0, Math.min(delayRange.minSeconds, delayRange.maxSeconds)) * 1000;
    const maxMs = Math.max(0, Math.max(delayRange.minSeconds, delayRange.maxSeconds)) * 1000;
    const delayMs = minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
    await writeLog("info", "Пауза перед действием на HH", { seconds: Math.round(delayMs / 1000) });

    const step = 500;
    let waited = 0;
    while (waited < delayMs) {
      this.assertNotStopped(stopRequested);
      await page.waitForTimeout(Math.min(step, delayMs - waited));
      waited += step;
    }
  }

  async searchVacancies(params: {
    keywords: string[];
    city?: string | null;
    minSalary?: number | null;
    stopRequested?: StopSignal;
  }) {
    const page = await this.ensureAuthorized(params.stopRequested);
    const results = new Map<string, ScrapedVacancy>();

    for (const keyword of params.keywords) {
      this.assertNotStopped(params.stopRequested);
      const url = new URL("https://hh.ru/search/vacancy");
      url.searchParams.set("text", keyword);
      url.searchParams.set("items_on_page", "20");
      if (params.minSalary) url.searchParams.set("salary", String(params.minSalary));

      await writeLog("info", "Ищу вакансии на HH", { keyword });
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(2500);

      if (await this.detectCaptcha(page)) {
        throw new HHAutomationError("captcha", "HH показал CAPTCHA во время поиска. Процесс остановлен.");
      }

      await page.locator('a[href*="/vacancy/"]').first().waitFor({ timeout: 15000 }).catch(() => undefined);

      const scraped = await page.evaluate(() => {
        type BrowserVacancy = {
          title: string;
          company: string;
          salary: string | null;
          city: string | null;
          description: string | null;
          url: string;
        };

        const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
        const cleanSalary = (value: string | null | undefined) => {
          const normalized = normalize(value);
          if (!normalized || /опыт|можно удаленно|удален/i.test(normalized)) return null;
          return /\d/.test(normalized) ? normalized : null;
        };
        const cards = Array.from(
          document.querySelectorAll('[data-qa="vacancy-serp__vacancy"], .vacancy-serp-item, [data-qa="serp-item"]')
        );

        const fromCards = cards
          .map((card): BrowserVacancy | null => {
            const link = card.querySelector<HTMLAnchorElement>('[data-qa="serp-item__title"], a[href*="/vacancy/"]');
            if (!link?.href) return null;
            const company = card.querySelector('[data-qa="vacancy-serp__vacancy-employer"], [data-qa="serp-item__meta-info-company"], [class*="company"]');
            const salary = card.querySelector('[data-qa="vacancy-serp__vacancy-compensation"], [data-qa="serp-item__salary"]');
            const city = card.querySelector('[data-qa="vacancy-serp__vacancy-address"], [data-qa="serp-item__meta-info-location"], [class*="address"]');
            const description = card.querySelector('[data-qa="vacancy-serp__vacancy_snippet_responsibility"], [data-qa="vacancy-serp__vacancy_snippet_requirement"]');

            return {
              title: normalize(link.textContent),
              company: normalize(company?.textContent) || "HH.ru",
              salary: cleanSalary(salary?.textContent),
              city: normalize(city?.textContent) || null,
              description: normalize(description?.textContent) || null,
              url: link.href
            };
          })
          .filter((item): item is BrowserVacancy => item !== null);

        if (fromCards.length > 0) return fromCards;

        return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/vacancy/"]'))
          .map((link) => ({
            title: normalize(link.textContent),
            company: "HH.ru",
            salary: null,
            city: null,
            description: null,
            url: link.href
          }))
          .filter((item) => item.title && item.url);
      });

      for (const item of scraped) {
        const normalizedUrl = normalizeUrl(item.url);
        if (!normalizedUrl || !isVacancyUrl(normalizedUrl)) continue;
        if (!cityMatches(item.city, params.city)) continue;

        results.set(normalizedUrl, {
          externalId: extractExternalId(normalizedUrl),
          title: item.title || "Без названия",
          company: item.company || "HH.ru",
          salary: item.salary,
          city: item.city ?? params.city ?? null,
          description: item.description,
          url: normalizedUrl
        });
      }
    }

    await this.context?.storageState({ path: hhConfig.storageStatePath });
    return Array.from(results.values());
  }

  async importResumeText(resumeUrl: string, stopRequested?: StopSignal) {
    const page = await this.ensureAuthorized(stopRequested);
    this.assertNotStopped(stopRequested);

    await page.goto(resumeUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);

    if (await this.detectCaptcha(page)) {
      throw new HHAutomationError("captcha", "HH показал CAPTCHA на странице резюме. Процесс остановлен.");
    }

    if (await this.detectAuthRequired(page)) {
      throw new HHAutomationError("auth", "HH требует повторную авторизацию для чтения резюме. Процесс остановлен.");
    }

    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim());
    await this.context?.storageState({ path: hhConfig.storageStatePath });

    if (!text || text.length < 120) {
      throw new HHAutomationError("browser", "Не удалось прочитать текст резюме. Проверьте доступность ссылки в HH.");
    }

    return text.slice(0, 12000);
  }

  private async firstVisible(page: Page, selectors: string[]) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
        return locator;
      }
    }
    return null;
  }

  private async findCoverLetterInput(page: Page) {
    return this.firstVisible(page, [
      'textarea[data-qa="vacancy-response-popup-form-letter-input"]',
      'textarea[data-qa*="letter"]',
      'textarea[name="letter"]',
      'textarea[placeholder*="сопровод"]',
      'textarea[placeholder*="пись"]',
      '[contenteditable="true"][data-qa*="letter"]',
      '[contenteditable="true"]'
    ]);
  }

  private async fillCoverLetter(page: Page, coverLetter: string) {
    const text = coverLetter.trim();
    if (!text) return;

    let input = await this.findCoverLetterInput(page);

    if (!input) {
      const addLetterButton = await this.firstVisible(page, [
        'button:has-text("Сопроводительное")',
        'a:has-text("Сопроводительное")',
        'button:has-text("Добавить письмо")',
        'a:has-text("Добавить письмо")',
        'button:has-text("Написать сообщение")',
        'button:has-text("Написать письмо")',
        '[data-qa*="letter"]'
      ]);

      if (addLetterButton) {
        await addLetterButton.click({ timeout: 10000 });
        await page.waitForTimeout(1000);
        input = await this.findCoverLetterInput(page);
      }
    }

    if (!input) {
      throw new HHAutomationError("apply", "Поле сопроводительного письма не найдено. Отклик без письма не отправлен.");
    }

    await input.scrollIntoViewIfNeeded().catch(() => undefined);
    const tagName = await input.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");

    if (tagName === "textarea" || tagName === "input") {
      await input.fill(text, { timeout: 10000 });
    } else {
      await input.click({ timeout: 10000 });
      await page.keyboard.press("Control+A").catch(() => undefined);
      await page.keyboard.type(text, { delay: 8 });
    }

    const currentValue = await input
      .evaluate((node) => {
        if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node.value;
        return node.textContent ?? "";
      })
      .catch(() => "");

    if (!currentValue.includes(text.slice(0, Math.min(20, text.length)))) {
      throw new HHAutomationError("apply", "Не удалось заполнить сопроводительное письмо");
    }
  }

  async applyToVacancy(
    vacancy: Vacancy,
    coverLetter: string,
    delayRange: { minSeconds: number; maxSeconds: number },
    stopRequested?: StopSignal
  ) {
    const page = await this.ensureAuthorized(stopRequested);
    this.assertNotStopped(stopRequested);

    await page.goto(vacancy.url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(2500);

    if (await this.detectCaptcha(page)) {
      throw new HHAutomationError("captcha", "HH показал CAPTCHA на странице вакансии. Процесс остановлен.");
    }

    if (await this.detectAuthRequired(page)) {
      throw new HHAutomationError("auth", "HH требует повторную авторизацию. Процесс остановлен.");
    }

    const alreadyAppliedText = await this.bodyText(page);
    if (/вы откликнулись|отклик отправлен|отклик уже отправлен/i.test(alreadyAppliedText)) {
      await this.context?.storageState({ path: hhConfig.storageStatePath });
      return { alreadyApplied: true };
    }

    const applyButton = await this.firstVisible(page, [
      '[data-qa="vacancy-response-link-top"]',
      '[data-qa="vacancy-response-link-bottom"]',
      'a:has-text("Откликнуться")',
      'button:has-text("Откликнуться")',
      'a:has-text("Отклик")',
      'button:has-text("Отклик")'
    ]);

    if (!applyButton) {
      throw new HHAutomationError("apply", "Не нашел кнопку отклика на странице вакансии");
    }

    await this.waitHumanDelay(page, delayRange, stopRequested);
    await applyButton.click({ timeout: 15000 });
    await page.waitForTimeout(2000);

    if (await this.detectCaptcha(page)) {
      throw new HHAutomationError("captcha", "HH показал CAPTCHA после нажатия отклика. Процесс остановлен.");
    }

    const afterClickText = await this.bodyText(page);
    if (coverLetter.trim() && /вы откликнулись|отклик отправлен|отклик уже отправлен/i.test(afterClickText)) {
      throw new HHAutomationError("apply", "HH отправил отклик сразу после нажатия кнопки, без формы сопроводительного письма.");
    }

    await this.fillCoverLetter(page, coverLetter);

    const submitButton = await this.firstVisible(page, [
      '[data-qa="vacancy-response-submit-popup"]',
      'button:has-text("Отправить")',
      'button:has-text("Откликнуться")',
      'button:has-text("Подтвердить")'
    ]);

    if (!submitButton) {
      throw new HHAutomationError("apply", "Не нашел кнопку отправки отклика после заполнения письма");
    }

    await this.waitHumanDelay(page, delayRange, stopRequested);
    await submitButton.click({ timeout: 15000 });
    await page.waitForTimeout(2500);

    if (await this.detectCaptcha(page)) {
      throw new HHAutomationError("captcha", "HH показал CAPTCHA после отправки отклика. Процесс остановлен.");
    }

    await this.context?.storageState({ path: hhConfig.storageStatePath });
    return { alreadyApplied: false };
  }
}
