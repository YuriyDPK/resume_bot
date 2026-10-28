export type Period = "all" | "today" | "week" | "month";
export function dayStart(now = new Date()) {
  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(date + "T00:00:00+03:00");
}
export function periodStart(period: string, now = new Date()) {
  if (period === "all") return undefined;
  const start = dayStart(now);
  if (period === "week") start.setUTCDate(start.getUTCDate() - 6);
  if (period === "month") start.setUTCDate(start.getUTCDate() - 29);
  return start;
}
export function integer(value: unknown, fallback: number, min: number, max: number) {
  const number = Number(value);
  return value !== null && value !== "" && Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
export function parseRowIds(value: unknown, max = 200): number[] | null {
  if (!Array.isArray(value) || !value.length || value.length > max || value.some((id) => typeof id !== "number" || !Number.isSafeInteger(id) || id < 1)) return null;
  return [...new Set(value)];
}
export function textVariants(value: string) { return [...new Set([value, value.toLowerCase(), value.toUpperCase(), value.charAt(0).toUpperCase() + value.slice(1).toLowerCase()])]; }
export function periodValue(value: unknown): Period { return ["today", "week", "month"].includes(String(value)) ? value as Period : "all"; }
