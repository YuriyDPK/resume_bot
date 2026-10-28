import type { Vacancy } from "@/generated/prisma/client";
import { type Frame, type Locator, type Page } from "playwright";
import { hhConfig } from "@/lib/env";
import { writeLog } from "@/lib/log";

import { HHBrowserSession } from "@/lib/hh/browser-session";
import { HHAutomationError, type ApplyOptions, type ApplyToVacancyResult, type DelayRange, type ScrapedVacancy, type SearchPageProgress, type StopSignal } from "@/lib/hh/types";
import { findExcludedWords } from "@/lib/vacancy-filter";
import { rankResumes } from "@/lib/hh/resume-selection";
import type { ResumeSource } from "@/lib/resume-parser";
import { readOwnResumes, resumeIdFromUrl } from "@/lib/hh/ownership";
import { scrapeInbox, type HHConversation } from "@/lib/hh/inbox-scraper";
export { HHAutomationError } from "@/lib/hh/types";
export type { ScrapedVacancy } from "@/lib/hh/types";

function extractExternalId(url: string) {
  return url.match(/vacancy\/(\d+)/)?.[1];
}

function normalizeUrl(url: string | null | undefined) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeForCompare(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/ё/g, "е").trim();
}

function isVacancyUrl(url: string) {
  return /^https:\/\/(www\.)?hh\.ru\/vacancy\/\d+/.test(url);
}

function cityMatches(vacancyCity: string | null | undefined, expectedCity: string | null | undefined) {
  if (!expectedCity?.trim() || !vacancyCity?.trim()) return true;
  const cities = expectedCity
    .split(/[,;\n]/)
    .map((city) => normalizeForCompare(city))
    .filter(Boolean);
  return cities.length === 0 || cities.some((city) => normalizeForCompare(vacancyCity).includes(city));
}

function splitCities(value: string | null | undefined) {
  return (value ?? "")
    .split(/[,;\n]/)
    .map((city) => city.trim())
    .filter(Boolean);
}

export class HHPlaywrightService extends HHBrowserSession {
  private async assertAccountOwner(page: Page, expectedAccountId?: string) {
    if (!expectedAccountId) return;
    const current = await page.evaluate(() => {
      if (!/(^|\.)hh\.ru$/.test(location.hostname)) return null;
      const value = (window as unknown as { globalVars?: { hhid?: string | number } }).globalVars?.hhid;
      return value === undefined ? null : String(value);
    });
    if (current !== expectedAccountId) throw new HHAutomationError("auth", "HH-аккаунт изменился или не подтверждён. Отклик не отправлен; войдите как владелец выбранного резюме");
  }
  async syncInbox(stopRequested: StopSignal, onConversation: (accountId: string, row: HHConversation) => Promise<void>) {
    const page = await this.ensureAuthorized(stopRequested);
    const owner = await readOwnResumes(page);
    return scrapeInbox(page, { stopRequested, navigate: (url) => this.navigate(page, url, stopRequested), check: async () => {
      this.assertNotStopped(stopRequested); await this.waitForCaptcha(page, stopRequested);
      if (await this.detectAuthRequired(page)) throw new HHAutomationError("auth", "Войдите в свой аккаунт HH для чтения ответов");
    }, onConversation: (row) => onConversation(owner.accountId, row) });
  }
  async verifyResumeOwnership(resumeUrl: string, stopRequested?: StopSignal) {
    const id = resumeIdFromUrl(resumeUrl);
    if (!id) throw new HHAutomationError("resume", "Укажите ссылку на своё резюме HH");
    const page = await this.ensureAuthorized(stopRequested);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      this.assertNotStopped(stopRequested);
      const owned = await readOwnResumes(page);
      const resume = owned.resumes.find((item) => item.id === id);
      if (resume) {
        const normalize = (title: string) => title.replace(/\s+/g, " ").trim().toLowerCase();
        const unique = [...new Map(owned.resumes.map((item) => [item.id, item])).values()];
        return { accountId: owned.accountId, resumeId: id, title: resume.title, uniqueTitle: unique.filter((item) => normalize(item.title) === normalize(resume.title)).length === 1 };
      }
      const more = page.locator('[data-qa="compact-resume-show-more"]');
      if (!await more.isVisible().catch(() => false)) break;
      await more.click(); await page.waitForTimeout(300);
    }
    throw new HHAutomationError("resume", "Это резюме не найдено в «Мои резюме» текущего аккаунта HH. Добавить и использовать можно только своё резюме");
  }
  private async resolveAreaIds(page: Page, cities: string[]) {
    if (cities.length === 0) return [];

    try {
      const response = await page.request.get("https://api.hh.ru/areas/113", { timeout: 20000 });
      if (!response.ok()) return [];
      const root = (await response.json()) as { id: string; name: string; areas?: unknown[] };
      const wanted = new Set(cities.map(normalizeForCompare));
      const found = new Set<string>();

      const visit = (area: { id?: string; name?: string; areas?: unknown[] }) => {
        if (area.id && area.name && wanted.has(normalizeForCompare(area.name))) found.add(area.id);
        for (const child of area.areas ?? []) visit(child as { id?: string; name?: string; areas?: unknown[] });
      };

      visit(root);
      return Array.from(found);
    } catch {
      return [];
    }
  }

  async searchVacancies(params: {
    keywords: string[];
    city?: string | null;
    minSalary?: number | null;
    allRussia?: boolean;
    remoteOnly?: boolean;
    maxResults: number;
    excludedUrls?: string[];
    excludedWords?: string[];
    stopRequested?: StopSignal;
    delayRange?: DelayRange;
    onVacancy?: (vacancy: ScrapedVacancy) => Promise<boolean | void>;
    onPage?: (progress: SearchPageProgress) => Promise<void> | void;
  }) {
    const page = await this.ensureAuthorized(params.stopRequested);
    const results = new Map<string, ScrapedVacancy>();
    const excludedUrls = new Set((params.excludedUrls ?? []).map(normalizeUrl).filter(Boolean));
    const exhaustedKeywords = new Set<string>();
    const emptyPagesByKeyword = new Map<string, number>();
    const itemsPerPage = 20;
    const maxPages = 100;
    const maxEmptyPagesPerKeyword = 3;
    const cities = splitCities(params.city);
    const areaIds = params.allRussia ? ["113"] : await this.resolveAreaIds(page, cities);
    const searchDelayRange = params.delayRange ?? { minSeconds: 1, maxSeconds: 3 };

    if (!params.allRussia && cities.length > 0 && areaIds.length === 0) {
      await writeLog("warn", "Не удалось определить коды городов HH; применяю фильтр по названию в результатах", { cities });
    }

    for (let pageNumber = 0; pageNumber < maxPages && results.size < params.maxResults; pageNumber += 1) {
      for (const keyword of params.keywords) {
        if (results.size >= params.maxResults) break;
        if (exhaustedKeywords.has(keyword)) continue;
        this.assertNotStopped(params.stopRequested);
        const url = new URL("https://hh.ru/search/vacancy");
        url.searchParams.set("text", keyword);
        url.searchParams.set("items_on_page", String(itemsPerPage));
        url.searchParams.set("page", String(pageNumber));
        url.searchParams.set("order_by", "publication_time");
        if (params.minSalary) url.searchParams.set("salary", String(params.minSalary));
        for (const areaId of areaIds) url.searchParams.append("area", areaId);
        if (params.remoteOnly) url.searchParams.set("schedule", "remote");

        await writeLog("info", "Ищу новые вакансии на HH", { keyword, page: pageNumber + 1 });
        await this.navigate(page, url.toString(), params.stopRequested);
        await page.waitForTimeout(2500);

        await this.waitForCaptcha(page, params.stopRequested);

        await page.locator('a[href*="/vacancy/"]').first().waitFor({ timeout: 15000 }).catch(() => undefined);

        const scraped = await page.evaluate(() => {
        type BrowserVacancy = {
          title: string;
          company: string;
          salary: string | null;
          city: string | null;
          description: string | null;
          url: string;
        };

        const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
        const cleanSalary = (value: string | null | undefined) => {
          const normalized = normalize(value);
          if (!normalized || /опыт|можно удаленно|удален/i.test(normalized)) return null;
          return /\d/.test(normalized) ? normalized : null;
        };
        const cards = Array.from(
          document.querySelectorAll('[data-qa="vacancy-serp__vacancy"], .vacancy-serp-item, [data-qa="serp-item"]')
        );

        const fromCards = cards
          .map((card): BrowserVacancy | null => {
            const link = card.querySelector<HTMLAnchorElement>('[data-qa="serp-item__title"], a[href*="/vacancy/"]');
            if (!link?.href) return null;
            const company = card.querySelector('[data-qa="vacancy-serp__vacancy-employer"], [data-qa="serp-item__meta-info-company"], [class*="company"]');
            const salary = card.querySelector('[data-qa="vacancy-serp__vacancy-compensation"], [data-qa="serp-item__salary"]');
            const city = card.querySelector('[data-qa="vacancy-serp__vacancy-address"], [data-qa="serp-item__meta-info-location"], [class*="address"]');
            const description = Array.from(card.querySelectorAll('[data-qa="vacancy-serp__vacancy_snippet_responsibility"], [data-qa="vacancy-serp__vacancy_snippet_requirement"]'));

            return {
              title: normalize(link.textContent),
              company: normalize(company?.textContent) || "HH.ru",
              salary: cleanSalary(salary?.textContent),
              city: normalize(city?.textContent) || null,
              description: description.map((node) => normalize(node.textContent)).join(" ") || null,
              url: link.href
            };
          })
          .filter((item): item is BrowserVacancy => item !== null);

        if (fromCards.length > 0) return fromCards;

        return Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/vacancy/"]'))
          .map((link) => ({
            title: normalize(link.textContent),
            company: "HH.ru",
            salary: null,
            city: null,
            description: null,
            url: link.href
          }))
          .filter((item) => item.title && item.url);
        });

        const progress: SearchPageProgress = {
          keyword,
          page: pageNumber + 1,
          scraped: scraped.length,
          accepted: 0,
          skippedKnown: 0,
          skippedCity: 0,
          skippedInvalid: 0,
          skippedRejected: 0
        };

        if (scraped.length === 0) exhaustedKeywords.add(keyword);

        for (const item of scraped) {
          const normalizedUrl = normalizeUrl(item.url);
          if (!normalizedUrl || !isVacancyUrl(normalizedUrl)) {
            progress.skippedInvalid += 1;
            continue;
          }
          if (excludedUrls.has(normalizedUrl)) {
            progress.skippedKnown += 1;
            continue;
          }
          if (!params.allRussia && !cityMatches(item.city, params.city)) {
            progress.skippedCity += 1;
            continue;
          }

          let vacancy: ScrapedVacancy = {
            externalId: extractExternalId(normalizedUrl),
            title: item.title || "Без названия",
            company: item.company || "HH.ru",
            salary: item.salary,
            city: item.city ?? params.city ?? null,
            description: item.description,
            url: normalizedUrl
          };

          excludedUrls.add(normalizedUrl);
          if (findExcludedWords(vacancy, params.excludedWords ?? []).length > 0) {
            progress.skippedRejected += 1;
            continue;
          }
          try {
            vacancy = await this.readVacancyDetails(vacancy, params.stopRequested);
          } catch (error) {
            if (!(error instanceof HHAutomationError) || !["browser", "archived", "unavailable"].includes(error.code)) throw error;
            await writeLog(error.code === "browser" ? "warn" : "info", error.code === "archived" ? "Вакансия в архиве, пропускаю" : error.code === "unavailable" ? "Вакансия недоступна, пропускаю" : "Не удалось прочитать полное описание вакансии", { url: vacancy.url, message: error.message });
            progress.skippedRejected += 1;
            continue;
          }
          if (findExcludedWords(vacancy, params.excludedWords ?? []).length > 0) {
            progress.skippedRejected += 1;
            continue;
          }
          const accepted = (await params.onVacancy?.(vacancy)) ?? true;
          if (!accepted) {
            progress.skippedRejected += 1;
            continue;
          }

          results.set(normalizedUrl, vacancy);
          progress.accepted += 1;

          if (results.size >= params.maxResults) break;
        }

        if (progress.accepted > 0) {
          emptyPagesByKeyword.set(keyword, 0);
        } else if (!exhaustedKeywords.has(keyword)) {
          const emptyPages = (emptyPagesByKeyword.get(keyword) ?? 0) + 1;
          emptyPagesByKeyword.set(keyword, emptyPages);
          if (emptyPages >= maxEmptyPagesPerKeyword) {
            exhaustedKeywords.add(keyword);
          }
          await writeLog("info", "Страница HH без новых вакансий", {
            keyword,
            page: pageNumber + 1,
            scraped: progress.scraped,
            skippedKnown: progress.skippedKnown,
            skippedCity: progress.skippedCity,
            skippedInvalid: progress.skippedInvalid,
            skippedRejected: progress.skippedRejected,
            emptyPages
          });
        }

        await params.onPage?.(progress);
      }

      if (exhaustedKeywords.size === params.keywords.length) break;
      if (results.size < params.maxResults) {
        await this.waitHumanDelay(page, searchDelayRange, params.stopRequested);
      }
    }

    await this.context?.storageState({ path: hhConfig.storageStatePath });
    return Array.from(results.values());
  }

  private async readVacancyOnPage(page: Page, vacancy: ScrapedVacancy, stopRequested?: StopSignal, skipAppliedDetails = false): Promise<ScrapedVacancy> {
    this.assertNotStopped(stopRequested);
    await this.navigate(page, vacancy.url, stopRequested);
    await this.waitForCaptcha(page, stopRequested);
    await this.assertVacancyAccessible(page);
    if (await this.detectAuthRequired(page)) throw new HHAutomationError("auth", "Сессия HH истекла. Нажмите «Войти в HH».");
    if (skipAppliedDetails && await this.responseWasSent(page)) return { ...vacancy, alreadyApplied: true };
    await this.assertVacancyActive(page);

    const description = page.locator('[data-qa="vacancy-description"], .vacancy-description').first();
    await description.or(this.archivedNotice(page)).or(this.unavailableVacancyNotice(page)).first().waitFor({ state: "attached", timeout: 15000 }).catch(() => undefined);
    await this.assertVacancyActive(page);
    const text = await description.innerText({ timeout: 2000 }).catch(() => "");
    await this.assertVacancyActive(page);
    if (!text.trim()) throw new HHAutomationError("browser", "HH не показал полное описание вакансии; отклик не отправлен");
    const title = await page.locator('[data-qa="vacancy-title"], h1').first().innerText({ timeout: 2000 }).catch(() => vacancy.title);
    const company = await page.locator('[data-qa="vacancy-company-name"]').first().innerText({ timeout: 1000 }).catch(() => vacancy.company);
    const city = await page.locator('[data-qa="vacancy-view-raw-address"], [data-qa="vacancy-view-location"]').first().innerText({ timeout: 1000 }).catch(() => vacancy.city);
    this.assertNotStopped(stopRequested);
    return { ...vacancy, title: title.trim() || vacancy.title, company: company.trim() || vacancy.company, city, description: text.trim() };
  }

  async readVacancyDetails(vacancy: ScrapedVacancy, stopRequested?: StopSignal) {
    const page = await this.context!.newPage();
    try {
      return await this.readVacancyOnPage(page, vacancy, stopRequested);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  async importResumeText(resumeUrl: string, stopRequested?: StopSignal) {
    return (await this.importResumeData(resumeUrl, stopRequested)).text;
  }

  async importResumeData(resumeUrl: string, stopRequested?: StopSignal): Promise<ResumeSource> {
    const ownership = await this.verifyResumeOwnership(resumeUrl, stopRequested);
    const page = await this.ensureBrowser();
    this.assertNotStopped(stopRequested);

    await this.navigate(page, resumeUrl, stopRequested);
    await page.waitForTimeout(2500);

    await this.waitForCaptcha(page, stopRequested);

    if (await this.detectAuthRequired(page)) {
      throw new HHAutomationError("auth", "HH требует повторную авторизацию для чтения резюме. Процесс остановлен.");
    }

    const source = await page.evaluate(() => {
      const textOf = (selector: string) => (document.querySelector(selector) as HTMLElement | null)?.innerText?.trim() ?? "";
      const position = textOf('[data-qa="resume-block-title-position"], [data-qa="resume-title"]');
      const root = document.querySelector('[data-qa="resume"]');
      const cards = Array.from(document.querySelectorAll<HTMLElement>([
        '[data-qa="resume-position-card"]', '[data-qa="resume-list-card-experience"]', '[data-qa="resume-list-card-education"]',
        '[data-qa="resume-about-card"]', '[data-qa="resume-block-skills"]'
      ].join(", ")));
      const content = root ? (root as HTMLElement).innerText : cards.length ? cards.map((card) => card.innerText).join("\n\n") : textOf("main");
      return {
        position,
        city: textOf('[data-qa="resume-personal-address"], [data-qa="resume-personal-location"], [itemprop="addressLocality"]'),
        salary: textOf('[data-qa="resume-block-salary"]'),
        workFormat: textOf('[data-qa="resume-position-field-workFormats"], [data-qa="resume-block-work-format"], [data-qa="resume-block-schedule"]'),
        text: [position ? "Желаемая должность: " + position : "", content].filter(Boolean).join("\n").trim(),
        hasResume: Boolean(root || position || cards.length)
      };
    });
    await this.context?.storageState({ path: hhConfig.storageStatePath });

    if (!source.hasResume || source.text.length < 120) {
      throw new HHAutomationError("browser", "Не удалось прочитать текст резюме. Проверьте доступность ссылки в HH.");
    }

    return { text: source.text.slice(0, 12000), position: source.position, city: source.city, salary: source.salary, workFormat: source.workFormat, ownerAccountId: ownership.accountId };
  }

  private async firstVisible(page: Page, selectors: string[]) {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
        return locator;
      }
    }
    return null;
  }

  private async firstVisibleInFrame(frame: Frame, selectors: string[]) {
    for (const selector of selectors) {
      const locator = frame.locator(selector).first();
      if (await locator.isVisible({ timeout: 1500 }).catch(() => false)) {
        return locator;
      }
    }
    return null;
  }

  private async selectResumeForVacancy(page: Page, vacancy: ScrapedVacancy, preferredResumeUrl?: string | null, requirePreferred = false, preferredTitle?: string, allowTitleMatch = false) {
    const nativeSelect = await this.firstVisible(page, ['select[name="resumeId"]', 'select[data-qa*="resume"]']);
    let candidates: { title: string; id?: string; disabled?: boolean; locator: Locator }[] = [];
    const currentTitle = await this.firstVisible(page, [
      '[data-qa="modal-overlay"] [data-qa="resume-title"]',
      '[data-qa="main-content"] [data-qa="resume-title"]',
      '[data-qa="resume-title"]',
      '[data-qa="vacancy-response-popup-resume-title"]'
    ]);

    if (nativeSelect) {
      const options = nativeSelect.locator('option');
      for (let i = 0; i < await options.count(); i += 1) {
        const option = options.nth(i);
        const id = await option.getAttribute('value');
        if (!id) continue;
        candidates.push({ title: (await option.textContent())?.trim() ?? '', id, disabled: await option.isDisabled(), locator: option });
      }
    } else {
      const radios = page.locator('input[type="radio"][name="resumeId"], input[type="radio"][data-qa*="resume"]');
      if (await radios.count() > 0) {
        for (let i = 0; i < await radios.count(); i += 1) {
          const radio = radios.nth(i);
          const title = await radio.evaluate((element) => Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.textContent).join(' ').trim());
          candidates.push({ title, id: await radio.getAttribute('value') ?? undefined, disabled: await radio.isDisabled(), locator: radio });
        }
      } else if (currentTitle) {
        const previousTitle = (await currentTitle.innerText()).replace(/\s+/g, ' ').trim();
        await currentTitle.click({ timeout: 10000 });
        const options = page.locator('[role="option"], [data-qa="vacancy-response-popup-resume"]');
        await options.first().waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
        for (let i = 0; i < await options.count(); i += 1) {
          const option = options.nth(i);
          if (!await option.isVisible()) continue;
          const nestedTitle = option.locator('[data-qa="resume-title"], [data-qa*="resume-title"]').first();
          const text = await nestedTitle.innerText({ timeout: 300 }).catch(() => option.innerText());
          const title = text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
          candidates.push({ title, id: await option.evaluate((element) => element.getAttribute('data-value') || element.getAttribute('data-resume-id') || element.querySelector<HTMLInputElement>('input[value]')?.value || element.querySelector<HTMLAnchorElement>('a[href*="/resume/"]')?.pathname.match(/\/resume\/([a-z0-9_-]+)/i)?.[1]), disabled: await option.getAttribute('aria-disabled') === 'true', locator: option });
        }
        if (candidates.length === 0 && previousTitle) {
          // HH shows a fixed title when the account has only one available resume.
          await page.keyboard.press('Escape');
          candidates = [{ title: previousTitle, locator: currentTitle }];
        }
      }
    }

    if (requirePreferred && preferredTitle && allowTitleMatch) {
      const normalize = (title: string) => title.replace(/\s+/g, ' ').trim().toLowerCase();
      const sameTitle = candidates.filter((candidate) => !candidate.disabled && normalize(candidate.title) === normalize(preferredTitle));
      // Only a unique exact title may identify a fixed HH resume with no DOM id.
      if (sameTitle.length === 1 && !sameTitle[0].id) sameTitle[0].id = preferredResumeUrl?.match(/\/resume\/([a-z0-9_-]+)/i)?.[1];
    }
    const ranked = rankResumes(vacancy, candidates, preferredResumeUrl, requirePreferred);
    const best = ranked[0];
    if (!best && requirePreferred) throw new HHAutomationError('resume', 'HH не показал выбранное в боте резюме. Выберите его вручную перед отправкой отклика.');
    if (!best) throw new HHAutomationError('apply', 'HH не показал доступные резюме перед откликом');
    const candidate = best.candidate;
    if (nativeSelect) {
      await nativeSelect.selectOption(candidate.id!);
      if (await nativeSelect.inputValue() !== candidate.id) throw new HHAutomationError('apply', 'HH не подтвердил выбор резюме');
    } else if (await candidate.locator.getAttribute('type') === 'radio') {
      await candidate.locator.check();
      if (!await candidate.locator.isChecked()) throw new HHAutomationError('apply', 'HH не подтвердил выбор резюме');
    } else if (candidates.length > 1 || candidate.locator !== currentTitle) {
      await candidate.locator.click({ timeout: 10000 });
      if (currentTitle) {
        await page.waitForFunction((title) => Array.from(document.querySelectorAll('[data-qa="resume-title"], [data-qa="vacancy-response-popup-resume-title"]'))
          .some((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim() === title), candidate.title, { timeout: 5000 });
      }
    }

    await writeLog('info', 'Выбрано резюме: «' + candidate.title + '»', {
      vacancyUrl: vacancy.url, resumeTitle: candidate.title,
      ranking: ranked.map(({ candidate: item, score }) => ({ title: item.title, score }))
    });
    return candidate.title;
  }

  private async findCoverLetterInput(page: Page) {
    return this.firstVisible(page, [
      'textarea[data-qa="vacancy-response-popup-form-letter-input"]',
      'textarea[data-qa*="letter"]',
      'textarea[name="letter"]',
      'textarea[placeholder*="сопровод"]',
      'textarea[placeholder*="пись"]',
      '[contenteditable="true"][data-qa*="letter"]',
      '[contenteditable="true"]'
    ]);
  }

  private async fillCoverLetter(page: Page, coverLetter: string) {
    const text = coverLetter.trim();
    if (!text) return;

    let input = await this.findCoverLetterInput(page);

    if (!input) {
      const addLetterButton = await this.firstVisible(page, [
        '[data-qa="add-cover-letter"]',
        '[data-qa="vacancy-response-letter-toggle"]',
        'button:has-text("Сопроводительное")',
        'a:has-text("Сопроводительное")',
        'button:has-text("Добавить письмо")',
        'a:has-text("Добавить письмо")',
        'button:has-text("Написать сообщение")',
        'button:has-text("Написать письмо")',
        '[data-qa*="letter"]'
      ]);

      if (addLetterButton) {
        await addLetterButton.click({ timeout: 10000 });
        await page.waitForTimeout(1000);
        input = await this.findCoverLetterInput(page);
      }
    }

    if (!input) {
      throw new HHAutomationError("apply", "Поле сопроводительного письма не найдено. Отклик без письма не отправлен.");
    }

    await input.scrollIntoViewIfNeeded().catch(() => undefined);
    const tagName = await input.evaluate((node) => node.tagName.toLowerCase()).catch(() => "");

    if (tagName === "textarea" || tagName === "input") {
      await input.fill(text, { timeout: 10000 });
    } else {
      await input.click({ timeout: 10000 });
      await page.keyboard.press("Control+A").catch(() => undefined);
      await page.keyboard.type(text, { delay: 8 });
    }

    const currentValue = await input
      .evaluate((node) => {
        if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) return node.value;
        return node.textContent ?? "";
      })
      .catch(() => "");

    if (!currentValue.includes(text.slice(0, Math.min(20, text.length)))) {
      throw new HHAutomationError("apply", "Не удалось заполнить сопроводительное письмо");
    }
  }

  private archivedNotice(page: Page) {
    return page.getByText(/^(?:(?:Эта\s+)?вакансия(?:\s+находится)?\s+в\s+архиве|в\s+архиве(?:\s+с\s+.+)?)[.!]?$/i).first();
  }

  private async assertVacancyActive(page: Page) {
    await this.assertVacancyAccessible(page);
    if (await this.archivedNotice(page).isVisible().catch(() => false)) {
      throw new HHAutomationError("archived", "Вакансия в архиве; отклики больше не принимаются");
    }
  }

  private async responseWasSent(page: Page) {
    const successControl = await this.firstVisible(page, [
      '[data-qa="responded-success-attach-cover-letter"]',
      '[data-qa="vacancy-response-success"]',
      '[data-qa="vacancy-response-link-top-again"]',
      '[data-qa="vacancy-response-link-view-topic"]'
    ]);
    if (successControl) return true;

    const mainText = await page.locator('[data-qa="main-content"], main').first().innerText({ timeout: 2000 }).catch(() => this.bodyText(page));
    const normalized = mainText.normalize("NFKC").replace(/\s+/gu, " ").trim();
    return /вы (?:уже )?(?:откликнулись|откликались|отправили отклик)|отклик (?:уже )?(?:был )?отправлен|резюме доставлено/i.test(normalized);
  }

  private async hasAdditionalRequirements(page: Page) {
    return Boolean(await this.firstVisible(page, [
      '[data-qa="hidden-resume-warning"]:visible',
      'textarea[name^="task_"]:visible', 'input[name^="task_"]:visible', 'select[name^="task_"]:visible',
      '[data-qa="vacancy-response-questionnaire"]:visible'
    ]));
  }

  private async skipRequirementsIfRequested(page: Page, skip: boolean, stopRequested?: StopSignal) {
    if (!skip) return;
    await this.waitForCaptcha(page, stopRequested);
    if (await this.hasAdditionalRequirements(page)) {
      throw new HHAutomationError("requirements", "Вакансия с дополнительными требованиями пропущена по выбранному режиму");
    }
  }

  private async waitForConfirmedResponse(page: Page, stopRequested?: StopSignal, skipAdditionalRequirements = false) {
    while (true) {
      this.assertNotStopped(stopRequested);
      await this.waitForCaptcha(page, stopRequested);
      if (await this.responseWasSent(page)) return;
      await this.assertVacancyActive(page);
      await this.skipRequirementsIfRequested(page, skipAdditionalRequirements, stopRequested);
      await this.waitForManualAction(page, stopRequested,
        "HH ещё не подтвердил отклик. Завершите форму или проверку вручную, затем нажмите «Проверить и продолжить». Очередь ждёт.");
    }
  }

  async completeApplicationManually(vacancy: Vacancy, stopRequested: StopSignal, error: string, skipAdditionalRequirements = false): Promise<ApplyToVacancyResult> {
    const page = this.page;
    if (!page || page.isClosed()) throw new HHAutomationError("stopped", "Страница отклика закрыта; очередь остановлена");
    await this.waitForCaptcha(page, stopRequested);
    if (await this.responseWasSent(page)) return { alreadyApplied: true, coverLetterDelivery: "none" };
    await this.assertVacancyActive(page);
    await this.skipRequirementsIfRequested(page, skipAdditionalRequirements, stopRequested);
    await this.waitForManualAction(page, stopRequested,
      "По вакансии «" + vacancy.title + "» нужно ваше действие: " + error + ". Завершите отклик вручную, затем нажмите «Проверить и продолжить».");
    await this.waitForConfirmedResponse(page, stopRequested, skipAdditionalRequirements);
    await this.context?.storageState({ path: hhConfig.storageStatePath });
    return { alreadyApplied: false, coverLetterDelivery: "none", warning: "Отклик завершён вручную", selectedResume: undefined };
  }

  private async findChatFrame(page: Page) {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      const frame = page.frames().find((candidate) => candidate.url().includes("chatik.hh.ru/chat/"));
      if (frame) return frame;
      await page.waitForTimeout(250);
    }
    return null;
  }

  private async sendCoverLetterViaChat(
    page: Page,
    coverLetter: string,
    delayRange: DelayRange,
    stopRequested?: StopSignal
  ): Promise<"chat"> {
    const chatButton = await this.firstVisible(page, [
      '[data-qa="vacancy-response-link-view-topic"]',
      'button:text-is("Чат")',
      'button:has-text("Написать сообщение")'
    ]);
    if (!chatButton) {
      throw new HHAutomationError("apply", "Отклик отправлен, но HH не показал ни форму письма, ни чат");
    }

    await chatButton.click({ timeout: 10000 });
    const chatFrame = await this.findChatFrame(page);
    if (!chatFrame) {
      throw new HHAutomationError("apply", "Чат HH не открылся после отклика");
    }

    const input = await this.firstVisibleInFrame(chatFrame, [
      '[data-qa="chatik-new-message-text"]',
      'textarea[placeholder*="Сообщение"]',
      "textarea"
    ]);
    if (!input) {
      throw new HHAutomationError("apply", "В чате HH не найдено поле сообщения");
    }

    await input.fill(coverLetter.trim(), { timeout: 10000 });
    const sendButton = await this.firstVisibleInFrame(chatFrame, [
      '[data-qa="chatik-do-send-message"]',
      'button[aria-label*="Отправ"]',
      'button:has-text("Отправить")'
    ]);
    if (!sendButton) {
      throw new HHAutomationError("apply", "В чате HH не найдена кнопка отправки");
    }

    await this.waitHumanDelay(page, delayRange, stopRequested);
    await sendButton.click({ timeout: 10000 });
    await page.waitForTimeout(1200);
    const remainingText = await input.inputValue().catch(() => "");
    if (remainingText.trim()) {
      throw new HHAutomationError("apply", "HH не подтвердил отправку сопроводительного в чат");
    }

    await writeLog("info", "Сопроводительное отправлено через чат HH");
    return "chat";
  }

  private async sendCoverLetterAfterImmediateApply(
    page: Page,
    coverLetter: string,
    delayRange: DelayRange,
    stopRequested?: StopSignal
  ): Promise<"after-apply" | "chat" | "none"> {
    const text = coverLetter.trim();
    if (!text) return "none";

    const attachButton = await this.firstVisible(page, [
      '[data-qa="responded-success-attach-cover-letter"]',
      'button:has-text("Приложить сопроводительное письмо")',
      'a:has-text("Добавить сопроводительное")'
    ]);

    if (!attachButton) {
      return this.sendCoverLetterViaChat(page, text, delayRange, stopRequested);
    }

    await attachButton.click({ timeout: 10000 });
    await page.waitForTimeout(500);
    await this.fillCoverLetter(page, text);
    const submitButton = await this.firstVisible(page, [
      '[data-qa="vacancy-response-letter-submit"]',
      'button:has-text("Отправить")'
    ]);
    if (!submitButton) {
      throw new HHAutomationError("apply", "Не найдена кнопка отправки сопроводительного после отклика");
    }

    await this.waitHumanDelay(page, delayRange, stopRequested);
    await submitButton.click({ timeout: 10000 });
    await page.waitForTimeout(1200);
    await this.waitForCaptcha(page, stopRequested);

    const inputStillVisible = await page
      .locator('textarea[data-qa="vacancy-response-popup-form-letter-input"]')
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (inputStillVisible) {
      throw new HHAutomationError("apply", "HH не подтвердил отправку сопроводительного письма");
    }

    await writeLog("info", "Сопроводительное приложено после мгновенного отклика");
    return "after-apply";
  }

  async applyToVacancy(
    vacancy: Vacancy,
    coverLetter: string,
    delayRange: { minSeconds: number; maxSeconds: number },
    stopRequested?: StopSignal,
    options: ApplyOptions = { excludedWords: [] }
  ): Promise<ApplyToVacancyResult> {
    const savedMatches = findExcludedWords(vacancy, options.excludedWords);
    if (savedMatches.length) throw new HHAutomationError("excluded", "Запрещённые слова: " + savedMatches.join(", "));
    const page = await this.ensureAuthorized(stopRequested);
    await this.assertAccountOwner(page, options.expectedAccountId);
    this.assertNotStopped(stopRequested);
    const freshVacancy = await this.readVacancyOnPage(page, vacancy, stopRequested, true);
    if (freshVacancy.alreadyApplied) return { alreadyApplied: true, coverLetterDelivery: "none" };
    const matches = findExcludedWords(freshVacancy, options.excludedWords);
    if (matches.length) throw new HHAutomationError("excluded", "Запрещённые слова в полном описании: " + matches.join(", "));

    if (await this.responseWasSent(page)) return { alreadyApplied: true, coverLetterDelivery: "none" };

    const applyButton = await this.firstVisible(page, [
      '[data-qa="vacancy-response-link-top"]',
      '[data-qa="vacancy-response-link-bottom"]',
      'a:has-text("Откликнуться")',
      'button:has-text("Откликнуться")',
      'a:has-text("Отклик")',
      'button:has-text("Отклик")'
    ]);

    if (!applyButton) {
      throw new HHAutomationError("apply", "Не нашел кнопку отклика на странице вакансии");
    }

    await this.waitHumanDelay(page, delayRange, stopRequested);
    // The vacancy button can send immediately with HH's last used resume.
    // Open the response form explicitly so selection happens before any submission.
    const vacancyId = extractExternalId(vacancy.url);
    if (!vacancyId) throw new HHAutomationError("apply", "Не удалось определить ID вакансии HH");
    await this.navigate(page, "https://hh.ru/applicant/vacancy_response?vacancyId=" + vacancyId, stopRequested);
    await page.waitForTimeout(2000);

    await this.waitForCaptcha(page, stopRequested);
    await this.assertVacancyAccessible(page);
    if (await this.detectAuthRequired(page)) throw new HHAutomationError("auth", "HH требует повторный вход перед откликом");

    if (await this.responseWasSent(page)) {
      return { alreadyApplied: true, coverLetterDelivery: "none" };
    }
    await this.assertVacancyActive(page);

    await this.skipRequirementsIfRequested(page, options.skipAdditionalRequirements ?? false, stopRequested);
    let selectedResume: string;
    try {
      selectedResume = await this.selectResumeForVacancy(page, freshVacancy, options.preferredResumeUrl, options.requirePreferredResume, options.preferredResumeTitle, options.allowTitleMatch);
    } catch (error) {
      if (!(error instanceof HHAutomationError) || error.code !== "resume") throw error;
      await this.waitForManualAction(page, stopRequested, error.message + " Затем нажмите «Проверить и продолжить».");
      await this.waitForConfirmedResponse(page, stopRequested, options.skipAdditionalRequirements ?? false);
      return { alreadyApplied: false, coverLetterDelivery: "none" };
    }
    await this.fillCoverLetter(page, coverLetter);

    if (await this.hasAdditionalRequirements(page)) {
      await this.skipRequirementsIfRequested(page, options.skipAdditionalRequirements ?? false, stopRequested);
      await this.waitForManualAction(page, stopRequested,
        "В форме HH есть дополнительные требования. Завершите их и отправьте отклик вручную, затем нажмите «Проверить и продолжить».");
      await this.waitForConfirmedResponse(page, stopRequested, options.skipAdditionalRequirements ?? false);
      return { alreadyApplied: false, selectedResume, coverLetterDelivery: coverLetter.trim() ? "form" : "none" };
    }

    const submitButton = await this.firstVisible(page, [
      '[data-qa="vacancy-response-submit-popup"]',
      'button:has-text("Отправить")',
      'button:has-text("Откликнуться")',
      'button:has-text("Подтвердить")'
    ]);

    if (!submitButton) {
      throw new HHAutomationError("apply", "Не нашел кнопку отправки отклика после заполнения письма");
    }

    await this.waitHumanDelay(page, delayRange, stopRequested);
    await this.assertAccountOwner(page, options.expectedAccountId);
    await submitButton.click({ timeout: 15000 });
    await page.waitForTimeout(2500);

    // Never discard an unconfirmed form, even if CAPTCHA lives in an unknown
    // iframe or loads late. The exact page remains until the human completes it.
    await this.waitForConfirmedResponse(page, stopRequested, options.skipAdditionalRequirements ?? false);

    await this.context?.storageState({ path: hhConfig.storageStatePath });
    return {
      alreadyApplied: false,
      selectedResume,
      coverLetterDelivery: coverLetter.trim() ? "form" : "none"
    };
  }
}
