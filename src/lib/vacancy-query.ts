import type { Prisma } from "@/generated/prisma/client";
import { dayStart, integer, periodStart, periodValue, textVariants, type Period } from "@/lib/list-filters";

export const vacancyStatuses = { active: "В очереди", all: "Все статусы", found: "Найдена", pending: "Ожидает отклика", applied: "Отклик отправлен", skipped: "Пропущена", failed: "Ошибка" };
export const vacancySorts = { score: "По совпадению", newest: "Сначала новые", oldest: "Сначала старые", title: "По названию", company: "По компании" };
export type VacancyFilters = { q: string; status: keyof typeof vacancyStatuses; city: string; company: string; salary: "any" | "with" | "without"; minScore: number; period: Period; sort: keyof typeof vacancySorts; page: number; pageSize: number; latest: boolean; appliedToday: boolean };
export type VacancyRow = { id: number; title: string; company: string; salary: string | null; city: string | null; url: string; matchScore: number; status: string; createdAt: string };
export type VacancyList = { profileId: number; vacancies: VacancyRow[]; total: number; page: number; pages: number; filters: VacancyFilters };

export function vacancyFilters(params: URLSearchParams): VacancyFilters {
  const status = params.get("status") ?? "active", sort = params.get("sort") ?? "score";
  return { q: (params.get("q") ?? "").trim().slice(0, 150), status: Object.hasOwn(vacancyStatuses, status) ? status as VacancyFilters["status"] : "active",
    city: (params.get("city") ?? "").trim().slice(0, 120), company: (params.get("company") ?? "").trim().slice(0, 150),
    salary: ["with", "without"].includes(params.get("salary") ?? "") ? params.get("salary") as VacancyFilters["salary"] : "any",
    minScore: integer(params.get("minScore"), 0, 0, 100), period: periodValue(params.get("period")), sort: Object.hasOwn(vacancySorts, sort) ? sort as VacancyFilters["sort"] : "score",
    page: integer(params.get("page"), 1, 1, 100000), pageSize: [10, 25, 50, 100].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 25,
    latest: params.get("latest") === "true", appliedToday: params.get("appliedToday") === "true" };
}

export function vacancyParams(filters: VacancyFilters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value !== "" && value !== false) params.set(key, String(value));
  return params;
}

export function vacancyWhere(filters: VacancyFilters, activeBatchId?: string | null): Prisma.VacancyWhereInput {
  const and: Prisma.VacancyWhereInput[] = [];
  if (filters.status === "active") and.push({ status: { in: ["found", "pending"] } });
  else if (filters.status !== "all") and.push({ status: filters.status });
  if (filters.q) and.push({ OR: textVariants(filters.q).flatMap((contains) => [{ title: { contains } }, { company: { contains } }, { description: { contains } }]) });
  if (filters.city) and.push({ OR: textVariants(filters.city).map((contains) => ({ city: { contains } })) });
  if (filters.company) and.push({ OR: textVariants(filters.company).map((contains) => ({ company: { contains } })) });
  if (filters.salary === "with") and.push({ salary: { not: null } }, { salary: { not: "" } });
  if (filters.salary === "without") and.push({ OR: [{ salary: null }, { salary: "" }] });
  if (filters.minScore) and.push({ matchScore: { gte: filters.minScore } });
  const since = periodStart(filters.period);
  if (since) and.push({ createdAt: { gte: since } });
  if (filters.latest) and.push({ searchBatchId: activeBatchId ?? "__no_active_batch__" });
  if (filters.appliedToday) and.push({ applications: { some: { status: "applied", appliedAt: { gte: dayStart() } } } });
  return { AND: and };
}

export function vacancyOrder(sort: VacancyFilters["sort"]): Prisma.VacancyOrderByWithRelationInput[] {
  const first: Prisma.VacancyOrderByWithRelationInput = sort === "newest" ? { createdAt: "desc" } : sort === "oldest" ? { createdAt: "asc" } : sort === "title" ? { title: "asc" } : sort === "company" ? { company: "asc" } : { matchScore: "desc" };
  return [first, { id: "desc" }];
}
