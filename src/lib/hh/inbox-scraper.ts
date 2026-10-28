import type { Frame, Page } from "playwright";
import { HHAutomationError, type StopSignal } from "@/lib/hh/types";

export type ChatMessage = { id: string; text: string; author: "employer" | "applicant" | "unknown"; at: string | null };
export type HHConversation = { externalId: string; vacancyUrl: string | null; vacancyTitle: string; company: string; resumeId: string | null; statusLabel: string; unread: boolean; lastMessage: string; messages: ChatMessage[]; hhUrl: string; lastMessageAt: string | null };

export function replyOutcome(status: string, message = ""): "positive" | "negative" | "neutral" {
  if (/отказ|discard|refus|не\s+подош/i.test(status)) return "negative";
  if (/приглаш|invitation|invite|предложение\s+работ/i.test(status)) return "positive";
  if (/к\s+сожалению[\s\S]{0,220}(?:не\s+готов|не\s+можем|друг\S*\s+кандидат|не\s+подход)|приняли\s+решение\s+(?:отказать|не\s+продолжать)|вакансия\s+(?:уже\s+)?закрыта/i.test(message)) return "negative";
  if (/не\s+приглаша(?:ем|ю)\s+вас|не\s+(?:готовы|можем)\s+предложить\s+вам\s+работ/i.test(message)) return "negative";
  if (/приглаша(?:ем|ю)\s+вас[\s\S]{0,120}(?:собесед|интервью)|готовы\s+предложить\s+вам\s+работ/i.test(message)) return "positive";
  return "neutral";
}

async function chatSnapshot(frame: Frame) {
  return frame.evaluate(() => {
    const messages = [...document.querySelectorAll<HTMLElement>('[data-qa^="chatik-chat-message-"]')].filter((element) => /^chatik-chat-message-[\w-]+$/.test(element.dataset.qa ?? "") && !element.dataset.qa?.includes("bubble")).slice(-100).flatMap((element) => {
      const text = element.querySelector<HTMLElement>('[data-qa="chat-bubble-text"]')?.innerText?.trim() ?? "";
      if (!text) return [];
      const outgoing = element.dataset.author === "applicant" || !!element.querySelector('[data-qa="chat-bubble-icon-read"], [data-qa="status-icon-delivered"], [data-qa="chat-bubble-icon-delivered"]');
      const incoming = element.dataset.author === "employer" || !!element.querySelector('[data-qa="chat-bubble-avatar"], [data-qa="chat-bubble-label"]');
      const rawDate = element.querySelector("time")?.dateTime ?? element.dataset.createdAt;
      const at = rawDate && !Number.isNaN(Date.parse(rawDate)) ? new Date(rawDate).toISOString() : null;
      return [{ id: element.dataset.qa!, text: text.slice(0, 16000), author: outgoing ? "applicant" as const : incoming ? "employer" as const : "unknown" as const, at }];
    });
    const resume = [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/resume/"]')].map((link) => link.href.match(/\/resume\/([a-z0-9_-]+)/i)?.[1]).find(Boolean) ?? null;
    return { messages, resumeId: resume };
  });
}

export async function scrapeInbox(page: Page, options: {
  stopRequested?: StopSignal; navigate: (url: string) => Promise<unknown>;
  check: () => Promise<void>; onConversation: (row: HHConversation) => Promise<void>;
}) {
  let count = 0;
  const seen = new Set<string>();
  await options.navigate("https://hh.ru/applicant/negotiations");
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    await options.check();
    await page.locator('[data-qa="negotiations-list"]').waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1500);
    const rows = await page.locator('[data-qa="negotiations-item"]').evaluateAll((elements) => elements.map((element) => {
      const link = element.querySelector<HTMLAnchorElement>('a[href*="/vacancy/"]');
      const rawUrl = link?.href ?? "";
      const id = rawUrl.match(/\/vacancy\/(\d+)/)?.[1];
      return { id, vacancyUrl: id ? "https://hh.ru/vacancy/" + id : null, vacancyTitle: element.querySelector<HTMLElement>('[data-qa="negotiations-item-vacancy"]')?.innerText?.trim() || link?.innerText?.trim() || "Вакансия HH",
        company: element.querySelector<HTMLElement>('[data-qa="negotiations-item-company"]')?.innerText?.trim() ?? "", statusLabel: [...element.querySelectorAll<HTMLElement>('[data-qa*="negotiations-tag"]')].map((node) => node.innerText.trim()).join(" · "),
        unread: !!element.querySelector('[data-qa*="unread"], [data-qa="unread-messages-count"]') };
    }));
    for (let index = 0; index < rows.length && count < 100; index += 1) {
      await options.check();
      const row = rows[index];
      if (!row.id || seen.has(row.id)) continue;
      seen.add(row.id);
      let snapshot: { messages: ChatMessage[]; resumeId: string | null } = { messages: [], resumeId: null };
      const button = page.locator('[data-qa="negotiations-item"]').nth(index).locator('[data-qa="open_chat"]');
      if (await button.isVisible().catch(() => false)) {
        await button.click({ timeout: 7000 });
        let frame: Frame | undefined;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await options.check();
          frame = page.frames().find((candidate) => /^https:\/\/chatik\.hh\.ru\/chat\//.test(candidate.url()));
          if (frame && await frame.locator('[data-qa="chatik-header-vacancy-link"], [data-qa^="chatik-chat-message-"]').first().isVisible().catch(() => false)) break;
          await page.waitForTimeout(250);
        }
        if (frame) {
          // Opening another row must not import the previous chat while HH loads.
          await frame.waitForFunction((id) => {
            const link = document.querySelector<HTMLAnchorElement>('[data-qa="chatik-header-vacancy-link"]');
            return !!link?.href.match(new RegExp("/vacancy/" + id + "(?:[/?#]|$)"));
          }, row.id, { timeout: 5000 }).catch(() => undefined);
          const link = await frame.locator('[data-qa="chatik-header-vacancy-link"]').getAttribute("href", { timeout: 500 }).catch(() => null);
          if (link?.match(/\/vacancy\/(\d+)/)?.[1] === row.id) {
            snapshot = await chatSnapshot(frame);
          }
          await frame.locator('[data-qa="chatik-collapse-chatik"]').click({ timeout: 1000 }).catch(() => undefined);
        }
      }
      const incoming = snapshot.messages.filter((message) => message.author === "employer");
      const last = incoming.at(-1) ?? snapshot.messages.at(-1);
      await options.onConversation({ ...row, externalId: "vacancy:" + row.id, resumeId: snapshot.resumeId, messages: snapshot.messages, lastMessage: last?.text ?? "", lastMessageAt: last?.at ?? null,
        hhUrl: "https://hh.ru/applicant/negotiations" });
      count += 1;
    }
    if (count >= 100) break;
    // HH may append another group while the last visible chat is being read.
    if (await page.locator('[data-qa="negotiations-item"]').count() > rows.length) continue;
    const next = page.locator('a[data-qa="pager-next"]');
    const href = await next.getAttribute("href", { timeout: 500 }).catch(() => null);
    if (!href) {
      const more = page.locator('button[data-qa="pager-next"], [data-qa="negotiations-load-more"]').or(page.getByRole("button", { name: /^(?:Показать|Загрузить)\s+ещ[её]/i })).first();
      if (await more.isVisible().catch(() => false) && await more.isEnabled()) { await more.click(); await page.waitForTimeout(500); continue; }
      break;
    }
    const url = new URL(href, page.url());
    if (url.origin !== "https://hh.ru" || url.pathname !== "/applicant/negotiations") throw new HHAutomationError("browser", "HH показал неизвестный переход списка ответов");
    await options.navigate(url.toString());
  }
  return count;
}
