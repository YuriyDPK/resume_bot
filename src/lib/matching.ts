import { normalizeText, queryMatchesText, searchTerms } from "@/lib/text";
import { vacancyHasExcludedWords, type FilterableVacancy } from "@/lib/vacancy-filter";
export { normalizeText, parseExcludedWords, vacancyHasExcludedWords } from "@/lib/vacancy-filter";

type MatchSettings = {
  city?: string | null;
  minSalary?: number | null;
  resumeText?: string | null;
  keywords: string[];
  excludedWords?: string[];
};

function uniqueQueries(values: string[]) {
  const queries = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.replace(/\s+/g, " ").trim();
    if (trimmed && !queries.has(normalizeText(trimmed))) queries.set(normalizeText(trimmed), trimmed);
  }
  return Array.from(queries.values());
}

export function deriveSearchKeywordsFromResume(resumeText: string | null | undefined) {
  const lines = (resumeText ?? "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const titles: string[] = [];
  const label = /^(?:желаемая\s+должность(?:\s+и\s+зарплата)?|должность|профессия|позиция|desired\s+(?:job\s+)?(?:title|position)|job\s+title|position)\s*[:：-]?\s*(.*)$/i;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(label);
    if (match) titles.push(match[1] || lines[index + 1] || "");
  }
  // A short, single-line profile can itself be any job title; never infer a profession
  // from incidental technologies, previous jobs or a fixed occupation dictionary.
  if (titles.length === 0 && lines.length === 1 && lines[0].length <= 100 && !/[.!?@]|https?:/i.test(lines[0])) titles.push(lines[0]);
  return uniqueQueries(titles.flatMap((title) => title.split(/\s*[/|;]\s*/)).filter((title) => title.length >= 2 && title.length <= 120)).slice(0, 7);
}

export function buildSearchQueries(keywords: string[], resumeText: string | null | undefined) {
  const manual = uniqueQueries(keywords);
  return (manual.length > 0 ? manual : deriveSearchKeywordsFromResume(resumeText)).slice(0, 15);
}

function salaryHasExpectedMinimum(salary: string | null | undefined, minSalary: number | null | undefined) {
  if (!salary || !minSalary) return false;
  const numbers = salary.replace(/\s+/g, "").match(/\d+/g)?.map(Number) ?? [];
  return numbers.some((value) => value >= minSalary);
}

export function calculateMatchScore(vacancy: FilterableVacancy, settings: MatchSettings) {
  if (vacancyHasExcludedWords(vacancy, settings.excludedWords ?? [])) return 0;
  const text = [vacancy.title, vacancy.description].filter(Boolean).join(" ");
  const queries = buildSearchQueries(settings.keywords, settings.resumeText);
  const resumeTerms = searchTerms(settings.resumeText);
  const vacancyTerms = new Set(searchTerms(text));
  const resumeMatches = resumeTerms.filter((term) => vacancyTerms.has(term)).length;
  let score = 10;
  // Queries are alternatives. Adding another desired job must not lower a good match.
  if (queries.some((query) => queryMatchesText(query, vacancy.title))) score += 45;
  else if (queries.some((query) => queryMatchesText(query, text))) score += 30;
  if (resumeTerms.length > 0) score += Math.min(35, Math.round(resumeMatches / Math.min(resumeTerms.length, 20) * 35));
  const cities = (settings.city ?? "").split(/[,;\n]/).map((city) => normalizeText(city.trim())).filter(Boolean);
  if (cities.some((city) => normalizeText(vacancy.city).includes(city))) score += 10;
  if (salaryHasExpectedMinimum(vacancy.salary, settings.minSalary)) score += 10;
  return Math.max(0, Math.min(100, score));
}

export function isRelevantVacancy(vacancy: FilterableVacancy, settings: MatchSettings) {
  if (vacancyHasExcludedWords(vacancy, settings.excludedWords ?? [])) return false;
  const queries = buildSearchQueries(settings.keywords, settings.resumeText);
  const text = [vacancy.title, vacancy.description].filter(Boolean).join(" ");
  return queries.some((query) => queryMatchesText(query, text));
}
