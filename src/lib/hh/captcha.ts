import type { Page } from "playwright";
import { HHAutomationError, type StopSignal } from "@/lib/hh/types";
import { forwardBrowserInput, parseBrowserInput, type BrowserInput } from "@/lib/hh/browser-view";

export type CaptchaInput = BrowserInput | { type: "continue" };

export function parseCaptchaInput(value: unknown): CaptchaInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (input.type === "continue") return { type: "continue" };
  return parseBrowserInput(value);
}

// This controller never solves challenges. It keeps the exact page alive and
// forwards only the human's clicks/keystrokes from the local app to that page.
export class CaptchaController {
  private page?: Page;
  private resumeRequested = false;
  private onChange?: (waiting: boolean, details?: ManualPauseDetails) => void;

  constructor(private detect: (page: Page) => Promise<boolean>) {}

  setHandler(handler: (waiting: boolean, details?: ManualPauseDetails) => void) {
    this.onChange = handler;
  }

  getPage() { return this.page; }

  async wait(page: Page, stopRequested?: StopSignal, details?: ManualPauseDetails) {
    if (!details && !await this.detect(page)) return false;
    this.page = page;
    this.resumeRequested = false;
    if (details) this.onChange?.(true, details);
    else this.onChange?.(true);
    try {
      let readyChecks = 0;
      while (true) {
        if (stopRequested?.()) throw new HHAutomationError("stopped", "Процесс остановлен пользователем во время ожидания CAPTCHA");
        if (page.isClosed()) throw new HHAutomationError("stopped", "Окно ручной проверки закрыто пользователем");
        const challenge = await this.detect(page);
        const content = challenge ? "" : await page.locator("body").innerText({ timeout: 1000 }).catch(() => "");
        readyChecks = this.resumeRequested && !challenge && content.trim() ? readyChecks + 1 : 0;
        // A disappearing widget is not a solution. Resume only after the
        // human explicitly confirms, and never on an intermediate document.
        if (readyChecks >= 2) return true;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      this.page = undefined;
      this.resumeRequested = false;
      this.onChange?.(false);
    }
  }

  async screenshot() {
    if (!this.page || this.page.isClosed()) return null;
    return this.page.screenshot({ type: "png", timeout: 3000 }).catch(() => null);
  }

  async input(input: CaptchaInput) {
    const page = this.page;
    // Once Continue was accepted, reject late input while the queue resumes.
    if (!page || page.isClosed() || this.resumeRequested) {
      throw new HHAutomationError("browser", "Проверка HH уже завершена или не запущена");
    }
    if (input.type === "continue") {
      if (await this.detect(page)) throw new Error("Проверка HH ещё открыта. Сначала завершите её, затем нажмите «Проверить и продолжить».");
      this.resumeRequested = true;
    } else await forwardBrowserInput(page, input);
  }
}

export type ManualPauseDetails = { reason: "form"; message: string };
