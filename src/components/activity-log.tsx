"use client";
import { SelectField } from "@/components/select-field";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ListFilter, Search, Trash2 } from "lucide-react";
import { SelectionCheckbox } from "@/components/selection-checkbox";
import type { LogFilters, LogList } from "@/lib/log-query";

const levels: Record<string, string> = { info: "Информация", warn: "Внимание", error: "Ошибка" };
function params(filters: LogFilters) { return new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)])); }

export function ActivityLog({ initialData }: { initialData: LogList }) {
  const [data, setData] = useState(initialData);
  const [draft, setDraft] = useState(initialData.filters);
  const [query, setQuery] = useState(params(initialData.filters).toString());
  const [selected, setSelected] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const id = ++sequence.current;
    try {
      const response = await fetch("/api/logs?" + query, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Не удалось загрузить логи");
      const payload = await response.json();
      if (!signal?.aborted && id === sequence.current) setData(payload);
    } catch { if (!signal?.aborted) setMessage("Не удалось обновить логи"); }
    finally { if (!signal?.aborted && id === sequence.current) setLoading(false); }
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() { await load(controller.signal); if (!controller.signal.aborted) timer = setTimeout(poll, 5000); }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [load]);
  const ids = data.logs.map((log) => log.id), chosen = selected.filter((id) => ids.includes(id));
  async function remove(allMatching = false) {
    if (busy || loading) return;
    const count = allMatching ? data.total : chosen.length;
    const scope = allMatching ? `\nУровень: ${levels[data.filters.level] ?? "Все"}. Поиск: ${data.filters.q || "не задан"}. Период: ${data.filters.period}.` : "";
    if (!count || !window.confirm(`Удалить записи логов (${count})${allMatching ? " по текущим фильтрам" : " из выбранного"}?${scope}`)) return;
    setBusy(true); setMessage(null);
    try {
      const response = await fetch("/api/logs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(allMatching ? { allMatching: true, filters: data.filters, profileId: data.profileId } : { ids: chosen, profileId: data.profileId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось удалить записи");
      setMessage(`Удалено записей: ${result.deleted}`); setSelected([]); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Не удалось удалить записи"); }
    finally { setBusy(false); }
  }
  function page(next: number) { setSelected([]); setLoading(true); setQuery(params({ ...data.filters, page: next }).toString()); }
  return <section id="activity" className="panel activity-panel">
    <div className="section-heading"><div><p className="eyebrow">История работы</p><h2>События <span className="count-badge">{data.total}</span></h2></div><ListFilter size={19} /></div>
    <form className="list-filters log-filters" onSubmit={(event) => { event.preventDefault(); setSelected([]); setLoading(true); const next = params({ ...draft, page: 1 }).toString(); if (next === query) void load(); else setQuery(next); }}>
      <label className="search-field"><Search size={16} /><input aria-label="Поиск по логам" placeholder="Найти событие" value={draft.q} onChange={(event) => setDraft({ ...draft, q: event.target.value })} /></label>
      <SelectField aria-label="Уровень логов" value={draft.level} onValueChange={(value) => setDraft({ ...draft, level: value as LogFilters["level"] })} options={[{ value: "all", label: "Все уровни" }, ...Object.entries(levels).map(([value,label]) => ({value,label}))]} />
      <SelectField aria-label="Порядок логов" value={draft.sort} onValueChange={(value) => setDraft({ ...draft, sort: value as LogFilters["sort"] })} options={[{value:"desc",label:"Сначала новые"},{value:"asc",label:"Сначала старые"}]} />
      <SelectField aria-label="Период логов" value={draft.period} onValueChange={(value) => setDraft({ ...draft, period: value as LogFilters["period"] })} options={[{value:"all",label:"Всё время"},{value:"today",label:"Сегодня"},{value:"week",label:"7 дней"},{value:"month",label:"30 дней"}]} />
      <button className="button secondary" type="submit">Показать</button>
    </form>
    <div className="log-selection"><SelectionCheckbox label="Выбрать все логи на странице" checked={ids.length > 0 && chosen.length === ids.length} mixed={chosen.length > 0 && chosen.length < ids.length} onChange={(checked) => setSelected(checked ? ids : [])} /><span>{chosen.length ? `Выбрано ${chosen.length}` : "Выбор на странице"}</span>
      <button className="text-button danger-text" disabled={!chosen.length || busy || loading} onClick={() => void remove()}><Trash2 size={14} />Удалить выбранные</button>
      <button className="text-button danger-text" disabled={!data.total || busy || loading} onClick={() => void remove(true)}>Очистить по фильтрам</button></div>
    {message && <p className="notice-line" role="status">{message}</p>}
    <div className="activity-list">{data.logs.length ? data.logs.map((log) => <article className="activity-row" key={log.id}>
      <SelectionCheckbox label={`Выбрать лог ${log.id}`} checked={chosen.includes(log.id)} onChange={(checked) => setSelected((current) => checked ? [...current, log.id] : current.filter((id) => id !== log.id))} />
      <span className={"status-pill " + log.level}>{levels[log.level] ?? log.level}</span><div className="activity-message"><span>{log.message}</span>{log.meta && <details><summary>Подробности</summary><pre>{log.meta}</pre></details>}</div>
      <time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
    </article>) : <p className="empty-state">Событий по выбранным фильтрам нет.</p>}</div>
    <div className="pagination"><span>Страница {data.page} из {data.pages}</span><button className="icon-button" aria-label="Предыдущая страница логов" disabled={data.page <= 1} onClick={() => page(data.page - 1)}><ChevronLeft size={16} /></button><button className="icon-button" aria-label="Следующая страница логов" disabled={data.page >= data.pages} onClick={() => page(data.page + 1)}><ChevronRight size={16} /></button></div>
  </section>;
}
