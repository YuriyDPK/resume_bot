import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [path, title] of [["/", "Обзор"], ["/settings", "Настройки"], ["/vacancies", "Вакансии"], ["/auto-apply", "Автоотклики"]]) {
    const response = await page.goto(baseUrl + path, { waitUntil: "networkidle" });
    assert.equal(response?.status(), 200, path);
    assert.equal(await page.locator("h1").innerText(), title);
    console.log("OK page", path);
  }
  for (const path of ["/api/settings", "/api/dashboard", "/api/vacancies", "/api/logs", "/api/auto-apply", "/api/hh/browser"]) {
    const response = await page.request.get(baseUrl + path);
    assert.equal(response.status(), 200, path);
    await response.json();
    console.log("OK API", path);
  }
  await page.goto(baseUrl + "/settings");
  await page.getByText("Встроенный браузер HH", { exact: true }).waitFor();

  // All subsequent views and commands are intercepted local fixtures. They
  // never start the bot, authenticate with HH, or submit real applications.
  const fixture = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  await fixture.setContent('<main style="padding:48px;font:20px system-ui"><h1>Страница HH · тест</h1><p>Синтетическая страница для проверки встроенного браузера.</p><input style="padding:12px"><button style="padding:12px">Проверить</button></main>');
  const image = await fixture.screenshot({ type: "jpeg" });
  await fixture.close();
  let running = true, waiting = false, available = true;
  let mode = "auto", reason = "captcha", pauseId = 0;
  let captchaDone = false, formDone = false, frameCount = 0;
  const inputs = [];
  const state = () => ({ running, mode, waitingForCaptcha: waiting && reason === "captcha", waitingForUser: waiting,
    manualPauseId: pauseId, manualActionReason: reason, message: "Тест встроенного браузера", processed: 0, target: 5, startedAt: "fixture" });
  await page.route("**/api/auto-apply", async (route) => {
    if (route.request().method() === "POST") { waiting = false; running = false; available = false; }
    await route.fulfill({ json: { state: state() } });
  });
  await page.route("**/api/hh/browser*", async (route) => {
    if (route.request().method() === "GET") {
      if (new URL(route.request().url()).searchParams.has("frame")) {
        frameCount += 1;
        await route.fulfill({ contentType: "image/jpeg", body: image, headers: { "X-HH-Page-Id": "fixture-page" } });
      } else await route.fulfill({ json: { available, pageId: "fixture-page", url: "https://hh.ru/vacancy/fixture", state: state(),
        interactive: available && (waiting || mode === "login"), login: mode === "login" } });
    } else {
      const body = route.request().postDataJSON();
      assert.equal(body.pageId, "fixture-page");
      assert.equal(body.pauseId, pauseId);
      inputs.push(body.input);
      if (body.input.type === "continue") {
        if (!captchaDone) { await route.fulfill({ status: 409, json: { error: "Проверка ещё открыта" } }); return; }
        if (reason === "captcha") { reason = "form"; pauseId += 1; }
        else if (formDone) { waiting = false; available = false; running = false; }
      }
      await route.fulfill({ json: { ok: true } });
    }
  });
  await page.reload();
  const workspace = page.getByRole("region", { name: "Браузер HH", exact: true });
  await workspace.waitFor();
  const ready = () => page.waitForFunction(() => document.querySelector('.hh-viewport img')?.naturalWidth > 0);
  await ready();
  const screen = page.getByRole("application", { name: "Страница HH внутри бота" });
  await screen.dispatchEvent("pointerdown", { button: 0, clientX: 70, clientY: 60 });
  await screen.dispatchEvent("pointerup", { button: 0, clientX: 70, clientY: 60 });
  assert.deepEqual(inputs, []);
  await page.getByRole("button", { name: "Свернуть", exact: true }).click();
  await page.getByRole("button", { name: "Показать браузер HH" }).waitFor();
  await page.waitForTimeout(600);
  const collapsedCount = frameCount;
  await page.waitForTimeout(1100);
  assert.equal(frameCount, collapsedCount);
  waiting = true; pauseId += 1;
  const manual = page.getByRole("region", { name: "Решите CAPTCHA вручную", exact: true });
  await manual.waitFor();
  await ready();
  async function command(action, type) {
    const received = page.waitForResponse((response) => response.url().endsWith("/api/hh/browser") && response.request().method() === "POST" && response.request().postDataJSON().input.type === type);
    await action();
    await received;
  }
  await command(() => screen.click(), "pointer");
  await command(() => screen.press("a"), "text");
  await command(() => screen.press("Backspace"), "key");
  await page.getByLabel("Текст для выбранного поля HH").fill("fixture text");
  await command(() => page.getByRole("button", { name: "Ввести текст", exact: true }).click(), "text");
  assert.ok(inputs.some((input) => input.type === "text" && input.text === "fixture text"));
  await page.getByRole("button", { name: "Проверить и продолжить", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Проверка ещё открыта" }).waitFor();
  assert.equal(waiting, true);
  captchaDone = true;
  await page.getByRole("button", { name: "Проверить и продолжить", exact: true }).click();
  const form = page.getByRole("region", { name: "Завершите действие на HH", exact: true });
  await form.waitFor();
  assert.equal(await page.getByRole("button", { name: "Проверить и продолжить", exact: true }).isEnabled(), true);
  await page.getByRole("button", { name: "Свернуть", exact: true }).click();
  await page.getByRole("button", { name: "HH ждёт вашего действия" }).click();
  await form.waitFor();
  await ready();
  await form.screenshot({ path: "test-results/hh-browser-ui.png" });
  formDone = true;
  await page.getByRole("button", { name: "Проверить и продолжить", exact: true }).click();
  await form.waitFor({ state: "hidden" });
  running = true; available = true; mode = "login"; pauseId += 1;
  const login = page.getByRole("region", { name: "Войдите в HH", exact: true });
  await login.waitFor();
  await ready();
  await command(() => screen.press("x"), "text");
  await command(() => page.getByRole("button", { name: "Перезагрузить HH", exact: true }).click(), "reload");
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await login.boundingBox();
  assert.ok(box.width <= 390 && box.x >= 0);
  await page.getByRole("button", { name: "Остановить процесс", exact: true }).click();
  await login.waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log("OK embedded browser: preview, collapse, keyboard, manual confirmation, login, mobile and Stop");
  console.log("Smoke checks passed. No HH actions were started.");
} finally { await browser.close(); }
