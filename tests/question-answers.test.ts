import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { fillQuestionAnswers } from "@/lib/hh/question-answers";

describe("configured answers on an HH questionnaire", () => {
  let browser: Browser;
  let page: Page;
  beforeAll(async () => { browser = await chromium.launch({ headless: true }); page = await browser.newPage(); });
  afterAll(async () => { await browser.close(); });

  const form = `<div data-qa="vacancy-response-questionnaire">
    <label>Сколько лет опыта?<input name="task_experience" type="number"></label>
    <fieldset><legend>Готовы к поездкам?</legend><label><input type="radio" name="task_travel" value="yes">Да</label><label><input type="radio" name="task_travel" value="no">Нет</label></fieldset>
    <label>Формат работы<select name="task_format"><option value="">Выберите</option><option value="remote">Удалённо</option></select></label>
  </div>`;
  const answers = "Сколько лет опыта? | 5\nГотовы к поездкам? | Да\nФормат работы | Удалённо";
  it("fills text, radio and select answers when all questions match", async () => {
    await page.setContent(form);
    expect(await fillQuestionAnswers(page, answers)).toBe(true);
    expect(await page.locator('[name="task_experience"]').inputValue()).toBe("5");
    expect(await page.locator('[value="yes"]').isChecked()).toBe(true);
    expect(await page.locator('[name="task_format"]').inputValue()).toBe("remote");
  });
  it("leaves the whole form untouched if any answer is missing or ambiguous", async () => {
    await page.setContent(form);
    expect(await fillQuestionAnswers(page, "Сколько лет опыта? | 5")).toBe(false);
    expect(await page.locator('[name="task_experience"]').inputValue()).toBe("");
    expect(await fillQuestionAnswers(page, answers + "\nГотовы к поездкам? | Нет")).toBe(false);
    expect(await page.locator('[value="yes"]').isChecked()).toBe(false);
  });
  it("does not handle unsupported controls or change resume visibility", async () => {
    await page.setContent(form + '<div data-qa="hidden-resume-warning">Видимость</div>');
    expect(await fillQuestionAnswers(page, answers)).toBe(false);
    await page.setContent(form.replace('</div>', '<input name="other" required></div>'));
    expect(await fillQuestionAnswers(page, answers)).toBe(false);
  });
});
