type MatchInput = {
  title: string;
  company?: string | null;
  description?: string | null;
  city?: string | null;
  salary?: string | null;
};

type MatchSettings = {
  city?: string | null;
  minSalary?: number | null;
  resumeText?: string | null;
  keywords: string[];
  excludedWords?: string[];
};

const legacyFrontendKeywordSet = new Set(["frontend developer", "typescript", "next.js"]);
const irrelevantTitlePatterns = [
  /ассистент/i,
  /помощник/i,
  /секретар/i,
  /стаж[её]р/i,
  /товаровед/i,
  /продавец/i,
  /кассир/i,
  /консультант/i,
  /оператор/i,
  /курьер/i,
  /водитель/i,
  /кладовщик/i,
  /комплектовщик/i,
  /администратор/i,
  /координатор/i,
  /подбор/i,
  /адаптац/i,
  /персонал/i,
  /специалист/i,
  /эксперт/i,
  /менеджер/i,
  /\b(?:assistant|intern|seller|cashier|consultant|operator|driver|courier|warehouse|administrator|coordinator|recruiter|personnel|specialist|expert|manager|hr)\b/i
];
const relevantManagementTitlePatterns = [
  /исполнительн\w*\s+директор/i,
  /операционн\w*\s+директор/i,
  /коммерческ\w*\s+директор/i,
  /управляющ\w*\s+директор/i,
  /генеральн\w*\s+директор/i,
  /директор\w*\s+(?:филиал|по\s+развитию|по\s+продаж|по\s+производств|по\s+операцион|продуктов|производств)/i,
  /заместител\w*\s+(?:генеральн\w*\s+)?директор/i,
  /руководител\w*\s+(?:отдел|подразделен|направлен|проект|производств|филиал)/i,
  /\b(?:executive|operations|commercial|managing|general|branch|development|production)\s+director\b/i,
  /\b(?:ceo|coo|cco|head of)\b/i
];

const rolePatterns = [
  { query: "Исполнительный директор", patterns: [/исполнительн\w* директор/i, /executive director/i, /ceo/i] },
  { query: "Операционный директор", patterns: [/операционн\w* директор/i, /operations director/i, /coo/i] },
  { query: "Заместитель директора", patterns: [/заместител\w* директор/i, /зам\.?\s*директор/i] },
  { query: "Управляющий директор", patterns: [/управляющ\w* директор/i, /managing director/i] },
  { query: "Директор филиала", patterns: [/директор\w* филиал/i, /руководител\w* филиал/i] },
  { query: "Директор по развитию", patterns: [/директор\w* по развитию/i, /business development director/i] },
  { query: "Коммерческий директор", patterns: [/коммерческ\w* директор/i, /chief commercial/i, /cco/i] },
  { query: "Руководитель подразделения", patterns: [/руководител\w* подразделени/i, /руководител\w* направлен/i, /head of/i] },
  { query: "Руководитель отдела", patterns: [/руководител\w* отдел/i, /начальник\w* отдел/i] },
  { query: "Project manager", patterns: [/project manager/i, /проектн\w* менеджер/i, /менеджер\w* проект/i] },
  { query: "Product manager", patterns: [/product manager/i, /продакт/i, /product owner/i] },
  { query: "Business analyst", patterns: [/business analyst/i, /бизнес[-\s]?аналитик/i] },
  { query: "System analyst", patterns: [/system analyst/i, /системн\w* аналитик/i] },
  { query: "Data analyst", patterns: [/data analyst/i, /аналитик\w* данных/i] },
  { query: "Frontend developer", patterns: [/frontend/i, /front[-\s]?end/i, /react/i, /vue/i] },
  { query: "Backend developer", patterns: [/backend/i, /back[-\s]?end/i, /node\.js/i, /java/i, /python/i, /golang/i] },
  { query: "Fullstack developer", patterns: [/fullstack/i, /full[-\s]?stack/i] },
  { query: "QA engineer", patterns: [/qa/i, /quality assurance/i, /тестировщик/i, /тестирован/i] },
  { query: "DevOps engineer", patterns: [/devops/i, /kubernetes/i, /docker/i, /ci\/cd/i] },
  { query: "UX UI designer", patterns: [/ux/i, /ui/i, /figma/i, /дизайн/i] },
  { query: "HR manager", patterns: [/hr/i, /recruiter/i, /рекрутер/i, /подбор персонала/i] },
  { query: "Sales manager", patterns: [/sales/i, /продаж/i, /account manager/i] },
  { query: "Customer support", patterns: [/support/i, /поддержк/i, /клиент/i] }
];

const skillWords = [
  "React",
  "TypeScript",
  "JavaScript",
  "Next.js",
  "Node.js",
  "Python",
  "Java",
  "SQL",
  "PostgreSQL",
  "Prisma",
  "Playwright",
  "Docker",
  "Kubernetes",
  "Figma",
  "Power BI",
  "Excel",
  "1C",
  "CRM",
  "B2B",
  "Agile",
  "Scrum",
  "KPI",
  "P&L",
  "Бюджетирование",
  "Операционное управление",
  "Стратегическое планирование",
  "Развитие бизнеса",
  "Управление продажами",
  "Переговоры",
  "Оптимизация процессов",
  "Административное управление"
];

export function normalizeText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/ё/g, "е");
}

function tokens(value: string | null | undefined) {
  return normalizeText(value)
    .split(/[^a-zа-я0-9+#.]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function salaryHasExpectedMinimum(salary: string | null | undefined, minSalary: number | null | undefined) {
  if (!salary || !minSalary) return false;
  const numbers = salary.replace(/\s+/g, "").match(/\d+/g)?.map((item) => Number.parseInt(item, 10)) ?? [];
  return numbers.some((value) => value >= minSalary);
}

function looksLikeLegacyFrontendKeywords(keywords: string[]) {
  if (keywords.length === 0) return false;
  return keywords.every((keyword) => legacyFrontendKeywordSet.has(normalizeText(keyword)));
}

export function deriveSearchKeywordsFromResume(resumeText: string | null | undefined) {
  const text = resumeText ?? "";
  const foundRoles = rolePatterns
    .filter((role) => role.patterns.some((pattern) => pattern.test(text)))
    .map((role) => role.query);

  const queries = foundRoles.slice(0, 7);

  return Array.from(new Set(queries)).slice(0, 7);
}

export function buildSearchQueries(keywords: string[], resumeText: string | null | undefined) {
  const manual = keywords.map((keyword) => keyword.trim()).filter(Boolean);
  const derived = deriveSearchKeywordsFromResume(resumeText);

  if (derived.length > 0 && looksLikeLegacyFrontendKeywords(manual)) {
    return derived;
  }

  if (manual.length > 0) {
    return Array.from(new Set(manual)).slice(0, 12);
  }

  return Array.from(new Set([...manual, ...derived])).slice(0, 12);
}

export function parseExcludedWords(value: string | string[] | null | undefined) {
  const raw = Array.isArray(value) ? value.join("\n") : value ?? "";
  return Array.from(
    new Set(
      raw
        .split(/[\n,;]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function vacancyHasExcludedWords(vacancy: MatchInput, excludedWords: string[]) {
  if (excludedWords.length === 0) return false;

  const haystack = [vacancy.title, vacancy.company, vacancy.description, vacancy.city].filter(Boolean).join(" ");
  const normalizedHaystack = normalizeText(haystack);
  const haystackTokens = new Set(tokens(haystack));

  return excludedWords.some((word) => {
    const normalizedWord = normalizeText(word.trim());
    if (!normalizedWord) return false;

    const wordTokens = tokens(normalizedWord);
    if (wordTokens.length === 1 && wordTokens[0] === normalizedWord) {
      return haystackTokens.has(normalizedWord);
    }

    return normalizedHaystack.includes(normalizedWord);
  });
}

export function calculateMatchScore(vacancy: MatchInput, settings: MatchSettings) {
  const haystack = normalizeText([vacancy.title, vacancy.company, vacancy.description].filter(Boolean).join(" "));
  const activeKeywords = buildSearchQueries(settings.keywords, settings.resumeText);
  const keywordMatches = activeKeywords.filter((keyword) => haystack.includes(normalizeText(keyword))).length;
  const resumeTokens = Array.from(new Set(tokens(settings.resumeText))).slice(0, 60);
  const resumeMatches = resumeTokens.filter((token) => haystack.includes(token)).length;

  let score = 10;

  if (activeKeywords.length > 0) {
    score += Math.round((keywordMatches / activeKeywords.length) * 45);
  }

  if (resumeTokens.length > 0) {
    score += Math.min(35, Math.round((resumeMatches / Math.min(resumeTokens.length, 16)) * 35));
  }

  const cities = (settings.city ?? "").split(/[,;\n]/).map((city) => normalizeText(city.trim())).filter(Boolean);
  if (cities.some((city) => normalizeText(vacancy.city).includes(city))) {
    score += 10;
  }

  if (salaryHasExpectedMinimum(vacancy.salary, settings.minSalary)) {
    score += 10;
  }

  return Math.max(0, Math.min(100, score));
}

function keywordMatchesTitle(keyword: string, title: string) {
  const normalizedKeyword = normalizeText(keyword);
  const normalizedTitle = normalizeText(title);

  if (!normalizedKeyword || !normalizedTitle) return false;
  if (normalizedTitle.includes(normalizedKeyword)) return true;

  const keywordTokens = tokens(keyword);
  return keywordTokens.length > 0 && keywordTokens.every((token) => normalizedTitle.includes(token));
}

export function isRelevantVacancy(vacancy: MatchInput, settings: MatchSettings) {
  const title = vacancy.title ?? "";
  const normalizedTitle = normalizeText(title);

  if (settings.excludedWords && vacancyHasExcludedWords(vacancy, settings.excludedWords)) {
    return false;
  }

  if (irrelevantTitlePatterns.some((pattern) => pattern.test(normalizedTitle))) {
    return false;
  }

  const manualKeywords = settings.keywords.map((keyword) => keyword.trim()).filter(Boolean);
  const relevantKeywords = manualKeywords.length > 0 ? manualKeywords : deriveSearchKeywordsFromResume(settings.resumeText);
  const hasKeywordRole = relevantKeywords.some((keyword) => keywordMatchesTitle(keyword, title));
  const hasStrictManagementRole = relevantManagementTitlePatterns.some((pattern) => pattern.test(normalizedTitle));

  return hasKeywordRole || hasStrictManagementRole;
}
