import { choose } from "./ui-controls.mjs";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.SMOKE_BASE_URL;
if (!base || base.endsWith(":3000")) throw new Error("Use an isolated fixture server, not the user's bot on port 3000.");
const settings = (await (await fetch(base + "/api/settings")).json()).settings;
assert.equal(settings.resumeText, "SMOKE_WORKSPACE_FIXTURE", "Refusing mutations outside the isolated fixture");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [], selectedRuns = [], autoRuns = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.route("**/api/vacancies/bulk", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action !== "apply") { await route.continue(); return; }
    selectedRuns.push(body); await route.fulfill({ json: { state: { running: false } } });
  });
  await page.route("**/api/auto-apply", async (route) => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    autoRuns.push(route.request().postDataJSON());
    await route.fulfill({ json: { state: { running: false, mode: "idle", message: "Тестовый запуск", processed: 0, target: 0 } } });
  });

  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /Иван Тестовый/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Войти в HH", exact: true }).count(), 0);
  assert.equal(await page.locator('.metric-link[href="/vacancies?status=all"]').count(), 1);
  await page.screenshot({ path: "test-results/workspace-overview.png", fullPage: true });
  await page.locator('.metric-link[href*="appliedToday"]').click();
  await page.waitForURL((url) => url.searchParams.get("appliedToday") === "true");
  assert.equal(await page.getByLabel("Статус вакансий").getAttribute("data-value"), "applied");
  const applied = await (await page.request.get(base + "/api/vacancies?status=applied&appliedToday=true")).json();
  assert.ok(applied.total > 0);
  assert.ok(applied.vacancies.every((row) => row.status === "applied"));

  await page.goto(base + "/vacancies?status=all");
  await choose(page.getByLabel("Вакансий на странице"), "10");
  await page.waitForURL((url) => url.searchParams.get("pageSize") === "10");
  await page.getByRole("button", { name: "Следующая страница вакансий", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("page") === "2");
  await page.getByLabel("Поиск вакансий").fill("Бухгалтер");
  await choose(page.getByLabel("Статус вакансий"), "all");
  await page.getByText("Дополнительные фильтры", { exact: true }).click();
  await page.getByLabel("Фильтр по городу").fill("Казань");
  await page.getByLabel("Минимальное совпадение").fill("60");
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("q") === "Бухгалтер" && url.searchParams.get("page") === "1");
  const titles = await page.locator(".vacancy-title-cell a").allTextContents();
  assert.ok(titles.length > 0 && titles.every((title) => title.includes("Бухгалтер")));

  await page.goto(base + "/vacancies?status=active");
  const selectTwo = async () => { await page.locator("tbody .row-checkbox").nth(0).check(); await page.locator("tbody .row-checkbox").nth(1).check(); };
  await selectTwo();
  await page.locator(".selection-toolbar").getByRole("button", { name: "Пропустить", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Обработано вакансий: 2" }).waitFor();
  const skipped = await (await page.request.get(base + "/api/vacancies?status=skipped&pageSize=100")).json();
  assert.ok(skipped.vacancies.some((row) => row.id === 1) && skipped.vacancies.some((row) => row.id === 2));
  await page.goto(base + "/vacancies?status=skipped");
  await selectTwo();
  await page.locator(".selection-toolbar").getByRole("button", { name: "В очередь", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Обработано вакансий: 2" }).waitFor();
  const active = await (await page.request.get(base + "/api/vacancies?status=active&pageSize=100")).json();
  assert.ok(active.vacancies.some((row) => row.id === 1) && active.vacancies.some((row) => row.id === 2));

  await page.goto(base + "/vacancies?status=active");
  await selectTwo();
  const download = page.waitForEvent("download");
  await page.locator(".selection-toolbar").getByRole("button", { name: "CSV", exact: true }).click();
  await (await download).saveAs("test-results/workspace-selected.csv");
  assert.match(await fs.readFile("test-results/workspace-selected.csv", "utf8"), /Вакансия/);
  await page.screenshot({ path: "test-results/workspace-vacancies.png", fullPage: true });
  await page.locator(".selection-toolbar").getByRole("button", { name: "Откликнуться", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "только на выбранные" }).waitFor();
  assert.equal(selectedRuns.length, 1); assert.equal(selectedRuns[0].ids.length, 2);
  const countBefore = (await (await page.request.get(base + "/api/vacancies?status=all")).json()).total;
  await page.locator("tbody .row-checkbox").nth(0).check();
  await page.locator(".selection-toolbar").getByRole("button", { name: "Удалить", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Обработано вакансий: 1" }).waitFor();
  assert.equal((await (await page.request.get(base + "/api/vacancies?status=all")).json()).total, countBefore - 1);
  const invalid = await page.request.post(base + "/api/vacancies/bulk", { data: { action: "delete", ids: [] } });
  assert.equal(invalid.status(), 400);

  await page.goto(base + "/auto-apply");
  const count = page.getByLabel("Количество откликов", { exact: true });
  const slider = page.getByRole("slider", { name: "Количество откликов ползунком" });
  await count.fill("76"); assert.equal(await slider.inputValue(), "76");
  await slider.press("Home"); await slider.press("ArrowRight"); assert.equal(await count.inputValue(), "2");
  await count.fill(""); assert.equal(await page.getByRole("button", { name: "Start", exact: true }).isDisabled(), true);
  await count.fill("50");
  await page.getByRole("checkbox", { name: "Пропускать вакансии с дополнительными требованиями", exact: true }).check();
  await page.screenshot({ path: "test-results/workspace-auto-apply.png", fullPage: true });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForTimeout(200);
  assert.equal(autoRuns[0].limit, 50); assert.equal(autoRuns[0].skipAdditionalRequirements, true);

  await page.goto(base + "/settings");
  assert.equal(await page.locator(".settings-section").count(), 4);
  const upload = await page.getByRole("button", { name: "Загрузить из HH", exact: true }).boundingBox();
  const parse = await page.getByRole("button", { name: "Распарсить по ссылке", exact: true }).boundingBox();
  assert.ok(Math.abs(upload.y - parse.y) < 3 && parse.x > upload.x);
  await page.screenshot({ path: "test-results/workspace-settings.png", fullPage: true });

  await page.goto(base);
  await page.getByLabel("Поиск по логам").fill("SMOKE");
  await choose(page.getByLabel("Порядок логов"), "asc");
  const ascendingLogs = page.waitForResponse((response) => response.url().includes("/api/logs?") && response.url().includes("sort=asc"));
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await ascendingLogs;
  await page.waitForFunction(() => document.querySelector('.activity-message > span')?.textContent === 'SMOKE_ERROR_B');
  await choose(page.getByLabel("Уровень логов"), "error");
  const errorLogs = page.waitForResponse((response) => response.url().includes("/api/logs?") && response.url().includes("level=error"));
  await page.getByRole("button", { name: "Показать", exact: true }).click();
  await errorLogs;
  await page.waitForTimeout(150);
  await page.locator(".activity-row .row-checkbox").first().check();
  await page.getByRole("button", { name: "Удалить выбранные", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Удалено записей: 1" }).waitFor();
  await page.getByRole("button", { name: "Очистить по фильтрам", exact: true }).click();
  await page.getByText("Событий по выбранным фильтрам нет.", { exact: true }).waitFor();
  const surviving = await (await page.request.get(base + "/api/logs?q=SMOKE")).json();
  assert.ok(surviving.logs.every((log) => log.level !== "error") && surviving.total === 2);
  await page.getByRole("button", { name: "Выйти из HH", exact: true }).click();
  await page.getByRole("button", { name: "Войти в HH", exact: true }).waitFor();
  assert.equal((await (await page.request.get(base + "/api/auth/hh")).json()).account.status, "disconnected");

  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/", "/vacancies", "/auto-apply", "/settings"]) {
    await page.goto(base + path, { waitUntil: "networkidle" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Mobile overflow on " + path);
  }
  assert.deepEqual(errors, []);
  console.log("OK full workspace: real fixture filtering, pagination, bulk queue/deletion, CSV, selected launch, range/input, settings, log scopes, profile/logout and mobile.");
  console.log("The user's database and session were not modified. No HH application or search was started.");
} finally { await browser.close(); }
