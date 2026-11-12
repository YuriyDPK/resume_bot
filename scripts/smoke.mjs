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
  await fixture.setContent('<main style="padding:48px;font:20px system-ui"><h1>Страница HH · тест</h1><p>Синтетическая страница для проверки встроенного браузера.</p><input aria-label="Тестовое поле" style="padding:12px"><button style="padding:12px">Проверить</button><input aria-label="Поле при увеличении" style="position:absolute;left:1000px;top:650px;padding:12px"></main>');
  const image = await fixture.screenshot({ type: "jpeg" });
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
      } else if (waiting && reason === "captcha") {
        const input = body.input;
        if (input.type === "pointer") {
          await fixture.mouse.move(input.x, input.y);
          if (input.action === "down") await fixture.mouse.down();
          if (input.action === "up") await fixture.mouse.up();
        } else if (input.type === "text") await fixture.keyboard.type(input.text);
        else if (input.type === "key") await fixture.keyboard.press(input.key);
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
  for (const label of ["Ввести текст", "Enter", "Tab", "⌫", "Выше", "Ниже"]) assert.equal(await manual.getByRole("button", { name: label, exact: true }).count(), 0);
  assert.equal(await manual.getByLabel("Текст для выбранного поля HH").count(), 0);
  async function command(action, type) {
    const received = page.waitForResponse((response) => response.url().endsWith("/api/hh/browser") && response.request().method() === "POST" && response.request().postDataJSON().input.type === type);
    await action();
    await received;
  }
  await command(() => screen.click(), "pointer");
  await command(() => screen.press("a"), "text");
  await command(() => screen.press("Backspace"), "key");
  const target = await fixture.getByLabel("Тестовое поле").boundingBox();
  const imageRect = await screen.locator("img").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const scale = Math.min(rect.width / element.naturalWidth, rect.height / element.naturalHeight);
    return { x: rect.left + (rect.width - element.naturalWidth * scale) / 2, y: rect.top + (rect.height - element.naturalHeight * scale) / 2, scale };
  });
  await page.mouse.click(imageRect.x + (target.x + 10) * imageRect.scale, imageRect.y + (target.y + 10) * imageRect.scale);
  for (const key of ["A", "2", "b", "7"]) await command(() => screen.press(key), "text");
  assert.equal(await fixture.getByLabel("Тестовое поле").inputValue(), "A2b7");
  await page.setViewportSize({ width: 390, height: 844 });
  await manual.getByRole("button", { name: "На весь экран", exact: true }).click();
  assert.equal(await manual.evaluate((node) => node.classList.contains("expanded")), true);
  await manual.getByRole("button", { name: "Увеличить масштаб", exact: true }).click({ clickCount: 4, delay: 100 });
  assert.equal(await manual.getByRole("button", { name: "Масштаб 300%, вернуть обычный" }).count(), 1);
  await page.screenshot({ path: "test-results/hh-browser-zoom-mobile.png" });
  const pan = manual.getByRole("button", { name: "Перемещать увеличенное изображение" });
  await pan.click();
  const farTarget = await fixture.getByLabel("Поле при увеличении").boundingBox();
  await screen.evaluate((viewport, target) => {
    const img = viewport.querySelector("img");
    const rect = img.getBoundingClientRect();
    const box = viewport.getBoundingClientRect();
    const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
    const left = rect.left;
    const top = rect.top;
    viewport.scrollLeft += left + (target.x + 10) * scale - box.left - box.width / 2;
    viewport.scrollTop += top + (target.y + 10) * scale - box.top - box.height / 2;
  }, farTarget);
  const scrollPosition = await screen.evaluate((node) => ({ left: node.scrollLeft, top: node.scrollTop }));
  assert.ok(scrollPosition.left > 0 && scrollPosition.top > 0);
  const screenBox = await screen.boundingBox();
  const commandsBeforePan = inputs.length;
  await page.mouse.move(screenBox.x + screenBox.width / 2, screenBox.y + screenBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(screenBox.x + screenBox.width / 2 + 20, screenBox.y + screenBox.height / 2 + 20);
  await page.mouse.up();
  assert.ok((await screen.evaluate((node) => node.scrollLeft)) < scrollPosition.left);
  assert.equal(inputs.length, commandsBeforePan);
  await pan.click();
  const zoomRect = await screen.locator("img").evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const scale = Math.min(rect.width / element.naturalWidth, rect.height / element.naturalHeight);
    return { x: rect.left, y: rect.top, scale };
  });
  await page.mouse.click(zoomRect.x + (farTarget.x + 10) * zoomRect.scale, zoomRect.y + (farTarget.y + 10) * zoomRect.scale);
  await command(() => screen.press("Z"), "text");
  assert.equal(await fixture.getByLabel("Поле при увеличении").inputValue(), "Z");
  await manual.getByRole("button", { name: "Масштаб 300%, вернуть обычный" }).click();
  await manual.getByRole("button", { name: "Выйти из полного экрана", exact: true }).click();
  await manual.getByRole("button", { name: "На весь экран", exact: true }).waitFor();
  assert.equal(await manual.evaluate((node) => node.classList.contains("expanded")), false);
  await manual.evaluate((node) => { node.requestFullscreen = () => Promise.reject(new Error("Fullscreen unavailable")); });
  await manual.getByRole("button", { name: "На весь экран", exact: true }).click();
  assert.equal(await manual.evaluate((node) => node.classList.contains("expanded")), true);
  await manual.getByRole("button", { name: "Выйти из полного экрана", exact: true }).click();
  await manual.getByRole("button", { name: "На весь экран", exact: true }).waitFor();
  await page.setViewportSize({ width: 1280, height: 800 });
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
