import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { hhConfig } from "@/lib/env";
import { writeLog } from "@/lib/log";
import { HHAutomationError, type DelayRange, type StopSignal } from "@/lib/hh/types";
import { CaptchaController, type CaptchaInput, type ManualPauseDetails } from "@/lib/hh/captcha";
import { forwardBrowserInput, type BrowserInput } from "@/lib/hh/browser-view";
import { expireHHAccount, readHHProfile, saveHHAccount } from "@/lib/hh/account";

export class HHBrowserSession {
  protected browser?: Browser;
  protected context?: BrowserContext;
  protected page?: Page;
  private authenticated = false;
  private captcha = new CaptchaController((page) => this.detectCaptcha(page));
  private pageIds = new WeakMap<Page, string>();
  private capture?: Promise<{ image: Buffer; pageId: string } | null>;

  setCaptchaHandler(handler: (waiting: boolean, details?: ManualPauseDetails) => void) { this.captcha.setHandler(handler); }
  getCaptchaScreenshot() { return this.captcha.screenshot(); }
  sendCaptchaInput(input: CaptchaInput) { return this.captcha.input(input); }

  protected async waitForCaptcha(page: Page, stopRequested?: StopSignal) {
    return this.captcha.wait(page, stopRequested);
  }

  protected async waitForManualAction(page: Page, stopRequested: StopSignal | undefined, message: string) {
    return this.captcha.wait(page, stopRequested, { reason: "form", message });
  }

  private viewPage() {
    const paused = this.captcha.getPage();
    if (paused && !paused.isClosed()) return paused;
    return this.context?.pages().filter((page) => !page.isClosed()).at(-1);
  }

  getBrowserView() {
    const page = this.viewPage();
    if (!page) return { available: false, pageId: null, url: "" };
    let pageId = this.pageIds.get(page);
    if (!pageId) { pageId = randomUUID(); this.pageIds.set(page, pageId); }
    return { available: true, pageId, url: page.url() };
  }

  async getBrowserFrame() {
    if (this.capture) return this.capture;
    const page = this.viewPage();
    const { pageId } = this.getBrowserView();
    if (!page || !pageId) return null;
    this.capture = page.screenshot({ type: "jpeg", quality: 80, timeout: 3000 })
      .then((image) => this.viewPage() === page ? { image, pageId } : null).catch(() => null);
    try { return await this.capture; } finally { this.capture = undefined; }
  }

  async sendBrowserInput(pageId: string, input: BrowserInput) {
    const page = this.viewPage();
    if (!page || this.getBrowserView().pageId !== pageId) throw new Error("Страница HH изменилась. Дождитесь обновления изображения");
    await forwardBrowserInput(page, input);
  }

  async reloadLoginPage(pageId: string) {
    const page = this.viewPage();
    if (!page || this.getBrowserView().pageId !== pageId) throw new Error("Страница HH уже закрыта");
    await page.goto("https://hh.ru/account/login?backurl=%2Fapplicant%2Fresumes", { waitUntil: "domcontentloaded", timeout: 60000 });
  }

  async ensureBrowser() {
    if (this.browser && (!this.browser.isConnected() || this.page?.isClosed())) {
      await this.close();
    }
    if (!this.browser) {
      this.browser = await chromium.launch({ headless: true });
      await writeLog("info", "Браузер HH запущен внутри интерфейса бота");
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
      this.authenticated = false;
      this.page = await this.context.newPage();
    }

    return this.page!;
  }

  async close() {
    if (this.authenticated) {
      await this.context?.storageState({ path: hhConfig.storageStatePath }).catch(() => undefined);
    }
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.page = undefined;
    this.context = undefined;
    this.browser = undefined;
    this.authenticated = false;
  }

  protected assertNotStopped(stopRequested?: StopSignal) {
    if (stopRequested?.()) {
      throw new HHAutomationError("stopped", "Процесс остановлен пользователем");
    }
  }

  protected async bodyText(page: Page) {
    return page.locator("body").innerText({ timeout: 3000 }).catch(() => "");
  }

  async detectCaptcha(page: Page) {
    const url = new URL(page.url()).pathname.toLowerCase();
    if (url.includes("captcha")) return true;
    const challenge = page.locator('[data-qa="captcha"]:visible, form[action*="captcha"]:visible, iframe[title*="challenge"]:visible, #captcha:visible').first();
    if (await challenge.isVisible().catch(() => false)) return true;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame() || !/captcha|challenge|arkoselabs|funcaptcha/i.test(frame.url())) continue;
      const element = await frame.frameElement().catch(() => null);
      const box = element ? await element.boundingBox().catch(() => null) : null;
      await element?.dispose().catch(() => undefined);
      if (box && box.width >= 200 && box.height >= 60) return true;
    }
    const text = await this.bodyText(page);
    return /подтвердите, что вы человек|verify (?:that )?you are human/i.test(text) ||
      (text.length < 1500 && /captcha|капч|не робот/i.test(text));
  }

  protected async navigate(page: Page, url: string, stopRequested?: StopSignal) {
    // Check the existing page before any navigation can discard a late check.
    await this.waitForCaptcha(page, stopRequested);
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (await this.waitForCaptcha(page, stopRequested)) return null;
    if (/^\/vacancy\/\d+\/?$|^\/applicant\/vacancy_response\/?$/.test(new URL(url).pathname)) {
      await this.assertVacancyAccessible(page);
    }
    if (response && !response.ok()) {
      const status = response.status();
      if ([401, 403, 429].includes(status)) {
        throw new HHAutomationError("access", "HH ограничил доступ (HTTP " + status + "). Повторите позже; при необходимости нажмите «Войти в HH».");
      }
      throw new HHAutomationError("browser", "HH вернул HTTP " + status);
    }
    return response;
  }

  protected unavailableVacancyNotice(page: Page) {
    return page.getByText(/^(?:Вам\s+недоступна\s+эта\s+вакансия|(?:Эта\s+)?вакансия\s+(?:вам\s+)?недоступна)(?:[.!]|\s*$)/i).first();
  }

  protected async assertVacancyAccessible(page: Page) {
    if (await this.unavailableVacancyNotice(page).isVisible().catch(() => false)) {
      throw new HHAutomationError("unavailable", "Вам недоступна эта вакансия; пропускаю");
    }
  }

  protected async detectAuthRequired(page: Page) {
    if (page.isClosed()) throw new HHAutomationError("browser", "Окно HH было закрыто");
    if (/\/account\/login/.test(page.url())) { await expireHHAccount(); return true; }
    const loginVisible = await page
      .locator('a[data-qa="login"], button[data-qa="login"], [data-qa="account-login"]')
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);

    if (loginVisible) { await expireHHAccount(); return true; }

    const text = await this.bodyText(page);
    const required = /войти|зарегистрироваться|авторизуйтесь/i.test(text) && !/мои резюме|отклики/i.test(text);
    if (required) await expireHHAccount();
    return required;
  }

  private async hasAuthenticatedAccount(page: Page) {
    if (page.isClosed()) return false;
    const url = new URL(page.url());
    if (!(url.hostname === "hh.ru" || url.hostname.endsWith(".hh.ru"))) return false;
    if (/\/(?:account\/login|auth)(?:\/|$)|captcha/i.test(url.pathname)) return false;
    if (await this.detectCaptcha(page)) return false;

    // Positive account controls only: public navigation links and missing login
    // buttons are not proof of authentication (especially during hydration).
    const accountControl = page.locator([
      '[data-qa="mainmenu_applicantProfile"]:visible',
      '[data-qa="mainmenu_applicantProfileName"]:visible',
      '[data-qa="mainmenu_logout"]:visible',
      'a[href*="/account/logout"]:visible'
    ].join(", ")).first();
    if (await accountControl.isVisible().catch(() => false)) return true;

    // HH now redirects the resumes list to the owner's profile. The section
    // heading is present even for accounts with no resumes and is not the
    // public header's "Резюме и профиль" navigation link.
    if (/^\/applicant\/(?:resumes|profile\/me)\/?$/.test(url.pathname)) {
      return await page.getByRole("heading", { name: "Мои резюме", exact: true }).isVisible().catch(() => false);
    }
    return false;
  }

  private async confirmAccount(page: Page) {
    await this.context!.storageState({ path: hhConfig.storageStatePath });
    this.authenticated = true;
    this.page = page;
    await saveHHAccount(await readHHProfile(page) ?? { name: "Аккаунт HH" });
    await writeLog("info", "Вход в аккаунт HH подтверждён, сессия сохранена");
    return page;
  }

  private async waitForManualLogin(page: Page, stopRequested?: StopSignal, onProgress?: (message: string) => void) {
    this.authenticated = false;
    onProgress?.("Войдите в HH на странице внутри бота. Ожидаю подтверждение аккаунта");
    await writeLog("info", "Открываю страницу HH внутри бота для ручного входа");
    try {
      // Keep the embedded page available through login errors and checks.
      await page.goto("https://hh.ru/account/login?backurl=%2Fapplicant%2Fresumes", { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (error) {
      this.assertNotStopped(stopRequested);
      await writeLog("warn", "Страница входа HH загрузилась с ошибкой; окно оставлено для ручного входа", {
        message: error instanceof Error ? error.message : String(error)
      });
      onProgress?.("Не удалось загрузить HH. Нажмите «Перезагрузить HH» во встроенном браузере; ожидаю вход");
    }

    let deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      this.assertNotStopped(stopRequested);
      const pages = this.context!.pages().filter((candidate) => !candidate.isClosed());
      if (pages.length === 0) throw new HHAutomationError("browser", "Окно входа HH закрыто пользователем");
      for (const candidate of pages) {
        if (await this.waitForCaptcha(candidate, stopRequested)) deadline = Date.now() + 10 * 60 * 1000;
        if (await this.hasAuthenticatedAccount(candidate)) return this.confirmAccount(candidate);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new HHAutomationError("auth", "Вход не подтверждён за 10 минут. Страница доступна во встроенном браузере; повторите «Войти в HH» для проверки входа.");
  }

  async ensureAuthorized(stopRequested?: StopSignal, interactive = false, onProgress?: (message: string) => void): Promise<Page> {
    const page = await this.ensureBrowser();
    this.assertNotStopped(stopRequested);
    if (interactive) return this.waitForManualLogin(page, stopRequested, onProgress);

    await this.navigate(page, "https://hh.ru/applicant/resumes", stopRequested);
    let deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      this.assertNotStopped(stopRequested);
      if (await this.waitForCaptcha(page, stopRequested)) deadline = Date.now() + 10000;
      if (await this.hasAuthenticatedAccount(page)) return this.confirmAccount(page);
      if (await this.detectAuthRequired(page)) break;
      await page.waitForTimeout(500);
    }
    throw new HHAutomationError("auth", "Не удалось подтвердить сессию HH. Нажмите «Войти в HH», затем повторите запуск.");
  }

  async waitHumanDelay(page: Page, delayRange: DelayRange, stopRequested?: StopSignal) {
    await this.waitForCaptcha(page, stopRequested);
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
    await this.waitForCaptcha(page, stopRequested);
  }

}
