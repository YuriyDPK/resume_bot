import { describe, expect, it } from "vitest";
import { findExcludedWords, parseExcludedWords, vacancyHasExcludedWords } from "@/lib/vacancy-filter";
import { isRelevantVacancy } from "@/lib/matching";

describe("forbidden vacancy words", () => {
  it("checks each scoped list only in its intended field", () => {
    const director = { title: "Исполнительный директор", description: "Управление командой менеджеров" };
    const exclusions = { title: ["менеджер"], description: ["холодные звонки"] };
    expect(vacancyHasExcludedWords(director, exclusions)).toBe(false);
    expect(isRelevantVacancy(director, { keywords: ["директор"], excludedWords: exclusions })).toBe(true);
    expect(vacancyHasExcludedWords({ ...director, title: "Менеджер проектов" }, exclusions)).toBe(true);
    expect(vacancyHasExcludedWords({ ...director, description: "Опыт холодных звонков" }, exclusions)).toBe(true);
    expect(vacancyHasExcludedWords({ ...director, company: "Менеджер", description: "Работа с командой" }, exclusions)).toBe(false);
  });
  it("never exempts management titles from explicit exclusions", () => {
    for (const title of ["Менеджер проектов", "Project manager"]) {
      expect(vacancyHasExcludedWords({ title }, ["менеджер", "manager"])).toBe(true);
      expect(isRelevantVacancy({ title }, { keywords: [title], excludedWords: ["менеджер", "manager"] })).toBe(false);
    }
  });
  it("handles Russian inflections, ё, case and invisible characters", () => {
    expect(findExcludedWords({ title: "Ищем СТАЖЁРА и менеджеров", description: "Требуются хо\u200bлодные звонки" }, ["стажер", "менеджер", "холодные звонки"]))
      .toEqual(["стажер", "менеджер", "холодные звонки"]);
  });
  it("normalizes phrase spacing, punctuation and Russian endings", () => {
    expect(vacancyHasExcludedWords({ title: "Разработчик", description: "Опыт холодных\u00a0\nзвонков" }, ["холодные звонки"])).toBe(true);
    expect(vacancyHasExcludedWords({ title: "Без опыта", description: "Без-опыта" }, ["без опыта"])).toBe(true);
  });
  it("matches the complete description and employer", () => {
    expect(vacancyHasExcludedWords({ title: "Разработчик", company: "Стажёр" }, ["стажер"])).toBe(true);
    expect(vacancyHasExcludedWords({ title: "Разработчик", description: "a".repeat(10000) + " Junior" }, ["junior"])).toBe(true);
  });
  it("keeps Latin word boundaries and technologies", () => {
    expect(vacancyHasExcludedWords({ title: "JavaScript React" }, ["Java", "C++"])).toBe(false);
    expect(vacancyHasExcludedWords({ title: "Developer C++" }, ["C++"])).toBe(true);
    expect(vacancyHasExcludedWords({ title: "Java / C#" }, ["Java", "C#"])).toBe(true);
  });
  it("deduplicates settings consistently and ignores empty entries", () => {
    expect(parseExcludedWords(" junior ; Junior, стажёр\nстажер;;")).toEqual(["Junior", "стажер"]);
    expect(vacancyHasExcludedWords({ title: "React" }, [" ", ""])).toBe(false);
  });
});
