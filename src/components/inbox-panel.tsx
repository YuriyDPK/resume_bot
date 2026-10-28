"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, ChevronLeft, ChevronRight, ExternalLink, Inbox, MessageSquare, RefreshCw, Search, XCircle } from "lucide-react";
import { SelectField } from "@/components/select-field";
import type { InboxData } from "@/lib/inbox-store";
import type { RunnerState } from "@/lib/hh/runner";

const outcomes = { all: "Все ответы", positive: "Положительные", negative: "Отрицательные", neutral: "Переписка и ожидание" };
export function InboxPanel({ data, initialState }: { data: InboxData; initialState: RunnerState }) {
  const router = useRouter();
  const [draft, setDraft] = useState(data.filters);
  const [state, setState] = useState(initialState);
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const conversation = data.conversations.find((row) => row.id === selected) ?? data.conversations[0];
  function navigate(filters: typeof data.filters) {
    const params = new URLSearchParams(Object.entries(filters).map(([key, value]) => [key, String(value)]));
    startTransition(() => router.push("/inbox?" + params));
  }
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let previousRunning = initialState.running;
    async function poll() {
      try {
        const response = await fetch("/api/auto-apply", { cache: "no-store", signal: controller.signal });
        if (response.ok) {
          const next: RunnerState = (await response.json()).state;
          setState(next);
          if ((next.running && next.mode === "inbox") || (previousRunning && !next.running)) router.refresh();
          previousRunning = next.running;
        }
      } catch { /* Keep the last saved snapshot available. */ }
      if (!controller.signal.aborted) timer = setTimeout(poll, 2500);
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [router, initialState.running]);
  async function sync() {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/inbox", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profileId: data.profileId }) });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error);
        setState(payload.state);
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось обновить ответы"); }
    });
  }
  return <>
    <div className="inbox-toolbar"><div><p className="muted-text">Ответы и переписка текущего HH-аккаунта. Сообщения здесь доступны для чтения.</p>{state.running && <p className="notice-line"><span className="live-dot running" />{state.message}</p>}</div><button className="button primary" disabled={pending || state.running || !data.accountConnected} onClick={() => void sync()}><RefreshCw size={16} />Обновить из HH</button></div>
    {!data.accountConnected && <p className="notice-line">Войдите в HH на вкладке «Обзор», затем загрузите свои ответы.</p>}
    {error && <p className="inline-error" role="alert">{error}</p>}{state.mode === "idle" && state.lastError && <p className="inline-error" role="alert">{state.lastError}</p>}
    <div className="inbox-metrics">{[{key:"all",label:"Всего",value:data.stats.all,icon:Inbox},{key:"positive",label:"Положительные",value:data.stats.positive,icon:CheckCircle2},{key:"negative",label:"Отрицательные",value:data.stats.negative,icon:XCircle},{key:"unread",label:"Непрочитанные в HH",value:data.stats.unread,icon:MessageSquare}].map(({key,label,value,icon:Icon}) => <button key={key} className={"inbox-stat " + key} onClick={() => navigate({...data.filters,outcome:key === "unread" ? "all" : key,unread:key === "unread" ? "unread" : "all",page:1})}><Icon size={18} /><span>{label}</span><strong>{value}</strong></button>)}</div>
    <section className="panel inbox-panel"><form className="list-filters inbox-filters" onSubmit={(event) => { event.preventDefault(); navigate({...draft,page:1}); }}>
      <label className="search-field"><Search size={16} /><input aria-label="Поиск ответов" placeholder="Компания, вакансия или сообщение" value={draft.q} onChange={(event) => setDraft({...draft,q:event.target.value})} /></label>
      <SelectField aria-label="Тип ответа" value={draft.outcome} onValueChange={(outcome) => setDraft({...draft,outcome})} options={Object.entries(outcomes).map(([value,label]) => ({value,label}))} />
      <SelectField aria-label="Резюме в ответах" value={draft.scope} onValueChange={(scope) => setDraft({...draft,scope})} options={[{value:"account",label:"Весь мой HH-аккаунт"},{value:"profile",label:"Текущее резюме"}]} />
      <SelectField aria-label="Прочитанность ответа" value={draft.unread} onValueChange={(unread) => setDraft({...draft,unread})} options={[{value:"all",label:"Любая прочитанность"},{value:"unread",label:"Непрочитанные в HH"},{value:"read",label:"Прочитанные в HH"}]} />
      <SelectField aria-label="Сортировка ответов" value={draft.sort} onValueChange={(sort) => setDraft({...draft,sort})} options={[{value:"newest",label:"Сначала новые"},{value:"oldest",label:"Сначала старые"}]} />
      <SelectField aria-label="Период синхронизации ответов" value={draft.period} onValueChange={(value) => setDraft({...draft,period:value as typeof draft.period})} options={[{value:"all",label:"Все загрузки"},{value:"today",label:"Загружены сегодня"},{value:"week",label:"Загружены за 7 дней"},{value:"month",label:"Загружены за 30 дней"}]} />
      <button className="button secondary" type="submit">Показать</button>
    </form><p className="inbox-help">Приглашения и отказы определяются по статусу HH; явно выраженные ответы — по тексту. Остальная переписка остаётся без оценки. Обновление может отметить открытые чаты прочитанными в HH.</p>
      <div className="inbox-split"><div className="conversation-list" aria-label="Список ответов">{data.conversations.length ? data.conversations.map((row) => <button className={conversation?.id === row.id ? "conversation-card active" : "conversation-card"} key={row.id} onClick={() => setSelected(row.id)}>
        <div><strong>{row.company || "Работодатель"}</strong>{row.unread && <span className="unread-dot" />}</div><span className="conversation-vacancy">{row.vacancyTitle}</span><p>{row.lastMessage || row.statusLabel || "Текст сообщения пока не загружен"}</p><footer><span className={"status-pill reply-"+row.outcome}>{outcomes[row.outcome as keyof typeof outcomes] ?? row.outcome}</span><small>{row.lastMessageAt ? new Date(row.lastMessageAt).toLocaleDateString("ru-RU") : "Дата HH не указана"}</small></footer>
      </button>) : <div className="empty-state"><Inbox size={28} /><p>{data.stats.all ? "Ответов по этим фильтрам нет" : "Ответы ещё не загружены"}</p><small>Нажмите «Обновить из HH» или измените фильтры.</small></div>}</div>
      <article className="conversation-detail">{conversation ? <><header><div><p className="eyebrow">{conversation.company || "HH"}</p><h2>{conversation.vacancyTitle}</h2><p className="muted-text">{conversation.statusLabel || "Переписка"}</p></div><a href={conversation.hhUrl} target="_blank" rel="noreferrer" className="button secondary small"><ExternalLink size={14} />Открыть HH</a></header>
        <div className="chat-messages">{conversation.messages.length ? conversation.messages.map((message) => <div className={"chat-message " + message.author} key={message.id}><small>{message.author === "applicant" ? <><ArrowUpRight size={12} />Вы</> : message.author === "employer" ? <><ArrowDownLeft size={12} />Работодатель</> : "Сообщение HH"}</small><p>{message.text}</p>{message.at && <time>{new Date(message.at).toLocaleString("ru-RU")}</time>}</div>) : <div className="empty-state"><MessageSquare size={25} /><p>{conversation.statusLabel || "HH не показал текст переписки"}</p><a href={conversation.hhUrl} target="_blank" rel="noreferrer">Открыть переписку в HH</a></div>}</div>
        <footer className="conversation-footer">Синхронизировано {new Date(conversation.syncedAt).toLocaleString("ru-RU")}{conversation.vacancyUrl && <a href={conversation.vacancyUrl} target="_blank" rel="noreferrer">Вакансия <ExternalLink size={12} /></a>}</footer>
      </> : <div className="empty-state">Выберите ответ, чтобы прочитать переписку.</div>}</article></div>
      <div className="pagination"><span>{data.total} ответов · {data.filters.page} / {data.pages}</span><button className="icon-button" aria-label="Предыдущая страница ответов" disabled={pending || data.filters.page <= 1} onClick={() => navigate({...data.filters,page:data.filters.page-1})}><ChevronLeft size={16} /></button><button className="icon-button" aria-label="Следующая страница ответов" disabled={pending || data.filters.page >= data.pages} onClick={() => navigate({...data.filters,page:data.filters.page+1})}><ChevronRight size={16} /></button></div>
    </section>
  </>;
}
