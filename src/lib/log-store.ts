import { activeProfileId } from "@/lib/profiles";
import { prisma } from "@/lib/prisma";
import { logFilters, logWhere, type LogList } from "@/lib/log-query";
export async function listLogs(params: URLSearchParams, selectedProfileId?: number): Promise<LogList> {
  const profileId = selectedProfileId ?? await activeProfileId();
  const filters = logFilters(params), where = { ...logWhere(filters), profileId };
  const total = await prisma.log.count({ where });
  const pages = Math.max(1, Math.ceil(total / filters.pageSize));
  filters.page = Math.min(filters.page, pages);
  const logs = await prisma.log.findMany({ where, orderBy: [{ createdAt: filters.sort }, { id: filters.sort }], skip: (filters.page - 1) * filters.pageSize, take: filters.pageSize });
  return { profileId, logs: logs.map((log) => ({ ...log, createdAt: log.createdAt.toISOString() })), total, page: filters.page, pages, filters };
}
