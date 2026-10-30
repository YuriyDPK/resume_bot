export type TransferSettings = {
  keywords: string;
  city: string;
  minSalary: number | "";
  coverLetterTemplate: string;
  resumeText: string;
  resumeUrl: string;
  excludedWords: string;
  excludedDescriptionWords: string;
  dailyLimit: number;
  searchLimit: number;
  searchAllRussia: boolean;
  remoteOnly: boolean;
  searchDelayMinSeconds: number;
  searchDelayMaxSeconds: number;
  applyDelayMinSeconds: number;
  applyDelayMaxSeconds: number;
};

const stringFields = ["keywords", "city", "coverLetterTemplate", "resumeText", "resumeUrl", "excludedWords", "excludedDescriptionWords"] as const;
const booleanFields = ["searchAllRussia", "remoteOnly"] as const;
const numberFields = ["dailyLimit", "searchLimit", "searchDelayMinSeconds", "searchDelayMaxSeconds", "applyDelayMinSeconds", "applyDelayMaxSeconds"] as const;

export function exportSettings(value: TransferSettings) {
  // Explicitly copy only editable settings, never account state or additional API fields.
  const settings: Record<string, string | number | boolean> = { minSalary: value.minSalary };
  for (const key of [...stringFields, ...booleanFields, ...numberFields]) settings[key] = value[key];
  return JSON.stringify({ format: "hh-bot-settings", version: 1, settings }, null, 2);
}

export function importSettings(text: string): TransferSettings {
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { throw new Error("Не удалось прочитать JSON-файл настроек."); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Некорректный файл настроек.");
  const file = data as Record<string, unknown>;
  if (file.format !== "hh-bot-settings" || file.version !== 1 || !file.settings || typeof file.settings !== "object" || Array.isArray(file.settings)) {
    throw new Error("Неподдерживаемый формат файла настроек.");
  }
  const source = file.settings as Record<string, unknown>;
  if (stringFields.some((key) => typeof source[key] !== "string") || booleanFields.some((key) => typeof source[key] !== "boolean") ||
      numberFields.some((key) => typeof source[key] !== "number" || !Number.isSafeInteger(source[key]) || (source[key] as number) < 0) ||
      !(source.minSalary === "" || (typeof source.minSalary === "number" && Number.isSafeInteger(source.minSalary) && source.minSalary >= 0)) ||
      (source.dailyLimit as number) < 1 || (source.searchLimit as number) < 1 || (source.searchLimit as number) > 1000) {
    throw new Error("Файл содержит отсутствующие или некорректные настройки.");
  }
  const result: Record<string, unknown> = { minSalary: source.minSalary };
  for (const key of [...stringFields, ...booleanFields, ...numberFields]) result[key] = source[key];
  return result as TransferSettings;
}
