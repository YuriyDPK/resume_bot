"use client";
import { SelectField } from "@/components/select-field";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownUp, ChevronLeft, ChevronRight, Download, ExternalLink, Filter, RotateCcw, Search, Send, SkipForward, Trash2, X } from "lucide-react";
import { VacancyMenu } from "@/components/vacancy-menu";
import { SelectionCheckbox } from "@/components/selection-checkbox";
import { vacancyFilters, vacancyParams, vacancySorts, vacancyStatuses, type VacancyFilters, type VacancyList } from "@/lib/vacancy-query";
export type { VacancyRow } from "@/lib/vacancy-query";

const rowStatuses: Record<string, string> = { found: "Найдена", pending: "В очереди", applied: "Отклик отправлен", skipped: "Пропущена", failed: "Ошибка" };

export function VacancyTable({ data, running, resumeReady }: { data: VacancyList; running: boolean; resumeReady: boolean }) {
  const router = useRouter();
  const [filters, setFilters] = useState(data.filters);
  const [selected, setSelected] = useState<number[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const ids = data.vacancies.map((row) => row.id);
  const chosen = selected.filter((id) => ids.includes(id));
  const canApply = data.vacancies.some((row) => chosen.includes(row.id) && ["found", "pending", "failed"].includes(row.status));
  const canChangeQueue = data.vacancies.some((row) => chosen.includes(row.id) && row.status !== "applied");
  const blocked = running || isPending;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [running, router]);

  function navigate(next: VacancyFilters) { startTransition(() => router.push("/vacancies?" + vacancyParams(next))); }
  function update<K extends keyof VacancyFilters>(key: K, value: VacancyFilters[K]) { setFilters((current) => ({ ...current, [key]: value, ...(key === "status" && value !== "applied" && value !== "all" ? { appliedToday: false } : {}) })); }
  function toggle(id: number, checked: boolean) { setSelected((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id)); }

  function action(type: "apply" | "skip" | "queue" | "delete", actionIds = chosen) {
    if (!actionIds.length || blocked) return;
    if (type === "delete" && !window.confirm(`Удалить выбранные вакансии (${actionIds.length}) и связанную историю откликов?`)) return;
    startTransition(async () => {
      try {
        const response = await fetch("/api/vacancies/bulk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: type, ids: actionIds, profileId: data.profileId }) });
        const payload = await response.json();
        if (!response.ok) { setMessage(payload.error ?? "Не удалось выполнить действие"); return; }
        setMessage(type === "apply" ? "Запущены отклики только на выбранные вакансии" : `Обработано вакансий: ${payload.changed ?? 0}`);
        setSelected([]);
        router.refresh();
      } catch { setMessage("Не удалось связаться с ботом"); }
    });
  }

  function exportSelected() {
    const cell = (value: unknown) => '"' + String(value ?? "").replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"';
    const rows = data.vacancies.filter((row) => chosen.includes(row.id));
    const csv = [["Вакансия", "Компания", "Зарплата", "Город", "Совпадение", "Статус", "Ссылка"], ...rows.map((row) => [row.title, row.company, row.salary, row.city, row.matchScore, rowStatuses[row.status], row.url])].map((row) => row.map(cell).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "hh-vacancies.csv"; link.click(); URL.revokeObjectURL(url);
  }

  return <section className="panel table-panel vacancy-panel">
    <div className="table-toolbar"><div><h2>Список вакансий <span className="count-badge">{data.total}</span></h2><p className="section-description">Правый клик по строке — меню и добавление стоп-фразы.</p></div>
      <button className="button secondary" onClick={() => router.refresh()} disabled={isPending}><RotateCcw size={15} />Обновить</button></div>
    <form className="list-filters" onSubmit={(event) => { event.preventDefault(); navigate({ ...filters, page: 1 }); }}>
      <label className="search-field"><Search size={17} /><input aria-label="Поиск вакансий" placeholder="Название, компания или навык" value={filters.q} onChange={(event) => update("q", event.target.value)} /></label>
      <SelectField aria-label="Статус вакансий" value={filters.status} onValueChange={(value) => update("status", value as VacancyFilters["status"])} options={Object.entries(vacancyStatuses).map(([value, label]) => ({ value, label }))} />
      <SelectField aria-label="Сортировка вакансий" value={filters.sort} onValueChange={(value) => update("sort", value as VacancyFilters["sort"])} options={Object.entries(vacancySorts).map(([value, label]) => ({ value, label }))} />
      <button className="button primary" type="submit"><Filter size={15} />Показать</button>
      <details className="advanced-filters"><summary><Filter size={14} />Дополнительные фильтры</summary><div className="filter-grid">
        <label>Город<input aria-label="Фильтр по городу" value={filters.city} onChange={(event) => update("city", event.target.value)} placeholder="Любой город" /></label>
        <label>Компания<input aria-label="Фильтр по компании" value={filters.company} onChange={(event) => update("company", event.target.value)} placeholder="Любая компания" /></label>
        <label>Зарплата<SelectField aria-label="Наличие зарплаты" value={filters.salary} onValueChange={(value) => update("salary", value as VacancyFilters["salary"])} options={[{value:"any",label:"Неважно"},{value:"with",label:"Указана"},{value:"without",label:"Не указана"}]} /></label>
        <label>Совпадение от<input type="number" min={0} max={100} aria-label="Минимальное совпадение" value={filters.minScore} onChange={(event) => update("minScore", Math.max(0, Math.min(100, Number(event.target.value))))} /></label>
        <label>Найдены за период<SelectField aria-label="Период вакансий" value={filters.period} onValueChange={(value) => update("period", value as VacancyFilters["period"])} options={[{value:"all",label:"Всё время"},{value:"today",label:"Сегодня"},{value:"week",label:"7 дней"},{value:"month",label:"30 дней"}]} /></label>
        <label className="filter-check"><input type="checkbox" checked={filters.latest} onChange={(event) => update("latest", event.target.checked)} />Последний поиск</label>
        <label className="filter-check"><input type="checkbox" checked={filters.appliedToday} onChange={(event) => update("appliedToday", event.target.checked)} />Откликнулись сегодня</label>
      </div></details>
    </form>
    <div className="filter-chips"><span className="filter-chip">{vacancyStatuses[data.filters.status]}</span>{data.filters.q && <span className="filter-chip">Поиск: {data.filters.q}</span>}{data.filters.city && <span className="filter-chip">{data.filters.city}</span>}{data.filters.minScore > 0 && <span className="filter-chip">От {data.filters.minScore}%</span>}{data.filters.latest && <span className="filter-chip">Последний поиск</span>}{data.filters.appliedToday && <span className="filter-chip">Отклики сегодня</span>}
      <button className="text-button" onClick={() => navigate(vacancyFilters(new URLSearchParams()))}><X size={13} />Сбросить</button></div>
    {running && <p className="notice-line">Бот работает. Действия с очередью станут доступны после остановки процесса.</p>}
    {chosen.length > 0 && <div className="selection-toolbar"><strong>Выбрано: {chosen.length}</strong>
      <button className="button primary small" disabled={blocked || !canApply || !resumeReady} onClick={() => action("apply")}><Send size={14} />Откликнуться</button>
      <button className="button secondary small" disabled={blocked || !canChangeQueue} onClick={() => action("skip")}><SkipForward size={14} />Пропустить</button>
      <button className="button secondary small" disabled={blocked || !canChangeQueue} onClick={() => action("queue")}><RotateCcw size={14} />В очередь</button>
      <button className="button secondary small" onClick={exportSelected}><Download size={14} />CSV</button>
      <button className="button danger small" disabled={blocked} onClick={() => action("delete")}><Trash2 size={14} />Удалить</button>
      <button className="icon-button" aria-label="Снять выбор вакансий" onClick={() => setSelected([])}><X size={15} /></button></div>}
    {message && <p className="notice-line" role="status">{message}</p>}
    <div className="table-wrap"><table className="vacancy-table"><thead><tr>
      <th className="select-cell"><SelectionCheckbox label="Выбрать все вакансии на странице" checked={ids.length > 0 && chosen.length === ids.length} mixed={chosen.length > 0 && chosen.length < ids.length} onChange={(checked) => setSelected(checked ? ids : [])} /></th>
      <th><button className="column-sort" onClick={() => navigate({ ...data.filters, sort: "title", page: 1 })}>Вакансия <ArrowDownUp size={12} /></button></th><th>Условия</th>
      <th><button className="column-sort" onClick={() => navigate({ ...data.filters, sort: "score", page: 1 })}>Совпадение <ArrowDownUp size={12} /></button></th><th>Статус</th>
      <th><button className="column-sort" onClick={() => navigate({ ...data.filters, sort: data.filters.sort === "newest" ? "oldest" : "newest", page: 1 })}>Добавлена <ArrowDownUp size={12} /></button></th><th>Действия</th>
    </tr></thead><tbody>{data.vacancies.length ? data.vacancies.map((row) => <VacancyMenu key={row.id} row={row} profileId={data.profileId} disabled={blocked} onChange={() => router.refresh()} onSkip={() => action("skip", [row.id])}><tr className={chosen.includes(row.id) ? "selected-row" : ""}>
      <td><SelectionCheckbox label={`Выбрать вакансию ${row.title}`} checked={chosen.includes(row.id)} onChange={(checked) => toggle(row.id, checked)} /></td>
      <td className="vacancy-title-cell"><a href={row.url} target="_blank" rel="noreferrer">{row.title}<ExternalLink size={12} /></a><span title={row.company}>{row.company}</span></td>
      <td className="conditions-cell"><strong>{row.salary || "Зарплата не указана"}</strong><span title={row.city ?? ""}>{row.city || "Город не указан"}</span></td>
      <td><div className="score-wrap"><span>{row.matchScore}%</span><div className="score-track"><div className="score-fill" style={{ width: row.matchScore + "%" }} /></div></div></td>
      <td><span className={"status-pill " + row.status}>{rowStatuses[row.status] ?? row.status}</span></td>
      <td className="date-cell">{new Date(row.createdAt).toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow" })}</td>
      <td><div className="row-actions"><button className="icon-button" aria-label={`Откликнуться: ${row.title}`} disabled={blocked || !resumeReady || row.status === "applied" || row.status === "skipped"} onClick={() => action("apply", [row.id])} title="Откликнуться"><Send size={15} /></button>
        <button className="icon-button" aria-label={`${row.status === "skipped" || row.status === "failed" ? "В очередь" : "Пропустить"}: ${row.title}`} disabled={blocked || row.status === "applied"} onClick={() => action(row.status === "skipped" || row.status === "failed" ? "queue" : "skip", [row.id])} title="Изменить очередь">{row.status === "skipped" || row.status === "failed" ? <RotateCcw size={15} /> : <SkipForward size={15} />}</button>
        <button className="icon-button danger-quiet" aria-label={`Удалить: ${row.title}`} disabled={blocked} onClick={() => action("delete", [row.id])} title="Удалить"><Trash2 size={15} /></button></div></td>
    </tr></VacancyMenu>) : <tr><td colSpan={7} className="empty-cell">Ничего не найдено. Измените фильтры или запустите поиск вакансий.</td></tr>}</tbody></table></div>
    <div className="pagination"><span>{data.total ? (data.page - 1) * data.filters.pageSize + 1 : 0}–{Math.min(data.page * data.filters.pageSize, data.total)} из {data.total}</span>
      <SelectField aria-label="Вакансий на странице" value={data.filters.pageSize} onValueChange={(value) => navigate({ ...data.filters, pageSize: Number(value), page: 1 })} options={[10,25,50,100].map((value) => ({value,label:`${value} на странице`}))} />
      <button className="icon-button" aria-label="Предыдущая страница вакансий" disabled={data.page === 1 || isPending} onClick={() => navigate({ ...data.filters, page: data.page - 1 })}><ChevronLeft size={17} /></button><span>{data.page} / {data.pages}</span>
      <button className="icon-button" aria-label="Следующая страница вакансий" disabled={data.page >= data.pages || isPending} onClick={() => navigate({ ...data.filters, page: data.page + 1 })}><ChevronRight size={17} /></button></div>
  </section>;
}
