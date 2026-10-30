import { normalizeText, russianStem, textWords } from "@/lib/text";
export { normalizeText } from "@/lib/text";

export type FilterableVacancy = {
  title: string;
  company?: string | null;
  description?: string | null;
  city?: string | null;
  salary?: string | null;
};

export function parseExcludedWords(value: string | string[] | null | undefined) {
  const raw = Array.isArray(value) ? value.join("\n") : value ?? "";
  return Array.from(new Map(raw.split(/[\n,;]/).map((word) => word.trim()).filter(Boolean)
    .map((word) => [normalizeText(word), word])).values());
}

function matchesWord(actual: string, expected: string) {
  if (actual === expected) return true;
  // Match Russian inflections and roots (стажёр → стажёра, холодные звонки → холодных звонков).
  // Latin technologies remain whole words: Java does not exclude JavaScript.
  if (!/^[а-я]{4,}$/.test(expected)) return false;
  const stem = russianStem(expected);
  return stem.length >= 3 && actual.startsWith(stem);
}

export type ExclusionLists = { title: string[]; description: string[] };

function matchesInFields(fields: (string | null | undefined)[], excludedWords: string[]) {
  const normalizedFields = fields.filter((field): field is string => Boolean(field)).map(textWords);
  return parseExcludedWords(excludedWords).filter((entry) => {
    const phrase = textWords(entry);
    if (phrase.length === 0) return false;
    return normalizedFields.some((field) => field.some((_, index) =>
      phrase.every((word, offset) => field[index + offset] !== undefined && matchesWord(field[index + offset], word))));
  });
}

export function findExcludedWordsByField(vacancy: FilterableVacancy, excludedWords: ExclusionLists | string[]) {
  // The legacy array interface checks every field; scoped lists check only their field.
  const titleWords = Array.isArray(excludedWords) ? excludedWords : excludedWords.title;
  const descriptionWords = Array.isArray(excludedWords) ? excludedWords : excludedWords.description;
  return {
    title: matchesInFields([vacancy.title], titleWords),
    description: matchesInFields([vacancy.description], descriptionWords),
    other: Array.isArray(excludedWords) ? matchesInFields([vacancy.company, vacancy.city, vacancy.salary], excludedWords) : []
  };
}

export function formatExcludedMatches(matches: ReturnType<typeof findExcludedWordsByField>) {
  return [matches.title.length ? "название: " + matches.title.join(", ") : "", matches.description.length ? "описание: " + matches.description.join(", ") : "", matches.other.length ? "другие поля: " + matches.other.join(", ") : ""].filter(Boolean).join("; ");
}

export function findExcludedWords(vacancy: FilterableVacancy, excludedWords: ExclusionLists | string[]) {
  const matches = findExcludedWordsByField(vacancy, excludedWords);
  return Array.from(new Set([...matches.title, ...matches.description, ...matches.other]));
}

export function vacancyHasExcludedWords(vacancy: FilterableVacancy, excludedWords: ExclusionLists | string[]) {
  return findExcludedWords(vacancy, excludedWords).length > 0;
}
