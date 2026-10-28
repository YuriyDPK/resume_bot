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

export function findExcludedWords(vacancy: FilterableVacancy, excludedWords: string[]) {
  const fields = [vacancy.title, vacancy.company, vacancy.description, vacancy.city, vacancy.salary]
    .filter((field): field is string => Boolean(field)).map(textWords);
  return parseExcludedWords(excludedWords).filter((entry) => {
    const phrase = textWords(entry);
    if (phrase.length === 0) return false;
    return fields.some((field) => field.some((_, index) =>
      phrase.every((word, offset) => field[index + offset] !== undefined && matchesWord(field[index + offset], word))));
  });
}

export function vacancyHasExcludedWords(vacancy: FilterableVacancy, excludedWords: string[]) {
  return findExcludedWords(vacancy, excludedWords).length > 0;
}
