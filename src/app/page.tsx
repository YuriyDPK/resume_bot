import Link from "next/link";
import { ArrowUpRight, BriefcaseBusiness, CheckCircle2, Clock3, Settings2, SkipForward, XCircle } from "lucide-react";
import { DashboardActions } from "@/components/dashboard-actions";
import { ActivityLog } from "@/components/activity-log";
import { hhRunner } from "@/lib/hh/runner";
import { getHHAccount } from "@/lib/hh/account";
import { dashboardData } from "@/lib/dashboard-store";

export const dynamic = "force-dynamic";
export default async function DashboardPage() {
  const [data, account] = await Promise.all([dashboardData(), getHHAccount()]);
  const { settings } = data;
  const metrics = [
    { label: "Найдено вакансий", value: data.vacanciesFound, icon: BriefcaseBusiness, tone: "blue", href: "/vacancies?status=all" },
    { label: "Откликов сегодня", value: data.appliedToday, icon: CheckCircle2, tone: "green", href: "/vacancies?status=applied&appliedToday=true" },
    { label: "Ожидают отклика", value: data.pending, icon: Clock3, tone: "amber", href: "/vacancies?status=active" },
    { label: "Пропущено", value: data.skipped, icon: SkipForward, tone: "slate", href: "/vacancies?status=skipped" },
    { label: "Ошибки", value: data.failed, icon: XCircle, tone: "rose", href: "/vacancies?status=failed" }
  ];
  return <div className="page-stack dashboard-page">
    <header className="page-header"><div><p className="eyebrow">Ваш поиск работы</p><h1>Обзор</h1><p className="page-subtitle">Резюме «{settings.name}» · вакансии, отклики и события этого профиля.</p></div><DashboardActions profileId={settings.id} initialState={hhRunner.getState()} initialAccount={account} /></header>
    <section className="metrics-grid" aria-label="Метрики">{metrics.map((metric) => { const Icon = metric.icon; return <Link className="metric-card metric-link" key={metric.label} href={metric.href}>
      <div className="metric-card-top"><span className={"metric-icon " + metric.tone}><Icon size={19} /></span><ArrowUpRight size={16} /></div><span className="metric-label">{metric.label}</span><strong>{metric.value}</strong>
    </Link>; })}</section>
    <section className="panel search-summary"><div className="section-heading"><div><p className="eyebrow">Действующие настройки</p><h2>Что ищет бот</h2></div><Link className="button secondary small" href="/settings#search-filters"><Settings2 size={15} />Изменить фильтры</Link></div>
      <div className="search-summary-grid"><div><small>Ключевые слова</small><div className="filter-chips">{settings.keywords.length ? settings.keywords.map(({ value }) => <Link className="filter-chip" key={value} href={"/vacancies?status=all&q=" + encodeURIComponent(value)}>{value}<ArrowUpRight size={12} /></Link>) : <Link className="muted-text" href="/settings#search-filters">Добавить поисковые запросы →</Link>}</div></div>
        <div><small>География и условия</small><div className="filter-chips"><Link className="filter-chip" href={settings.searchAllRussia ? "/vacancies?status=all" : "/vacancies?status=all&city=" + encodeURIComponent(settings.city)}>{settings.searchAllRussia ? "Вся Россия" : settings.city}</Link><Link className="filter-chip" href="/settings#search-filters">{settings.remoteOnly ? "Только удалённо" : "Любой формат"}</Link><Link className="filter-chip" href="/settings#search-filters">{settings.minSalary ? "От " + settings.minSalary.toLocaleString("ru-RU") + " ₽" : "Без порога зарплаты"}</Link></div></div>
        <div><small>Лимиты поиска</small><p>До <strong>{settings.searchLimit}</strong> новых вакансий · <strong>{settings.dailyLimit}</strong> откликов в день</p><Link className="text-button" href="/auto-apply">Перейти к автооткликам <ArrowUpRight size={13} /></Link></div></div>
    </section>
    <ActivityLog initialData={data.activity} />
  </div>;
}
