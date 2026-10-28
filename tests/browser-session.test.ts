import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright";
import { HHBrowserSession } from "@/lib/hh/browser-session";

vi.mock("@/lib/log", () => ({ writeLog: vi.fn() }));

describe("browser mode and lifecycle", () => {
  let session: HHBrowserSession;
  const locator = { first: () => locator, innerText: vi.fn(async () => "Мои резюме"), isVisible: vi.fn(async () => false) };
  const heading = { isVisible: vi.fn(async () => true) };
  const page = { isClosed: vi.fn(() => false), frames: () => [], bringToFront: vi.fn(async () => undefined), goto: vi.fn(), url: vi.fn(() => "https://hh.ru/applicant/resumes"), locator: () => locator, getByRole: () => heading };
  const context = { pages: () => page.isClosed() ? [] : [page], newPage: vi.fn(async () => page), storageState: vi.fn(), close: vi.fn(async () => undefined) };
  const browser = { isConnected: vi.fn(() => true), newContext: vi.fn(async () => context), close: vi.fn(async () => undefined) };

  beforeEach(() => {
    vi.clearAllMocks();
    context.storageState.mockResolvedValue({});
    page.goto.mockReset();
    page.isClosed.mockReturnValue(false);
    page.url.mockReturnValue("https://hh.ru/applicant/resumes");
    heading.isVisible.mockResolvedValue(true);
    locator.isVisible.mockResolvedValue(false);
    locator.innerText.mockResolvedValue("Мои резюме");
    browser.isConnected.mockReturnValue(true);
    vi.spyOn(chromium, "launch").mockResolvedValue(browser as unknown as Browser);
    session = new HHBrowserSession();
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("keeps login and background work in the same headless browser without opening a desktop window", async () => {
    await session.ensureAuthorized(undefined, true);
    expect(chromium.launch).toHaveBeenLastCalledWith({ headless: true });
    await session.ensureBrowser();
    expect(context.close).not.toHaveBeenCalled();
    expect(chromium.launch).toHaveBeenCalledTimes(1);
  });

  it("exposes only an existing page and invalidates its identity when the browser is replaced", async () => {
    expect(session.getBrowserView().available).toBe(false);
    await session.ensureBrowser();
    const view = session.getBrowserView();
    expect(view).toMatchObject({ available: true, url: "https://hh.ru/applicant/resumes" });
    expect(view.pageId).toBeTruthy();
    await session.close();
    expect(session.getBrowserView().available).toBe(false);
    await expect(session.sendBrowserInput(view.pageId!, { type: "text", text: "stale input" })).rejects.toThrow("изменилась");
  });

  it("recovers from a manually closed browser", async () => {
    await session.ensureBrowser();
    browser.isConnected.mockReturnValueOnce(false);
    await session.ensureBrowser();
    expect(chromium.launch).toHaveBeenCalledTimes(2);
  });

  it.each([
    "https://hh.ru/applicant/profile/me",
    "https://spb.hh.ru/applicant/profile/me?hhtmFrom=main",
    "https://hh.ru/applicant/profile/me/"
  ])("recognizes the actual owner profile after HH redirects to %s", async (url) => {
    page.url.mockReturnValue(url);
    await session.ensureAuthorized(undefined, true);
    expect(context.storageState).toHaveBeenCalledTimes(1);
  });

  it("does not confirm a profile URL until its protected content is rendered", async () => {
    vi.useFakeTimers();
    page.url.mockReturnValue("https://hh.ru/applicant/profile/me");
    heading.isVisible.mockResolvedValue(false);
    const login = session.ensureAuthorized(undefined, true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(context.storageState).not.toHaveBeenCalled();
    heading.isVisible.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(500);
    await login;
    expect(context.storageState).toHaveBeenCalledTimes(1);
  });

  it("does not treat public resume links or missing login buttons as an authenticated account", async () => {
    vi.useFakeTimers();
    page.url.mockReturnValue("https://hh.ru");
    const login = session.ensureAuthorized(undefined, true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(context.storageState).not.toHaveBeenCalled();
    expect(browser.close).not.toHaveBeenCalled();
    page.url.mockReturnValue("https://hh.ru/applicant/resumes");
    await vi.advanceTimersByTimeAsync(500);
    await login;
    expect(context.storageState).toHaveBeenCalledTimes(1);
  });

  it("waits through a blank page while the login form is loading", async () => {
    vi.useFakeTimers();
    heading.isVisible.mockResolvedValue(false);
    locator.innerText.mockResolvedValue("");
    const login = session.ensureAuthorized(undefined, true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(context.storageState).not.toHaveBeenCalled();
    heading.isVisible.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(500);
    await login;
  });

  it("leaves HTTP 403 and CAPTCHA open for the user, then accepts a real account page", async () => {
    vi.useFakeTimers();
    page.goto.mockResolvedValue({ ok: () => false, status: () => 403 });
    page.url.mockReturnValue("https://hh.ru/account/login");
    locator.innerText.mockResolvedValue("Подтвердите, что вы человек");
    const login = session.ensureAuthorized(undefined, true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(browser.close).not.toHaveBeenCalled();
    expect(context.storageState).not.toHaveBeenCalled();
    page.url.mockReturnValue("https://hh.ru/applicant/resumes");
    locator.innerText.mockResolvedValue("Мои резюме");
    await session.sendCaptchaInput({ type: "continue" });
    await vi.advanceTimersByTimeAsync(1500);
    await login;
  });

  it("keeps a navigation failure recoverable instead of closing the login window", async () => {
    vi.useFakeTimers();
    page.goto.mockRejectedValueOnce(new Error("net::ERR_CONNECTION_RESET"));
    page.url.mockReturnValue("about:blank");
    const progress = vi.fn();
    const login = session.ensureAuthorized(undefined, true, progress);
    await vi.advanceTimersByTimeAsync(1500);
    expect(progress).toHaveBeenLastCalledWith(expect.stringContaining("Перезагрузить HH"));
    expect(browser.close).not.toHaveBeenCalled();
    page.url.mockReturnValue("https://hh.ru/applicant/resumes");
    await vi.advanceTimersByTimeAsync(500);
    await login;
  });

  it("does not overwrite a saved session when login is cancelled", async () => {
    vi.useFakeTimers();
    page.url.mockReturnValue("https://hh.ru/account/login");
    let stopped = false;
    const login = session.ensureAuthorized(() => stopped, true);
    await vi.advanceTimersByTimeAsync(500);
    stopped = true;
    const result = expect(login).rejects.toMatchObject({ code: "stopped" });
    await vi.advanceTimersByTimeAsync(500);
    await result;
    await session.close();
    expect(context.storageState).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalled();
  });
});
