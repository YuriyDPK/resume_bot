export function normalizeText(value: string | null | undefined) {
  return (value ?? "").normalize("NFKC").toLowerCase().replace(/ё/g, "е")
    .replace(/[\u200b-\u200d\ufeff\u00ad]/g, "");
}

export function textWords(value: string | null | undefined) {
  return normalizeText(value).replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|quot);/g, " ")
    .match(/[\p{L}\p{N}+#]+/gu) ?? [];
}

export function russianStem(word: string) {
  if (!/^[а-я]{4,}$/.test(word)) return word;
  const stem = word.replace(/(?:иями|ями|ами|ого|ему|ому|ыми|ими|ая|яя|ое|ее|ые|ие|ый|ий|ой|ую|юю|ов|ев|ом|ем|ам|ям|ах|ях|ы|и|а|я|у|ю|е|о)$/, "").replace(/[ьй]$/, "");
  return stem.length >= 3 ? stem : word;
}

const connectiveWords = new Set(["и", "в", "на", "по", "для", "с", "со", "или", "the", "and", "of", "with", "for", "or"]);

// Shared, profession-independent terms. Keep single Latin letters for driver categories B/C and technologies C/R.
export function searchTerms(value: string | null | undefined) {
  return Array.from(new Set(textWords(value).filter((word) => !connectiveWords.has(word)).map(russianStem)));
}

export function queryMatchesText(query: string, value: string | null | undefined) {
  const expected = searchTerms(query);
  const actual = new Set(searchTerms(value));
  return expected.length > 0 && expected.every((term) => actual.has(term));
}
