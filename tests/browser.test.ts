import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir } from "node:fs/promises";
import type { Page } from "playwright";
import type { Vacancy } from "@/generated/prisma/client";
import { HHPlaywrightService } from "@/lib/hh/playwright";
import { readHHProfile } from "@/lib/hh/account";

vi.mock("@/lib/log", () => ({ writeLog: vi.fn() }));

const vacancy = {
  profileId: 1, id: 1, title: "Frontend React TypeScript", company: "Example", url: "https://hh.ru/vacancy/123",
  description: "Короткое описание", externalId: "123", salary: null, city: null,
  status: "pending", matchScore: 80, searchBatchId: "test", createdAt: new Date(), updatedAt: new Date()
} satisfies Vacancy;

const vacancyHtml = (description: string) => `<main data-qa="main-content">
  <h1 data-qa="vacancy-title">Frontend React TypeScript</h1>
  <div data-qa="vacancy-company-name">Example</div>
  <div data-qa="vacancy-view-location">Москва</div>
  <div data-qa="vacancy-description">${description}</div>
  <button data-qa="vacancy-response-link-top" onclick="window.quickApplied=true">Откликнуться</button>
</main>`;

const responseHtml = `<main data-qa="main-content">
  <button data-qa="resume-title" onclick="document.getElementById('choices').hidden=false">Frontend Vue</button>
  <div id="choices" hidden>
    ${["Frontend Vue", "React Native developer", "Frontend React TypeScript"].map((title) =>
      `<button role="option" data-qa="magritte-select-option-${title}" onclick="document.querySelector('[data-qa=resume-title]').textContent=this.textContent;document.getElementById('choices').hidden=true">${title}</button>`).join("")}
  </div>
  <textarea data-qa="vacancy-response-popup-form-letter-input"></textarea>
  <button data-qa="vacancy-response-submit-popup" onclick="window.submittedResume=document.querySelector('[data-qa=resume-title]').textContent;window.submittedLetter=document.querySelector('textarea').value;document.querySelector('main').innerHTML='<p>Отклик отправлен</p>'">Отправить</button>
</main>`;

const captchaResponseHtml = (needsReconciliation = false) => `<main data-qa="main-content">
  <select name="resumeId"><option value="one">Frontend React TypeScript</option></select>
  <button data-qa="vacancy-response-submit-popup" onclick="submitFixture()">Отправить</button>
</main><script>
  window.submitCount = 0;
  function submitFixture() {
    window.submitCount += 1;
    console.log('fixture-response-submitted');
    const main = document.querySelector('main');
    const challenge = document.createElement('section');
    challenge.dataset.qa = 'captcha';
    const text = document.createElement('p'); text.textContent = 'Проверка HH';
    const input = document.createElement('input'); input.id = 'human-answer';
    const button = document.createElement('button'); button.id = 'human-check'; button.textContent = 'Проверить';
    button.onclick = () => {
      if (input.value !== 'fixture') return;
      main.replaceChildren();
      const result = document.createElement('p'); result.textContent = ${JSON.stringify(needsReconciliation ? "Проверка завершена" : "Отклик отправлен")};
      main.append(result);
    };
    challenge.append(text, input, button); main.replaceChildren(challenge);
  }
</script>`;

describe("HH browser flows against local fixtures (no HH requests)", () => {
  let service: HHPlaywrightService;
  let page: Page;
  let visited: string[];

  beforeEach(async () => {
    await mkdir("test-results", { recursive: true });
    service = new HHPlaywrightService();
    page = await service.ensureBrowser();
    visited = [];
  });
  afterEach(async () => { await service.close(); });

  async function mockHH(description = "Разработка интерфейсов на React и TypeScript", form = responseHtml) {
    await page.context().route("**/*", async (route) => {
      const url = new URL(route.request().url());
      visited.push(url.pathname);
      let body = '<script>window.globalVars={hhid:"fixture-account"}</script><h1>Мои резюме</h1><main data-qa="resume"><a data-qa="mainmenu_applicantProfile">Профиль</a><a href="https://hh.ru/resume/test">Тестовое резюме</a><a href="https://hh.ru/resume/bbb">Другой профиль</a></main>';
      if (url.pathname.startsWith("/vacancy/")) body = vacancyHtml(description);
      if (url.pathname === "/applicant/vacancy_response") body = form;
      await route.fulfill({ contentType: "text/html; charset=utf-8", body });
    });
  }

  it("records account metadata only for a visible authenticated profile", async () => {
    await page.context().route("**/*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: '<a data-qa="mainmenu_applicantProfile" style="display:none">Профиль</a><a data-qa="login">Войти</a>' }));
    await page.goto("https://hh.ru/applicant/resumes");
    expect(await readHHProfile(page)).toBeNull();
    await page.setContent('<h1>Тестовый профиль</h1><h4>Мои резюме</h4><div data-qa="captcha" style="display:none"></div>');
    expect(await readHHProfile(page)).toEqual({ name: "Тестовый профиль" });
    await page.setContent('<h1>Тестовый профиль</h1><h4>Мои резюме</h4><a data-qa="login">Войти</a>');
    expect(await readHHProfile(page)).toBeNull();
  });

  it.each(["legacy", "cards"])("reads desired job settings from the %s HH resume layout", async (layout) => {
    await page.context().route("**/*", async (route) => {
      const resume = new URL(route.request().url()).pathname.startsWith("/resume/");
      const details = '<h1 data-qa="resume-block-title-position">Бухгалтер</h1><p data-qa="resume-block-salary">120 000 ₽</p><p data-qa="resume-personal-address">Нижний Новгород</p><p data-qa="resume-position-field-workFormats">Формат работы: Удалённо</p>';
      const experience = '<section data-qa="resume-list-card-experience"><h2>Опыт работы</h2><p>' + "Расчёт зарплаты, учёт и финансовая отчётность. ".repeat(5) + '</p></section>';
      const body = !resume ? '<script>window.globalVars={hhid:"fixture-account"}</script><h1>Мои резюме</h1><main data-qa="resume"><a data-qa="mainmenu_applicantProfile">Профиль</a><a href="https://hh.ru/resume/test">Мой профиль</a></main>' : '<nav>Навигация сайта</nav><main>' + (layout === "legacy" ? '<article data-qa="resume">' + details + experience + '</article>' : '<section data-qa="resume-position-card">' + details + '</section>' + experience) + '</main><footer>Подписаться на рекламу</footer>';
      await route.fulfill({ contentType: "text/html; charset=utf-8", body });
    });
    const source = await service.importResumeData("https://hh.ru/resume/test");
    expect(source).toMatchObject({ position: "Бухгалтер", city: "Нижний Новгород", salary: "120 000 ₽", workFormat: "Формат работы: Удалённо" });
    expect(source.text).toContain("Опыт работы");
    expect(source.text).not.toContain("Навигация сайта");
    expect(source.text).not.toContain("Подписаться на рекламу");
  });

  it("rejects a non-resume error page instead of parsing its body as candidate preferences", async () => {
    await page.context().route("**/*", async (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: new URL(route.request().url()).pathname.startsWith("/resume/")
      ? '<main>' + "Эта страница недоступна. ".repeat(10) + '</main>' : '<script>window.globalVars={hhid:"fixture-account"}</script><h1>Мои резюме</h1><main data-qa="resume"><a data-qa="mainmenu_applicantProfile">Профиль</a><a href="https://hh.ru/resume/test">Мой профиль</a></main>' }));
    await expect(service.importResumeData("https://hh.ru/resume/test")).rejects.toMatchObject({ code: "browser" });
  });

  it("launches truly headless and selects the best of all dropdown resumes before submitting", async () => {
    await mockHH();
    const result = await service.applyToVacancy(vacancy, "Здравствуйте!", { minSeconds: 0, maxSeconds: 0 });
    expect(await page.evaluate(() => navigator.userAgent)).toContain("HeadlessChrome");
    expect(result.selectedResume).toBe("Frontend React TypeScript");
    expect(await page.evaluate(() => (window as unknown as { submittedResume: string }).submittedResume)).toBe("Frontend React TypeScript");
    expect(await page.evaluate(() => (window as unknown as { submittedLetter: string }).submittedLetter)).toBe("Здравствуйте!");
    expect(visited).toContain("/applicant/vacancy_response");
    expect(result.coverLetterDelivery).toBe("form");
  });
  it("submits the exact active-profile resume instead of a higher-ranked alternative", async () => {
    await mockHH(undefined, '<main><select name="resumeId"><option value="aaa">Frontend React TypeScript</option><option value="bbb">Водитель</option></select><textarea data-qa="vacancy-response-popup-form-letter-input"></textarea><button data-qa="vacancy-response-submit-popup" onclick="window.selected=document.querySelector(\'select\').value;document.querySelector(\'main\').textContent=\'Отклик отправлен\'">Отправить</button></main>');
    const result = await service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 }, undefined, { excludedWords: [], preferredResumeUrl: "https://hh.ru/resume/bbb", requirePreferredResume: true });
    expect(result.selectedResume).toBe("Водитель");
    expect(await page.evaluate(() => (window as unknown as { selected: string }).selected)).toBe("bbb");
  });
  it("keeps the same form for manual selection if HH does not expose the active resume", async () => {
    let paused = false;
    service.setCaptchaHandler((waiting) => { paused = waiting; });
    await mockHH();
    const completed = service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 }, undefined, { excludedWords: [], preferredResumeUrl: "https://hh.ru/resume/missing", requirePreferredResume: true });
    await vi.waitFor(() => expect(paused).toBe(true), { timeout: 8000 });
    expect(await page.evaluate(() => (window as unknown as { submittedResume?: string }).submittedResume)).toBeUndefined();
    expect(page.url()).toContain("vacancy_response");
    await page.locator("main").evaluate((node) => { node.textContent = "Отклик отправлен"; });
    await service.sendCaptchaInput({ type: "continue" });
    expect((await completed).alreadyApplied).toBe(false);
  });

  it("shows and controls the existing headless page including a nested frame without opening another browser", async () => {
    await page.setContent(`<main><input aria-label="fixture-input"><iframe srcdoc="<button onclick='this.textContent=String(42)'>Nested control</button>"></iframe></main>`);
    const view = service.getBrowserView();
    const frame = await service.getBrowserFrame();
    expect(frame?.pageId).toBe(view.pageId);
    expect(frame?.image.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    const field = await page.getByRole("textbox").boundingBox();
    await service.sendBrowserInput(view.pageId!, { type: "pointer", action: "down", x: field!.x + 10, y: field!.y + 10 });
    await service.sendBrowserInput(view.pageId!, { type: "pointer", action: "up", x: field!.x + 10, y: field!.y + 10 });
    await service.sendBrowserInput(view.pageId!, { type: "text", text: "ввод пользователя" });
    expect(await page.getByRole("textbox").inputValue()).toBe("ввод пользователя");
    const button = page.frameLocator("iframe").getByRole("button");
    const box = await button.boundingBox();
    await service.sendBrowserInput(view.pageId!, { type: "click", x: box!.x + 10, y: box!.y + 10 });
    expect(await button.innerText()).toBe("42");
    expect(await page.evaluate(() => navigator.userAgent)).toContain("HeadlessChrome");
  });

  it.each(["Вы\u00a0откликнулись", "Вы\u202fоткликнулись", "Вы уже откликались на эту вакансию", "Резюме доставлено"])("skips an already-applied vacancy immediately: %s", async (label) => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await page.context().route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      visited.push(path);
      const body = path.startsWith("/vacancy/")
        ? `<main data-qa="main-content"><p>${label}</p></main>`
        : '<script>window.globalVars={hhid:"fixture-account"}</script><h1>Мои резюме</h1><main data-qa="resume"><a data-qa="mainmenu_applicantProfile">Профиль</a><a href="https://hh.ru/resume/test">Мой профиль</a></main>';
      await route.fulfill({ contentType: "text/html; charset=utf-8", body });
    });
    const result = await service.applyToVacancy(vacancy, "Не отправлять повторно", { minSeconds: 0, maxSeconds: 0 });
    expect(result).toMatchObject({ alreadyApplied: true, coverLetterDelivery: "none" });
    expect(visited).not.toContain("/applicant/vacancy_response");
    expect(paused).not.toHaveBeenCalled();
  });

  it("skips an already-applied response form without selecting a resume or waiting for the human", async () => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await mockHH(undefined, '<main data-qa="main-content"><p>Вы\u00a0уже\u00a0откликнулись</p></main>');
    const result = await service.applyToVacancy(vacancy, "Не отправлять повторно", { minSeconds: 0, maxSeconds: 0 });
    expect(result).toMatchObject({ alreadyApplied: true, coverLetterDelivery: "none" });
    expect(paused).not.toHaveBeenCalled();
  });

  it("skips manual recovery when the current page already confirms an application", async () => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await page.setContent('<main><p>Вы\u00a0откликнулись</p><button data-qa="vacancy-response-link-view-topic">Чат</button></main>');
    const result = await service.completeApplicationManually(vacancy, () => false, "Не найден выбор резюме");
    expect(result.alreadyApplied).toBe(true);
    expect(paused).not.toHaveBeenCalled();
  });

  it.each(["Вакансия в архиве", "Вакансия\u00a0в\u00a0архиве", "В архиве с 28 октября 2026"])("skips an archived vacancy before waiting for its hidden description: %s", async (label) => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await page.context().route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      visited.push(path);
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: path.startsWith("/vacancy/")
        ? `<main><h1>Вакансия</h1><h2>${label}</h2><a>Показать описание вакансии</a></main>`
        : '<script>window.globalVars={hhid:"fixture-account"}</script><h1>Мои резюме</h1><main data-qa="resume"><a data-qa="mainmenu_applicantProfile">Профиль</a><a href="https://hh.ru/resume/test">Мой профиль</a></main>' });
    });
    await expect(service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 })).rejects.toMatchObject({ code: "archived" });
    expect(visited).not.toContain("/applicant/vacancy_response");
    expect(paused).not.toHaveBeenCalled();
  });

  it("does not enter manual recovery for an archived page", async () => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await page.setContent('<main><h2>Вакансия в архиве</h2></main>');
    await expect(service.completeApplicationManually(vacancy, () => false, "Нет описания")).rejects.toMatchObject({ code: "archived" });
    expect(paused).not.toHaveBeenCalled();
  });

  it("skips a vacancy archived between opening its page and loading the response form", async () => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await mockHH(undefined, '<main><h2>Вакансия в архиве</h2></main>');
    await expect(service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 })).rejects.toMatchObject({ code: "archived" });
    expect(paused).not.toHaveBeenCalled();
  });

  it.each([
    { status: 200, label: "Вам недоступна эта вакансия. Войдите как пользователь, у которого есть доступ на просмотр, либо как работодатель, создавший эту вакансию." },
    { status: 403, label: "Вам недоступна эта вакансия. Войдите как пользователь, у которого есть доступ на просмотр." },
    { status: 200, label: "Вам\u00a0недоступна\u00a0эта\u00a0вакансия" }
  ])("skips a specifically unavailable vacancy before generic login or HTTP handling: $status $label", async ({ status, label }) => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await page.context().route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      visited.push(path);
      const restricted = path.startsWith("/vacancy/");
      await route.fulfill({ status: restricted ? status : 200, contentType: "text/html; charset=utf-8", body: restricted
        ? `<main><p>${label}</p><a data-qa="login">Войти</a></main>`
        : '<script>window.globalVars={hhid:"fixture-account"}</script><h1>Мои резюме</h1><main data-qa="resume"><a data-qa="mainmenu_applicantProfile">Профиль</a><a href="https://hh.ru/resume/test">Мой профиль</a></main>' });
    });
    await expect(service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 })).rejects.toMatchObject({ code: "unavailable" });
    expect(visited).not.toContain("/applicant/vacancy_response");
    expect(paused).not.toHaveBeenCalled();
  });

  it("skips an unavailable response form without asking for manual login", async () => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await mockHH(undefined, '<main><p>Вам недоступна эта вакансия. Войдите как пользователь с доступом.</p><a data-qa="login">Войти</a></main>');
    await expect(service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 })).rejects.toMatchObject({ code: "unavailable" });
    expect(paused).not.toHaveBeenCalled();
  });

  it("skips an unavailable page after submission instead of waiting for confirmation forever", async () => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await mockHH(undefined, responseHtml.replace("Отклик отправлен", "Вам недоступна эта вакансия. Войдите как пользователь с доступом."));
    await expect(service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 })).rejects.toMatchObject({ code: "unavailable" });
    expect(paused).not.toHaveBeenCalled();
  });

  it("does not enter manual recovery on a specifically unavailable vacancy", async () => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await page.setContent('<main><p>Вам недоступна эта вакансия. Войдите как пользователь с доступом.</p></main>');
    await expect(service.completeApplicationManually(vacancy, () => false, "Нет подтверждения")).rejects.toMatchObject({ code: "unavailable" });
    expect(paused).not.toHaveBeenCalled();
  });

  it("keeps a generic HTTP restriction distinct from an unavailable vacancy", async () => {
    await page.context().route("**/*", async (route) => {
      const restricted = new URL(route.request().url()).pathname.startsWith("/vacancy/");
      await route.fulfill({ status: restricted ? 403 : 200, contentType: "text/html", body: restricted ? "Forbidden" : '<script>window.globalVars={hhid:"fixture-account"}</script><h1>Мои резюме</h1><main data-qa="resume"><a data-qa="mainmenu_applicantProfile">Профиль</a><a href="https://hh.ru/resume/test">Мой профиль</a></main>' });
    });
    await expect(service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 })).rejects.toMatchObject({ code: "access" });
  });

  it("blocks a forbidden word found only in the fresh full description before opening a response form", async () => {
    await mockHH("В описании есть junior, которого нет в сохранённом тексте");
    await expect(service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 }, undefined, { excludedWords: ["junior"] }))
      .rejects.toMatchObject({ code: "excluded" });
    expect(visited).not.toContain("/applicant/vacancy_response");
  });

  it("does not navigate at all when the saved vacancy is already forbidden", async () => {
    await mockHH();
    await expect(service.applyToVacancy({ ...vacancy, title: "Junior frontend" }, "", { minSeconds: 0, maxSeconds: 0 }, undefined, { excludedWords: ["junior"] }))
      .rejects.toMatchObject({ code: "excluded" });
    expect(visited).toEqual([]);
  });

  it("stops immediately on expired authorization without opening a visible browser", async () => {
    await page.context().route("**/*", (route) => route.fulfill({ contentType: "text/html", body: '<a data-qa="login">Войти</a>' }));
    await expect(service.ensureAuthorized()).rejects.toMatchObject({ code: "auth" });
    expect(await page.evaluate(() => navigator.userAgent)).toContain("HeadlessChrome");
  });

  it("reports denied HH access instead of treating an HTTP error page as a successful empty search", async () => {
    await page.context().route("**/*", (route) => route.fulfill({ status: 403, contentType: "text/html", body: "Forbidden" }));
    await expect(service.ensureAuthorized()).rejects.toMatchObject({ code: "access" });
  });

  it("keeps manual login waiting through public navigation until the user reaches their account", async () => {
    // Reuse the actual headless fixture browser so this regression test never
    // opens a window on the developer's desktop.
    vi.spyOn(service, "ensureBrowser").mockResolvedValue(page);
    await page.context().route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = path === "/applicant/resumes"
        ? '<h1>Мои резюме</h1><button>Создать резюме</button>'
        : '<nav><a href="/applicant/resumes">Мои резюме</a><a>Отклики</a></nav><main id="login-form">Загрузка формы</main>';
      await route.fulfill({ contentType: "text/html; charset=utf-8", body });
    });
    let confirmed = false;
    const login = service.ensureAuthorized(undefined, true).then((result) => { confirmed = true; return result; });
    await page.waitForURL("**/account/login?**");
    await page.locator("#login-form").waitFor();
    await page.waitForTimeout(1100);
    expect(confirmed).toBe(false);
    expect(page.isClosed()).toBe(false);
    await page.goto("https://hh.ru/applicant/resumes");
    expect(await login).toBe(page);
    expect(confirmed).toBe(true);
  });

  it("recognizes the current HH profile UI reached from the legacy resumes URL", async () => {
    await page.context().route("**/*", async (route) => {
      // Simulate the router's final URL without an HTTP redirect escaping
      // Playwright's route interception and reaching the real HH website.
      await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<script>history.replaceState({}, "", "/applicant/profile/me")</script><nav><a>Резюме и профиль</a></nav><h1>Тестовый пользователь</h1><h4>Мои резюме</h4><a href="/applicant/resumes/new">Создать резюме</a>' });
    });
    const authorized = await service.ensureAuthorized();
    expect(authorized.url()).toBe("https://hh.ru/applicant/profile/me");
  });

  it("skips additional employer questions before selecting a resume or submitting when requested", async () => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await mockHH(undefined, responseHtml.replace('<main data-qa="main-content">', '<main data-qa="main-content"><label>Опишите опыт<textarea name="task_123_text"></textarea></label>'));
    await expect(service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 }, undefined, { excludedWords: [], skipAdditionalRequirements: true }))
      .rejects.toMatchObject({ code: "requirements" });
    expect(paused).not.toHaveBeenCalled();
    expect(await page.evaluate(() => (window as unknown as { submittedResume?: string }).submittedResume)).toBeUndefined();
  });

  it("skips a resume visibility requirement even if the resume selector is unavailable", async () => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await mockHH(undefined, '<main><div data-qa="hidden-resume-warning">Измените видимость резюме</div></main>');
    await expect(service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 }, undefined, { excludedWords: [], skipAdditionalRequirements: true }))
      .rejects.toMatchObject({ code: "requirements" });
    expect(paused).not.toHaveBeenCalled();
  });

  it.each([undefined, false])("waits for manual completion of extra questions when skipping is %s", async (skipAdditionalRequirements) => {
    let paused = false;
    service.setCaptchaHandler((waiting) => { paused = waiting; });
    await mockHH(undefined, responseHtml.replace('<main data-qa="main-content">', '<main data-qa="main-content"><textarea name="task_123_text"></textarea>'));
    const completed = service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 }, undefined, { excludedWords: [], skipAdditionalRequirements });
    await vi.waitFor(() => expect(paused).toBe(true), { timeout: 8000 });
    expect(await page.evaluate(() => (window as unknown as { submittedResume?: string }).submittedResume)).toBeUndefined();
    await page.locator("main").evaluate((node) => { node.textContent = "Отклик отправлен"; });
    await service.sendCaptchaInput({ type: "continue" });
    expect((await completed).alreadyApplied).toBe(false);
  });

  it("skips extra questions appearing after submission without entering manual recovery", async () => {
    const paused = vi.fn();
    service.setCaptchaHandler(paused);
    await mockHH(undefined, responseHtml.replace("Отклик отправлен", '<textarea name=task_123_text></textarea>'));
    await expect(service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 }, undefined, { excludedWords: [], skipAdditionalRequirements: true }))
      .rejects.toMatchObject({ code: "requirements" });
    expect(paused).not.toHaveBeenCalled();
  });

  it("still waits for CAPTCHA when skipping additional requirements is enabled", async () => {
    let paused = false;
    service.setCaptchaHandler((waiting) => { paused = waiting; });
    await mockHH(undefined, captchaResponseHtml());
    const completed = service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 }, undefined, { excludedWords: [], skipAdditionalRequirements: true });
    await vi.waitFor(() => expect(paused).toBe(true), { timeout: 10000 });
    await page.locator("#human-answer").fill("fixture");
    await page.locator("#human-check").click();
    expect(paused).toBe(true);
    await service.sendCaptchaInput({ type: "continue" });
    expect((await completed).alreadyApplied).toBe(false);
  });

  it("supports a single native select resume", async () => {
    const form = responseHtml.replace(/<button data-qa="resume-title"[\s\S]*?<\/div>/, '<select name="resumeId"><option value="only">Frontend React TypeScript</option></select>')
      .replace("document.querySelector('[data-qa=resume-title]').textContent;window.submittedLetter", "document.querySelector('select').selectedOptions[0].textContent;window.submittedLetter");
    await mockHH(undefined, form);
    const result = await service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 });
    expect(result.selectedResume).toBe("Frontend React TypeScript");
  });

  it("filters full search descriptions and continues until an allowed vacancy is found", async () => {
    await page.context().route("**/*", async (route) => {
      const url = new URL(route.request().url());
      let body = '<script>window.globalVars={hhid:"fixture-account"}</script><h1>Мои резюме</h1><main data-qa="resume"><a data-qa="mainmenu_applicantProfile">Профиль</a><a href="https://hh.ru/resume/test">Мой профиль</a></main>';
      if (url.pathname === "/search/vacancy") {
        body = [123, 456].map((id) => `<article data-qa="vacancy-serp__vacancy"><a data-qa="serp-item__title" href="https://hh.ru/vacancy/${id}">Frontend React</a><div data-qa="vacancy-serp__vacancy_snippet_requirement">React</div></article>`).join("");
      } else if (url.pathname.startsWith("/vacancy/")) {
        body = vacancyHtml(url.pathname.endsWith("123") ? "Junior" : "Разработка интерфейсов React");
      }
      await route.fulfill({ contentType: "text/html; charset=utf-8", body });
    });
    const results = await service.searchVacancies({ keywords: ["Frontend"], maxResults: 1, excludedWords: ["junior"], delayRange: { minSeconds: 0, maxSeconds: 0 } });
    expect(results.map((result) => result.url)).toEqual(["https://hh.ru/vacancy/456"]);
    expect(results[0].description).toBe("Разработка интерфейсов React");
  });

  it.each([false, true])("keeps the same form until explicit human confirmation and actual HH success (extra action: %s)", async (reconcile) => {
    let submits = 0;
    let vacancyViews = 0;
    let paused = false;
    let manualForms = 0;
    page.on("console", (message) => { if (message.text() === "fixture-response-submitted") submits += 1; });
    service.setCaptchaHandler((waiting, details) => { paused = waiting; if (waiting && details) manualForms += 1; });
    await page.context().route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body = '<script>window.globalVars={hhid:"fixture-account"}</script><h1>Мои резюме</h1><main data-qa="resume"><a data-qa="mainmenu_applicantProfile">Профиль</a><a href="https://hh.ru/resume/test">Мой профиль</a></main>';
      if (path.startsWith("/vacancy/")) {
        vacancyViews += 1;
        body = vacancyHtml("Разработка интерфейсов");
        if (vacancyViews > 1) body += '<button data-qa="vacancy-response-link-view-topic">Чат</button>';
      }
      if (path === "/applicant/vacancy_response") body = captchaResponseHtml(reconcile);
      await route.fulfill({ contentType: "text/html; charset=utf-8", body });
    });
    const completed = service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 });
    await vi.waitFor(() => expect(paused).toBe(true), { timeout: 10000 });
    expect(page.isClosed()).toBe(false);
    expect(submits).toBe(1);
    const screenshot = await service.getCaptchaScreenshot();
    expect(screenshot?.length).toBeGreaterThan(0);
    // These are synthetic local test controls, never a real CAPTCHA.
    const input = (await page.locator("#human-answer").boundingBox())!;
    await service.sendCaptchaInput({ type: "click", x: input.x + 5, y: input.y + 5 });
    await service.sendCaptchaInput({ type: "text", text: "fixture" });
    const button = (await page.locator("#human-check").boundingBox())!;
    await service.sendCaptchaInput({ type: "click", x: button.x + 5, y: button.y + 5 });
    await page.waitForTimeout(1500);
    expect(paused).toBe(true);
    expect(vacancyViews).toBe(1);
    await service.sendCaptchaInput({ type: "continue" });
    if (reconcile) {
      await vi.waitFor(() => expect(manualForms).toBe(1), { timeout: 4000 });
      expect(vacancyViews).toBe(1);
      expect(page.url()).toContain("vacancy_response");
      // Continue alone must not discard an unfinished form or advance the queue.
      await service.sendCaptchaInput({ type: "continue" });
      await vi.waitFor(() => expect(manualForms).toBe(2), { timeout: 4000 });
      expect(submits).toBe(1);
      await page.locator("main").evaluate((node) => { node.textContent = "Отклик отправлен"; });
      await service.sendCaptchaInput({ type: "continue" });
    }
    const result = await completed;
    expect(result.alreadyApplied).toBe(false);
    expect(submits).toBe(1);
    expect(paused).toBe(false);
    expect(vacancyViews).toBe(1);
    expect(await service.getCaptchaScreenshot()).toBeNull();
  });

  it("holds a late challenge iframe instead of failing the form and moving away", async () => {
    let paused = false;
    let submits = 0;
    service.setCaptchaHandler((waiting) => { paused = waiting; });
    await page.context().route("**/*", async (route) => {
      const path = new URL(route.request().url()).pathname;
      let body = '<script>window.globalVars={hhid:"fixture-account"}</script><h1>Мои резюме</h1><main data-qa="resume"><a data-qa="mainmenu_applicantProfile">Профиль</a><a href="https://hh.ru/resume/test">Мой профиль</a></main>';
      if (path.startsWith("/vacancy/")) body = vacancyHtml("Разработка интерфейсов");
      if (path === "/applicant/vacancy_response") body = `<main data-qa="main-content">
        <select name="resumeId"><option value="one">Frontend React</option></select>
        <button data-qa="vacancy-response-submit-popup" onclick="window.postCount=(window.postCount||0)+1;setTimeout(()=>{const f=document.createElement('iframe');f.src='https://captcha.fixture/verify';f.width='320';f.height='180';document.querySelector('main').append(f)},3500)">Отправить</button>
        </main><script>window.addEventListener('message', e=>{if(e.data==='fixture-finished')document.querySelector('main').textContent='Отклик отправлен'})</script>`;
      if (route.request().url().startsWith("https://captcha.fixture/")) body = '<button onclick="parent.postMessage(\'fixture-finished\',\'*\')">Закончить тестовую проверку</button>';
      await route.fulfill({ contentType: "text/html; charset=utf-8", body });
    });
    const completed = service.applyToVacancy(vacancy, "", { minSeconds: 0, maxSeconds: 0 });
    await vi.waitFor(() => expect(paused).toBe(true), { timeout: 10000 });
    await page.locator("iframe").waitFor({ timeout: 8000 });
    await expect(service.sendCaptchaInput({ type: "continue" })).rejects.toThrow("ещё открыта");
    submits = await page.evaluate(() => (window as unknown as { postCount: number }).postCount);
    expect(submits).toBe(1);
    expect(page.url()).toContain("vacancy_response");
    await page.frameLocator("iframe").getByRole("button", { name: "Закончить тестовую проверку" }).click();
    await page.waitForTimeout(1500);
    expect(paused).toBe(true);
    await service.sendCaptchaInput({ type: "continue" });
    await completed;
    expect(paused).toBe(false);
  });
});
