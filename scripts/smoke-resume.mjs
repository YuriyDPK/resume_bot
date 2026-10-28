import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  const saves = [];
  let failure = false;
  let hold;
  let readStarted;
  let fields = { keywords: "Переводчик", city: "Казань", minSalary: 90000, remoteOnly: true, resumeText: "Желаемая должность: Переводчик\nПеревод технических документов и работа с терминологией." };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/hh/browser*", (route) => route.fulfill({ json: { available: false, state: { running: false } } }));
  await page.route("**/api/resume/parse", async (route) => {
    assert.equal(route.request().method(), "POST");
    assert.match(route.request().postDataJSON().resumeUrl, /^https:\/\/hh\.ru\/resume\//);
    readStarted?.();
    if (hold) await hold;
    await route.fulfill({ status: failure ? 400 : 200, json: failure ? { error: "Не удалось прочитать резюме" } : { parsed: { fields, notes: [] } } });
  });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() !== "PUT") { await route.continue(); return; }
    const body = route.request().postDataJSON();
    saves.push(body);
    await route.fulfill({ json: { settings: { ...body, keywords: body.keywords.split("\n").map((value) => ({ value })) } } });
  });
  await page.goto(baseUrl + "/settings", { waitUntil: "networkidle" });
  const source = page.getByLabel("Ссылка на резюме HH", { exact: true });
  const keywords = page.getByLabel(/^Ключевые слова для поиска/);
  const city = page.getByLabel("Города (через запятую)", { exact: true });
  const salary = page.getByLabel("Минимальная зарплата", { exact: true });
  const profile = page.getByLabel(/^Профиль резюме для подбора/);
  const remote = page.getByRole("checkbox", { name: "Только удалённая работа", exact: true });
  const parse = page.getByRole("button", { name: "Распарсить по ссылке", exact: true });
  const dialog = page.getByRole("dialog", { name: "В настройках уже есть данные" });
  await page.getByRole("button", { name: "Загрузить из HH", exact: true }).waitFor();
  await source.fill("https://hh.ru/resume/fixture");
  await keywords.fill("Мой запрос");
  await page.getByRole("checkbox", { name: "Искать по всей России", exact: true }).uncheck();
  await city.fill("Москва");
  await salary.fill("");
  await profile.fill("Мой профиль");
  await remote.uncheck();
  await parse.click();
  await dialog.waitFor();
  assert.equal(await keywords.inputValue(), "Мой запрос");
  assert.equal(await salary.inputValue(), "");
  assert.equal(saves.length, 0);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await profile.inputValue(), "Мой профиль");

  await parse.click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Заполнить только пустые", exact: true }).click();
  assert.equal(await keywords.inputValue(), "Мой запрос");
  assert.equal(await city.inputValue(), "Москва");
  assert.equal(await salary.inputValue(), "90000");
  assert.equal(await profile.inputValue(), "Мой профиль");
  assert.equal(await remote.isChecked(), false);
  assert.equal(saves.length, 0);

  await parse.click();
  await dialog.waitFor();
  await dialog.screenshot({ path: "test-results/resume-merge-ui.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await dialog.boundingBox();
  assert.ok(box.width <= 390 && box.x >= 0);
  await dialog.getByRole("button", { name: "Заменить заполненные поля", exact: true }).click();
  assert.equal(await keywords.inputValue(), fields.keywords);
  assert.equal(await city.inputValue(), fields.city);
  assert.equal(await profile.inputValue(), fields.resumeText);
  assert.equal(await remote.isChecked(), true);
  assert.equal(saves.length, 0);
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "Настройки сохранены" }).waitFor();
  assert.equal(saves.length, 1);
  assert.equal(saves[0].keywords, "Переводчик");
  assert.equal(saves[0].city, "Казань");

  failure = true;
  await parse.click();
  await page.getByRole("status").filter({ hasText: "Не удалось прочитать резюме" }).waitFor();
  assert.equal(await profile.inputValue(), fields.resumeText);
  assert.equal(await dialog.count(), 0);
  failure = false;

  // Editing the source URL during a slow read cannot apply the old result.
  let release;
  hold = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { readStarted = resolve; });
  await parse.click();
  await started;
  await source.fill("https://hh.ru/resume/changed");
  release();
  await page.getByRole("status").filter({ hasText: "Ссылка изменилась" }).waitFor();
  assert.equal(await dialog.count(), 0);
  assert.equal(await city.inputValue(), "Казань");
  hold = null; readStarted = null;

  fields = { ...fields, remoteOnly: false };
  await source.fill("https://hh.ru/resume/fixture");
  await keywords.fill(""); await city.fill(""); await salary.fill(""); await profile.fill(""); await remote.uncheck();
  await parse.click();
  await page.getByRole("status").filter({ hasText: "Пустые поля заполнены" }).waitFor();
  assert.equal(await dialog.count(), 0);
  assert.equal(await keywords.inputValue(), "Переводчик");
  assert.equal(await city.inputValue(), "Казань");
  assert.equal(saves.length, 1);
  assert.deepEqual(errors, []);
  console.log("OK resume parse UI: preview, Cancel, fill empty, replace, explicit Save, mobile, failure and stale-link protection");
  console.log("No HH requests or real settings writes were made.");
} finally { await browser.close(); }
