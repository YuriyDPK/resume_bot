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
};

const legacyFrontendKeywordSet = new Set(["frontend developer", "typescript", "next.js"]);

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
  const normalized = normalizeText(text);
  const foundRoles = rolePatterns
    .filter((role) => role.patterns.some((pattern) => pattern.test(text)))
    .map((role) => role.query);

  const foundSkills = skillWords.filter((skill) => normalized.includes(normalizeText(skill))).slice(0, 4);
  const queries = [...foundRoles.slice(0, 4), ...foundSkills.slice(0, 3)];

  return Array.from(new Set(queries)).slice(0, 7);
}

export function buildSearchQueries(keywords: string[], resumeText: string | null | undefined) {
  const manual = keywords.map((keyword) => keyword.trim()).filter(Boolean);
  const derived = deriveSearchKeywordsFromResume(resumeText);

  if (derived.length > 0 && looksLikeLegacyFrontendKeywords(manual)) {
    return derived;
  }

  return Array.from(new Set([...manual, ...derived])).slice(0, 12);
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

  if (settings.city && normalizeText(vacancy.city).includes(normalizeText(settings.city))) {
    score += 10;
  }

  if (salaryHasExpectedMinimum(vacancy.salary, settings.minSalary)) {
    score += 10;
  }

  return Math.max(0, Math.min(100, score));
}
