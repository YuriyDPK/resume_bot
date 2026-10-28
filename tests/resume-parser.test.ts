import { describe, expect, it } from "vitest";
import { mergeResumeFields, parseResumeSettings, resumeConflicts } from "@/lib/resume-parser";
import { normalizeHHResumeUrl } from "@/lib/hh/resume-url";

describe("resume settings extraction for any profession", () => {
  it("extracts a non-IT profession, city, ruble salary and work format", () => {
    const { fields } = parseResumeSettings({ position: "Медицинская сестра / Медбрат", city: "Нижний Новгород, м. Горьковская", salary: "85\u202f000 ₽ за месяц",
      workFormat: "На месте работодателя", text: "Желаемая должность: Медицинская сестра / Медбрат\nНавыки ухода за пациентами" });
    expect(fields).toMatchObject({ keywords: "Медицинская сестра\nМедбрат", city: "Нижний Новгород", minSalary: 85000, remoteOnly: false });
    expect(fields.resumeText).toContain("Навыки ухода");
  });

  it("reads labeled preferences from text and accepts exclusively remote work", () => {
    const { fields } = parseResumeSettings({ text: "Желаемая должность: Переводчик\nПроживает: Санкт-Петербург, готов к командировкам\nЖелаемая зарплата\nот 120 000 до 160 000 руб.\nФормат работы: удалённо\nОпыт работы\nПеревод технических документов" });
    expect(fields).toMatchObject({ keywords: "Переводчик", city: "Санкт-Петербург", minSalary: 120000, remoteOnly: true });
  });

  it.each(["удалённо, гибрид", "офис, удалённая работа", "полный день, удаленная работа"])("does not restrict a candidate allowing several formats to remote only: %s", (workFormat) => {
    expect(parseResumeSettings({ text: "Желаемая должность: Бухгалтер", workFormat }).fields.remoteOnly).toBe(false);
  });

  it("does not take salary, city, or format from a previous employer", () => {
    const { fields } = parseResumeSettings({ text: "Желаемая должность: Водитель категории B\nОпыт работы\nГород: Москва\nЗарплата: 150000 руб.\nГрафик работы: удаленная работа" });
    expect(fields.keywords).toBe("Водитель категории B");
    expect(fields.city).toBeUndefined();
    expect(fields.minSalary).toBeUndefined();
    expect(fields.remoteOnly).toBeUndefined();
  });

  it.each(["150–200 тыс. ₽", "150,5 тыс. рублей", "1.5 млн руб."])("normalizes salary units: %s", (salary) => {
    const expected = salary.startsWith("150–") ? 150000 : salary.startsWith("150,") ? 150500 : 1500000;
    expect(parseResumeSettings({ text: "Желаемая должность: Повар", salary }).fields.minSalary).toBe(expected);
  });

  it.each(["5000 USD", "2500 €", "3000 BYN", "1000 руб. в час"])("leaves unsupported currency or pay period to the user: %s", (salary) => {
    const parsed = parseResumeSettings({ text: "Желаемая должность: Менеджер", salary });
    expect(parsed.fields.minSalary).toBeUndefined();
    expect(parsed.notes.join(" ")).toMatch(/вручную/);
  });

  it("does not invent a desired profession from incidental skills or employment history", () => {
    expect(parseResumeSettings({ text: "Опыт работы\nРаботал бухгалтером. Навыки Python и Excel." }).fields.keywords).toBeUndefined();
  });
});

describe("reviewable merging of parsed settings", () => {
  const current = { keywords: "Врач", city: "Москва", minSalary: "" as number | "", remoteOnly: false, resumeText: "Мой профиль", excludedWords: "стажер", dailyLimit: 5 };
  const incoming = { keywords: "Переводчик", city: "Казань", minSalary: 100000, remoteOnly: true, resumeText: "Новый профиль" };

  it("reports existing values including an explicit unchecked format", () => {
    expect(resumeConflicts(current, incoming)).toEqual(["keywords", "city", "remoteOnly", "resumeText"]);
  });

  it("fills only empty fields and preserves unsaved edits, checkboxes and unrelated settings", () => {
    expect(mergeResumeFields(current, incoming, "empty")).toEqual({ ...current, minSalary: 100000 });
    expect(current.minSalary).toBe("");
  });

  it("replaces only values that were found and never clears a missing field", () => {
    expect(mergeResumeFields(current, { keywords: "Повар" }, "replace")).toEqual({ ...current, keywords: "Повар" });
    expect(mergeResumeFields(current, incoming, "replace")).toEqual({ ...current, ...incoming });
  });

  it("treats whitespace as empty and zero as an existing salary", () => {
    expect(mergeResumeFields({ ...current, keywords: "  ", minSalary: 0 }, incoming, "empty")).toEqual({ ...current, keywords: "Переводчик", minSalary: 0 });
  });

  it("does not request replacement for identical data", () => {
    expect(resumeConflicts(current, { keywords: current.keywords, remoteOnly: false })).toEqual([]);
  });
});

describe("HH resume URL validation", () => {
  it.each(["https://hh.ru/resume/abc123", "https://spb.hh.ru/resume/abc123?from=profile"])("allows a resume URL: %s", (value) => {
    expect(normalizeHHResumeUrl(value)).toBe(value);
  });
  it.each(["http://hh.ru/resume/abc", "https://hh.ru.evil.example/resume/abc", "https://hh.ru/vacancy/123", "https://user:password@hh.ru/resume/abc", "https://hh.ru:8443/resume/abc", "file:///resume/abc", "not a url", null])("rejects unsupported URLs: %s", (value) => {
    expect(normalizeHHResumeUrl(value)).toBeNull();
  });
});
