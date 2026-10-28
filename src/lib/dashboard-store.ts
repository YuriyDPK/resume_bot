import { activeProfileId } from "@/lib/profiles";
import { prisma } from "@/lib/prisma";
import { dayStart } from "@/lib/list-filters";
import { listLogs } from "@/lib/log-store";
import { ensureSettings } from "@/lib/settings";
export async function dashboardData() {
  const profileId = await activeProfileId();
  const [vacanciesFound, appliedToday, pending, skipped, failed, activity, settings] = await Promise.all([
    prisma.vacancy.count({ where: { profileId } }), prisma.application.count({ where: { vacancy: { profileId }, status: "applied", appliedAt: { gte: dayStart() } } }),
    prisma.vacancy.count({ where: { profileId, status: { in: ["found", "pending"] } } }), prisma.vacancy.count({ where: { profileId, status: "skipped" } }), prisma.vacancy.count({ where: { profileId, status: "failed" } }),
    listLogs(new URLSearchParams(), profileId), ensureSettings(profileId)
  ]);
  return { vacanciesFound, appliedToday, pending, skipped, failed, activity, settings };
}
