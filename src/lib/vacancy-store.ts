import { activeProfileId } from "@/lib/profiles";
import { prisma } from "@/lib/prisma";
import { vacancyFilters, vacancyOrder, vacancyWhere, type VacancyList } from "@/lib/vacancy-query";

export async function listVacancies(params: URLSearchParams, selectedProfileId?: number): Promise<VacancyList> {
  const profileId = selectedProfileId ?? await activeProfileId();
  const filters = vacancyFilters(params);
  const settings = filters.latest ? await prisma.setting.findUnique({ where: { id: profileId }, select: { activeSearchBatchId: true } }) : null;
  const where = { ...vacancyWhere(filters, settings?.activeSearchBatchId), profileId };
  const total = await prisma.vacancy.count({ where });
  const pages = Math.max(1, Math.ceil(total / filters.pageSize));
  filters.page = Math.min(filters.page, pages);
  const vacancies = await prisma.vacancy.findMany({ where, orderBy: vacancyOrder(filters.sort), skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize,
    select: { id: true, title: true, company: true, salary: true, city: true, url: true, status: true, matchScore: true, createdAt: true } });
  return { profileId, vacancies: vacancies.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })), total, page: filters.page, pages, filters };
}
