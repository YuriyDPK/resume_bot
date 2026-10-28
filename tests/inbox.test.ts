import { describe, expect, it } from "vitest";
import { replyOutcome } from "@/lib/hh/inbox-scraper";
import { resumeIdFromUrl } from "@/lib/hh/ownership";

describe("HH reply classification", () => {
  it.each(["Отказ", "Резюме не подошло", "discard"])("recognizes a negative HH status: %s", (status) => expect(replyOutcome(status)).toBe("negative"));
  it.each(["Приглашение", "Предложение работы", "invitation"])("recognizes a positive HH status: %s", (status) => expect(replyOutcome(status)).toBe("positive"));
  it("keeps neutral acknowledgements, viewed states and ambiguous messages neutral", () => {
    for (const text of ["Спасибо за отклик!", "Мы рассмотрим ваше резюме", "Можно задать вопрос?", "Хорошего дня"]) expect(replyOutcome("Просмотрен", text)).toBe("neutral");
  });
  it("recognizes explicit incoming invitations and refusals without overriding HH's status", () => {
    expect(replyOutcome("", "Приглашаем вас на собеседование завтра")).toBe("positive");
    expect(replyOutcome("", "К сожалению, мы не готовы предложить вам работу")).toBe("negative");
    expect(replyOutcome("", "Пока не готовы предложить вам работу")).toBe("negative");
    expect(replyOutcome("", "Не приглашаем вас на собеседование")).toBe("negative");
    expect(replyOutcome("Отказ", "Приглашаем вас на собеседование")).toBe("negative");
  });
  it("extracts HH resume identity without tracking parameters and rejects foreign domains", () => {
    expect(resumeIdFromUrl("https://spb.hh.ru/resume/abc123?from=profile")).toBe("abc123");
    expect(resumeIdFromUrl("https://example.com/resume/abc123")).toBeNull();
    expect(resumeIdFromUrl("https://hh.ru/vacancy/123")).toBeNull();
  });
});
