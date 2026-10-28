import { deriveSearchKeywordsFromResume } from "@/lib/matching";

export type ResumeSource = { text: string; position?: string; city?: string; salary?: string; workFormat?: string; ownerAccountId?: string };
export type ResumeFields = { keywords?: string; city?: string; minSalary?: number; remoteOnly?: boolean; resumeText?: string };
export type ParsedResume = { title?: string; fields: ResumeFields; notes: string[] };
export type ResumeMergeMode = "replace" | "empty";
export type ResumeField = keyof ResumeFields;
export type ResumeEditableSettings = { keywords: string; city: string; minSalary: number | ""; remoteOnly: boolean; resumeText: string };

export const resumeFieldLabels: Record<ResumeField, string> = {
  keywords: "Ключевые слова для поиска", city: "Город", minSalary: "Минимальная зарплата",
  remoteOnly: "Формат работы", resumeText: "Профиль резюме для подбора"
};

function clean(value: string) {
  return value.normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/[^\S\n]+/g, " ").trim();
}

function labeled(text: string, label: string) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const pattern = new RegExp(`^(?:${label})(?:\\s*[:：]\\s*|\\s+|$)(.*)$`, "i");
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(pattern);
    if (match) return match[1] || lines[index + 1] || "";
  }
  return "";
}

function salaryFromText(text: string) {
  const header = text.split(/^(?:Опыт работы|Образование|Ключевые навыки|Обо мне|Work experience)(?=\s|$)/im)[0];
  return labeled(header, "(?:желаемая|ожидаемая)\\s+зарплата|зарплата|ожидаемый\\s+доход|salary") ||
    header.split("\n").find((line) => /^\s*(?:от\s+)?\d[\d\s.,]*(?:тыс\.?|[kк]|млн)?\s*(?:₽|руб|р\.|RUB|RUR|USD|EUR|BYN|KZT|\$|€)/i.test(line)) || "";
}

function salaryAmount(text: string, notes: string[]) {
  if (!text || /не\s+указан|по\s+договор|not\s+specified/i.test(text)) return undefined;
  if (/USD|EUR|BYN|KZT|UZS|KGS|GBP|CHF|CNY|AED|\$|€|£|₸|доллар|евро|тенге|сом|сум|бел(?:орус)?[.\s]*руб/i.test(text)) {
    notes.push("Зарплата в другой валюте: минимальную зарплату в рублях заполните вручную.");
    return undefined;
  }
  if (/(?:за|в|per)\s*(?:час|день|смен|недел|hour|day|week)|\/\s*(?:час|день|hour|day)/i.test(text)) {
    notes.push("Зарплата указана не за месяц: минимальную месячную зарплату заполните вручную.");
    return undefined;
  }
  const match = clean(text).match(/(\d[\d ]*(?:[.,]\d+)?)\s*(тыс\.?|[kк](?=\s|$)|млн)?/i);
  if (!match) return undefined;
  const unit = match[2] || text.match(/(тыс\.?|[kк]|млн)\s*(?:₽|руб|RUB|RUR|$)/i)?.[1];
  const amount = Number(match[1].replace(/ /g, "").replace(",", ".")) * (unit ? /млн/i.test(unit) ? 1_000_000 : 1000 : 1);
  return Number.isFinite(amount) && amount > 0 && amount <= 1_000_000_000 ? Math.round(amount) : undefined;
}

function remotePreference(value: string) {
  if (!value) return undefined;
  const remote = /удал[её]н|дистанцион|\bremote\b/i.test(value);
  const other = /офис|гибрид|на\s+(?:месте|территории)\s+работодателя|разъезд|вахт|полный\s+день|сменный|\bhybrid\b|on[- ]?site/i.test(value);
  if (/не\s+(?:рассматриваю|подходит|готов\S*)\s+(?:к\s+)?удал[её]н/i.test(value)) return false;
  return remote ? !other : other ? false : undefined;
}

export function resumeTitleFromText(text: string) {
  return clean(labeled(text, "желаемая\\s+должность(?:\\s+и\\s+зарплата)?|должность|desired\\s+position")).slice(0, 200);
}

export function parseResumeSettings(source: ResumeSource): ParsedResume {
  const text = clean(source.text).slice(0, 12000);
  const preferences = text.split(/^(?:Опыт работы|Образование|Ключевые навыки|Обо мне|Work experience)(?=\s|$)/im)[0];
  const fields: ResumeFields = {};
  const notes: string[] = [];
  const position = clean(source.position ?? "");
  const keywords = deriveSearchKeywordsFromResume(position ? "Желаемая должность: " + position : text);
  if (keywords.length) fields.keywords = keywords.join("\n");
  else notes.push("Желаемая должность не найдена: ключевые слова оставлены без изменений.");

  const city = clean(source.city || labeled(preferences, "(?:город(?:\\s+проживания)?|проживает|место\\s+(?:жительства|проживания)|location)"))
    .replace(/^(?:город|г\.)\s+/i, "").split(/[,;\n]/)[0].trim();
  if (city && city.length <= 120 && !/[:\d]|не\s+указан|готов(?:ность)?\s+к/i.test(city)) fields.city = city;
  else notes.push("Город проживания не найден: поле города оставлено без изменений.");

  const salary = source.salary || salaryFromText(text);
  const salaryNotes = notes.length;
  const amount = salaryAmount(salary, notes);
  if (amount !== undefined) fields.minSalary = amount;
  else if (notes.length === salaryNotes) notes.push("Желаемая зарплата не указана: минимальная зарплата оставлена без изменений.");

  const format = source.workFormat || labeled(preferences, "(?:предпочитаемый\\s+)?формат\\s+работы|график\\s+работы|work\\s+(?:format|schedule)");
  const remoteOnly = remotePreference(format);
  if (remoteOnly !== undefined) fields.remoteOnly = remoteOnly;
  else notes.push("Формат работы не указан: текущая настройка сохранится.");
  if (text) fields.resumeText = position && !/^Желаемая\s+должность\s*:/im.test(text) ? "Желаемая должность: " + position + "\n" + text : text;
  const title = (position || resumeTitleFromText(text)).slice(0, 200);
  return { fields, notes, ...(title ? { title } : {}) };
}

function filled(value: unknown) {
  return typeof value === "string" ? Boolean(value.trim()) : value !== null && value !== undefined;
}

export function resumeConflicts(current: ResumeEditableSettings, incoming: ResumeFields): ResumeField[] {
  return (Object.keys(incoming) as ResumeField[]).filter((key) => filled(incoming[key]) && filled(current[key]) && incoming[key] !== current[key]);
}

export function mergeResumeFields<T extends ResumeEditableSettings>(current: T, incoming: ResumeFields, mode: ResumeMergeMode): T {
  const next = { ...current };
  for (const key of Object.keys(incoming) as ResumeField[]) {
    if (filled(incoming[key]) && (mode === "replace" || !filled(current[key]))) Object.assign(next, { [key]: incoming[key] });
  }
  return next;
}
