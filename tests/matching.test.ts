import { describe, expect, it } from "vitest";
import { buildSearchQueries, calculateMatchScore, deriveSearchKeywordsFromResume, isRelevantVacancy } from "@/lib/matching";
import { rankResumes } from "@/lib/hh/resume-selection";

describe("profession-independent matching", () => {
  it.each([
    ["водитель", "Водитель-экспедитор"],
    ["бухгалтер", "Помощник бухгалтера"],
    ["медицинская сестра", "Требуется медицинская сестра"],
    ["продавец", "Продавец-кассир"],
    ["кладовщик", "Кладовщик на склад"],
    ["секретарь", "Работа секретаря"],
    ["учитель", "Ассистент учителя"],
    ["врач-терапевт", "Врач терапевт"],
    ["повар", "Повар горячего цеха"],
    ["оператор", "Оператор станка"],
    ["инженер", "Инженер-конструктор"],
    ["hr manager", "HR manager"],
    ["Frontend TypeScript", "Frontend developer TypeScript"]
  ])("accepts the configured profession %s without a built-in role blacklist", (keyword, title) => {
    expect(isRelevantVacancy({ title }, { keywords: [keyword] })).toBe(true);
  });

  it("never adds unrelated management jobs to other searches", () => {
    for (const keyword of ["повар", "бухгалтер", "Frontend"]) {
      expect(isRelevantVacancy({ title: "Исполнительный директор" }, { keywords: [keyword] })).toBe(false);
    }
  });
  it("checks full descriptions for skill queries that do not appear in the title", () => {
    expect(isRelevantVacancy({ title: "Специалист", description: "Ведение учёта, знание Excel и 1С" }, { keywords: ["Excel 1С"] })).toBe(true);
  });
  it("keeps manual keywords authoritative regardless of the resume", () => {
    expect(buildSearchQueries(["Frontend developer", "TypeScript", "Next.js"], "Желаемая должность: Врач")).toEqual(["Frontend developer", "TypeScript", "Next.js"]);
    expect(buildSearchQueries(["Бухгалтер", "бухгалтер"], "Желаемая должность: Frontend")).toEqual(["Бухгалтер"]);
  });
  it("extracts arbitrary desired titles rather than guessing from technologies or experience", () => {
    expect(deriveSearchKeywordsFromResume("Желаемая должность: Пекарь / Кондитер\nОпыт: 5 лет")).toEqual(["Пекарь", "Кондитер"]);
    expect(deriveSearchKeywordsFromResume("Желаемая должность и зарплата\nВетеринарный врач\nОпыт работы")).toEqual(["Ветеринарный врач"]);
    expect(deriveSearchKeywordsFromResume("Desired job title: Welder\nExperience: 5 years")).toEqual(["Welder"]);
    expect(deriveSearchKeywordsFromResume("Повар")).toEqual(["Повар"]);
    expect(deriveSearchKeywordsFromResume("Опыт работы\nИспользовал React, Python и Docker\nРаньше работал менеджером проектов")).toEqual([]);
  });
  it("does not lower a vacancy score when more alternative jobs are configured", () => {
    const vacancy = { title: "Бухгалтер" };
    expect(calculateMatchScore(vacancy, { keywords: ["Бухгалтер", "Повар", "Врач"] })).toBe(calculateMatchScore(vacancy, { keywords: ["Бухгалтер"] }));
  });
  it("uses exclusions for every occupation and assigns forbidden vacancies score zero", () => {
    const vacancy = { title: "Водитель такси", description: "Обязанности водителя" };
    expect(calculateMatchScore(vacancy, { keywords: ["водитель"], excludedWords: ["такси"] })).toBe(0);
    expect(isRelevantVacancy(vacancy, { keywords: ["водитель"], excludedWords: ["водитель"] })).toBe(false);
  });
  it.each([
    ["Водитель категории C", ["Водитель категории B", "Водитель категории C"], 1],
    ["Врач-терапевт", ["Врач-стоматолог", "Врач-терапевт"], 1],
    ["Повар-кондитер", ["Повар горячего цеха", "Повар-кондитер"], 1],
    ["Бухгалтер по зарплате", ["Главный бухгалтер", "Бухгалтер по зарплате"], 1],
    ["Слесарь", ["Электрик", "Резюме слесаря"], 1]
  ])("selects a matching resume for %s using the same algorithm", (title, resumes, expected) => {
    expect(rankResumes({ title }, resumes.map((resume) => ({ title: resume })))[0].candidate.title).toBe(resumes[expected]);
  });
});
