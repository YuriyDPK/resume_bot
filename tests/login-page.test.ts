import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
// @ts-expect-error The gateway is an executable JavaScript module.
import { loginPage } from "../server/login-page.mjs";

describe("service login form", () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); page = await browser.newPage(); });
  afterAll(async () => { await browser?.close(); });
  it("keeps the email and password on a failed login and toggles password visibility", async () => {
    await page.route("https://fixture.test/**", async (route) => {
      if (route.request().method() === "POST") return route.fulfill({ status: 400, json: { error: "Неверная почта или пароль." } });
      return route.fulfill({ contentType: "text/html; charset=utf-8", body: loginPage() });
    });
    await page.goto("https://fixture.test/");
    await page.locator("#email").fill("a@example.test");
    await page.locator("#password").fill("incorrect-password");
    await page.getByRole("button", { name: "Показать пароль" }).click();
    expect(await page.locator("#password").getAttribute("type")).toBe("text");
    await page.getByRole("button", { name: "Скрыть пароль" }).click();
    expect(await page.locator("#password").getAttribute("type")).toBe("password");
    await page.getByRole("button", { name: "Войти", exact: true }).click();
    await expect.poll(() => page.locator("#error").textContent()).toContain("Неверная");
    expect(await page.locator("#email").inputValue()).toBe("a@example.test");
    expect(await page.locator("#password").inputValue()).toBe("incorrect-password");
  });
});
