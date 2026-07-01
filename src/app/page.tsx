import { AlertTriangle, BriefcaseBusiness, CheckCircle2, Clock3, SkipForward, XCircle } from "lucide-react";
import { unstable_noStore as noStore } from "next/cache";
import { DashboardActions } from "@/components/dashboard-actions";
import { hhRunner } from "@/lib/hh/runner";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

const statusLabels: Record<string, string> = {
  info: "Info",
  warn: "Warn",
  error: "Error"
};

export default async function DashboardPage() {
  noStore();
  const today = startOfToday();

  const [vacanciesFound, appliedToday, pending, skipped, failed, recentLogs] = await Promise.all([
    prisma.vacancy.count(),
    prisma.application.count({ where: { status: "applied", appliedAt: { gte: today } } }),
    prisma.vacancy.count({ where: { status: "pending" } }),
    prisma.vacancy.count({ where: { status: "skipped" } }),
    prisma.vacancy.count({ where: { status: "failed" } }),
    prisma.log.findMany({ orderBy: { createdAt: "desc" }, take: 6 })
  ]);

  const metrics = [
    { label: "Найдено вакансий", value: vacanciesFound, icon: BriefcaseBusiness, tone: "blue" },
    { label: "Откликов сегодня", value: appliedToday, icon: CheckCircle2, tone: "green" },
    { label: "Ожидают отклика", value: pending, icon: Clock3, tone: "amber" },
    { label: "Пропущено", value: skipped, icon: SkipForward, tone: "slate" },
    { label: "Ошибки", value: failed, icon: XCircle, tone: "rose" }
  ];

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">HH.ru automation</p>
          <h1>Dashboard</h1>
        </div>
        <DashboardActions initialState={hhRunner.getState()} />
      </header>

      <section className="metrics-grid" aria-label="Метрики">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <article className="metric-card" key={metric.label}>
              <span className={"metric-icon " + metric.tone}>
                <Icon size={20} />
              </span>
              <span className="metric-label">{metric.label}</span>
              <strong>{metric.value}</strong>
            </article>
          );
        })}
      </section>

      <section className="panel wide-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Activity</p>
            <h2>Логи</h2>
          </div>
          <AlertTriangle size={20} />
        </div>
        <div className="log-list">
          {recentLogs.length === 0 ? (
            <p className="empty-state">Пока нет событий.</p>
          ) : (
            recentLogs.map((log) => (
              <div className="log-row" key={log.id}>
                <span className={"status-pill " + log.level}>{statusLabels[log.level]}</span>
                <span>{log.message}</span>
                <time>{log.createdAt.toLocaleString("ru-RU")}</time>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
