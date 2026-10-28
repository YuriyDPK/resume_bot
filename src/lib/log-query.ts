import type { Prisma } from "@/generated/prisma/client";
import { integer, periodStart, periodValue, textVariants, type Period } from "@/lib/list-filters";
export type LogFilters = { q: string; level: "all" | "info" | "warn" | "error"; sort: "desc" | "asc"; period: Period; page: number; pageSize: number };
export type LogRow = { id: number; level: string; message: string; meta: string | null; createdAt: string };
export type LogList = { profileId: number; logs: LogRow[]; total: number; page: number; pages: number; filters: LogFilters };
export function logFilters(params: URLSearchParams): LogFilters {
  return { q: (params.get("q") ?? "").trim().slice(0, 150), level: ["info", "warn", "error"].includes(params.get("level") ?? "") ? params.get("level") as LogFilters["level"] : "all",
    sort: params.get("sort") === "asc" ? "asc" : "desc", period: periodValue(params.get("period")), page: integer(params.get("page"), 1, 1, 100000), pageSize: integer(params.get("pageSize"), 20, 10, 100) };
}
export function logWhere(filters: LogFilters): Prisma.LogWhereInput {
  const since = periodStart(filters.period);
  return { ...(filters.level !== "all" ? { level: filters.level } : {}), ...(since ? { createdAt: { gte: since } } : {}),
    ...(filters.q ? { OR: textVariants(filters.q).flatMap((contains) => [{ message: { contains } }, { meta: { contains } }]) } : {}) };
}
