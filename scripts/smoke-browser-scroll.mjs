import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.SMOKE_BASE_URL;
if (!base || base.endsWith(":3000")) throw new Error("Use an isolated fixture server, not the user's bot on port 3000.");
const settings = (await (await fetch(base + "/api/settings")).json()).settings;
assert.equal(settings.resumeText, "SMOKE_WORKSPACE_FIXTURE", "Refusing to run outside the isolated fixture");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 800 } });
  const actions = [];
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aZkAAAAASUVORK5CYII=", "base64");
  await page.route("**/api/hh/browser**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      actions.push(route.request().postDataJSON().input);
      await new Promise((resolve) => setTimeout(resolve, 180));
      return route.fulfill({ json: { ok: true } });
    }
    if (url.searchParams.has("stream")) return route.fulfill({ status: 409 });
    if (url.searchParams.has("frame")) return route.fulfill({ status: 200, contentType: "image/png", headers: { "X-HH-Page-Id": "fixture-page" }, body: pixel });
    return route.fulfill({ json: { available: true, pageId: "fixture-page", url: "https://hh.ru/fixture", interactive: true, login: true,
      state: { running: true, startedAt: "fixture", waitingForUser: false, manualPauseId: 0, processed: 0, target: 1, message: "Тест" } } });
  });
  await page.goto(base + "/settings");
  const viewport = page.getByRole("application", { name: "Страница HH внутри бота" });
  await viewport.locator("img").waitFor();
  await page.waitForFunction(() => document.querySelector(".hh-viewport img")?.naturalWidth > 0);
  await page.evaluate(() => window.scrollTo(0, 250));
  await page.waitForTimeout(100);
  const scrollBefore = await page.evaluate(() => window.scrollY);
  assert.ok(scrollBefore > 0, "fixture must have a scrollable outer page");
  const box = await viewport.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 60);
  await page.waitForTimeout(900);
  assert.equal(await page.evaluate(() => window.scrollY), scrollBefore, "the outer page must stay still");
  const scrollActions = actions.filter((action) => action.type === "scroll");
  assert.equal(scrollActions.reduce((sum, action) => sum + action.deltaY, 0), 360, "all wheel distance must reach HH");
  assert.ok(scrollActions.length < 6, "queued wheel events should be combined");
  await page.getByRole("button", { name: "Увеличить масштаб" }).click();
  await page.getByRole("button", { name: "Перемещать увеличенное изображение" }).click();
  const sentBeforePanning = actions.length;
  const previousTop = await viewport.evaluate((element) => element.scrollTop);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(250);
  assert.ok(await viewport.evaluate((element) => element.scrollTop) > previousTop, "panning mode should scroll the enlarged image");
  assert.equal(actions.length, sentBeforePanning, "panning must not scroll HH");
  console.log("OK browser wheel scrolls HH without moving the outer page; panning scrolls only the image.");
} finally { await browser.close(); }
