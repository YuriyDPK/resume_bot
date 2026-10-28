import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  const starts = [];
  let state = { running: false, mode: "idle", processed: 0, target: 0, manualPauseId: 0, skipAdditionalRequirements: false, message: "Тест запуска" };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/hh/browser*", (route) => route.fulfill({ json: { available: false, state: { running: false } } }));
  await page.route("**/api/auto-apply", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      if (body.action === "start") {
        starts.push(body);
        state = { ...state, running: true, mode: "auto", target: body.limit, skipAdditionalRequirements: body.skipAdditionalRequirements };
      } else if (body.action === "stop") state = { ...state, running: false, mode: "idle" };
      else throw new Error("Unexpected fixture action");
    }
    await route.fulfill({ json: { state } });
  });
  await page.goto(baseUrl + "/auto-apply", { waitUntil: "networkidle" });
  const checkbox = page.getByRole("checkbox", { name: "Пропускать вакансии с дополнительными требованиями", exact: true });
  await checkbox.check();
  await page.getByLabel("Количество откликов", { exact: true }).fill("10");
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[type="checkbox"]')?.disabled);
  assert.equal(await checkbox.isChecked(), true);
  assert.equal(starts.length, 1);
  assert.equal(starts[0].skipAdditionalRequirements, true);
  assert.equal(starts[0].limit, 10);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await checkbox.uncheck();
  await page.screenshot({ path: "test-results/auto-apply-options-ui.png" });
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input[type="checkbox"]')?.disabled);
  assert.equal(starts.length, 2);
  assert.equal(starts[1].skipAdditionalRequirements, false);
  assert.equal(await checkbox.isChecked(), false);
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await checkbox.boundingBox();
  assert.ok(box.x >= 0 && box.x < 390);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  assert.deepEqual(errors, []);
  console.log("OK auto-apply options: both policies, Start payload, disabled controls during a run, mobile and Stop");
  console.log("No real bot job or HH action was started.");
} finally { await browser.close(); }
