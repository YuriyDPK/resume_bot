import { afterEach, describe, expect, it } from "vitest";
import { HHPlaywrightService } from "@/lib/hh/playwright";
import { replyOutcome, type HHConversation } from "@/lib/hh/inbox-scraper";
import { vi } from "vitest";
import type { Vacancy } from "@/generated/prisma/client";
vi.mock("@/lib/log", () => ({ writeLog: vi.fn() }));

describe("read-only HH inbox against local HTML fixtures", () => {
  const service = new HHPlaywrightService();
  afterEach(async () => service.close());
  it("reads separate chats, sender direction and statuses without sending messages", async () => {
    const page = await service.ensureBrowser();
    const requests: string[] = [];
    await page.context().route("**/*", async (route) => {
      const url = new URL(route.request().url()); requests.push(route.request().method() + " " + url.pathname);
      let body = '<script>window.globalVars={hhid:"fixture-owner"}</script><h1>Мои резюме</h1><main data-qa="resume"><a href="https://hh.ru/resume/my-resume">Моё резюме</a></main>';
      if (url.pathname === "/applicant/negotiations") body = '<main data-qa="negotiations-list">' + [1,2].map((id) => `<article data-qa="negotiations-item"><a href="https://hh.ru/vacancy/${id}"><span data-qa="negotiations-item-vacancy">Вакансия ${id}</span></a><div data-qa="negotiations-item-company">Компания ${id}</div><span data-qa="negotiations-tag">${id === 1 ? "Приглашение" : "Отказ"}</span><button data-qa="open_chat" onclick="document.querySelector('iframe')?.remove();const f=document.createElement('iframe');f.src='https://chatik.hh.ru/chat/topic-${id}';document.body.append(f)">Чат</button></article>`).join("") + '</main>';
      if (url.hostname === "chatik.hh.ru") {
        const id = url.pathname.endsWith("1") ? 1 : 2;
        body = `<a data-qa="chatik-header-vacancy-link" href="https://hh.ru/vacancy/${id}">Вакансия</a><a href="https://hh.ru/resume/my-resume">Резюме</a><div data-qa="chatik-chat-message-${id}-1" data-author="applicant"><p data-qa="chat-bubble-text">Моё сопроводительное</p></div><div data-qa="chatik-chat-message-${id}-2" data-author="employer"><p data-qa="chat-bubble-text">${id === 1 ? "Приглашаем вас на собеседование" : "К сожалению, мы не готовы предложить работу"}</p><time datetime="2026-10-28T10:30:00Z"></time></div>`;
      }
      await route.fulfill({ contentType: "text/html; charset=utf-8", body });
    });
    const rows: HHConversation[] = [];
    await service.syncInbox(() => false, async (accountId,row) => { expect(accountId).toBe("fixture-owner"); rows.push(row); });
    expect(rows).toHaveLength(2);
    expect(rows[0].messages.map((message) => message.author)).toEqual(["applicant","employer"]);
    expect(rows[0].lastMessage).toContain("Приглашаем"); expect(rows[1].lastMessage).toContain("К сожалению");
    expect(replyOutcome(rows[0].statusLabel)).toBe("positive"); expect(replyOutcome(rows[1].statusLabel)).toBe("negative");
    expect(rows[0].resumeId).toBe("my-resume"); expect(rows[0].lastMessageAt).toBe("2026-10-28T10:30:00.000Z");
    expect(requests.every((request) => request.startsWith("GET "))).toBe(true);
  });
  it("rejects a publicly accessible foreign resume before navigating to its page", async () => {
    const page = await service.ensureBrowser(); const visited: string[] = [];
    await page.context().route("**/*", async (route) => { visited.push(new URL(route.request().url()).pathname); await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<script>window.globalVars={hhid:"owner"}</script><h1>Мои резюме</h1><article data-qa="resume"><a href="https://hh.ru/resume/own">Своё резюме</a></article>' }); });
    await expect(service.importResumeData("https://hh.ru/resume/foreign")).rejects.toMatchObject({ code: "resume" });
    expect(visited).not.toContain("/resume/foreign");
  });
  it("blocks sending when HH was switched to another account after resume verification", async () => {
    const page = await service.ensureBrowser(); const visited: string[] = [];
    await page.context().route("**/*", async (route) => { visited.push(new URL(route.request().url()).pathname); await route.fulfill({ contentType: "text/html; charset=utf-8", body: '<script>window.globalVars={hhid:"another-owner"}</script><h1>Мои резюме</h1><article data-qa="resume"><a href="https://hh.ru/resume/own">Своё резюме</a></article>' }); });
    await expect(service.applyToVacancy({ title: "Врач", url: "https://hh.ru/vacancy/1" } as Vacancy, "", { minSeconds: 0, maxSeconds: 0 }, undefined, { excludedWords: [], expectedAccountId: "previous-owner" })).rejects.toMatchObject({ code: "auth" });
    expect(visited).not.toContain("/vacancy/1");
  });
});
