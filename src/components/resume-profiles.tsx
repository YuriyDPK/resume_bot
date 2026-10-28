"use client";
import { SelectField } from "@/components/select-field";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { FileUser, Plus, X } from "lucide-react";

type Profile = { id: number; name: string; resumeUrl: string | null };
type Profiles = { activeId: number; profiles: Profile[]; busy?: boolean; accountConnected?: boolean };

export function ResumeProfiles() {
  const pathname = usePathname();
  const [data, setData] = useState<Profiles | null>(null);
  const [mode, setMode] = useState<"create" | null>(null);
  const [url, setUrl] = useState("");
  const [copy, setCopy] = useState(false);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const initialId = useRef<number | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch("/api/profiles", { cache: "no-store", signal: controller.signal });
        if (response.ok && !busy.current) {
          const next: Profiles = await response.json();
          if (initialId.current !== undefined && initialId.current !== next.activeId) {
            // A different tab changed the shared queue. Keep unsaved edits intact;
            // mutation APIs also reject this stale profile id.
            if (!document.querySelector('form[data-dirty="true"]')) { window.location.replace(pathname); return; }
            setError("Резюме переключено в другой вкладке. Скопируйте несохранённые правки и обновите страницу.");
          } else { initialId.current = next.activeId; setData(next); }
        }
      } catch { /* The existing profile remains usable during a brief connection loss. */ }
      if (!controller.signal.aborted) timer = setTimeout(poll, 4000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pathname]);

  function openSettings() {
    // A profile change must discard the previous document's selections,
    // cached routes and polling. router.refresh intentionally preserves state.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/settings");
  }

  function canLeave() {
    return !document.querySelector('form[data-dirty="true"]') || window.confirm("В настройках есть несохранённые изменения. Переключить резюме и не сохранять их?");
  }

  async function switchTo(id: number) {
    if (!data || id === data.activeId || !canLeave()) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const response = await fetch("/api/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "switch", id, profileId: data.activeId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      window.location.assign(pathname);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось переключить резюме"); busy.current = false; setPending(false); }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!data || !mode || (mode === "create" && !canLeave())) return;
    busy.current = true; setPending(true); setError(null); setMessage(null);
    try {
      const response = await fetch("/api/profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: mode, resumeUrl: url.trim(), copySettings: copy, profileId: data.activeId }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      if (mode === "create") setCreatedId(payload.activeId);
      window.location.assign(mode === "create" ? "/settings" : pathname);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Не удалось сохранить резюме");
      setMessage("Если резюме уже добавлено, оно сохранено. Разбор можно повторить в его настройках.");
      const response = await fetch("/api/profiles").catch(() => null);
      if (response?.ok) {
        const next: Profiles = await response.json();
        initialId.current = next.activeId;
        setData(next);
      }
      busy.current = false;
      setPending(false);
    }
  }

  return <div className="resume-switcher">
    <div className="resume-switcher-heading"><FileUser size={15} /><span>Рабочее резюме</span></div>
    <SelectField className="profile-select" aria-label="Рабочее резюме" value={data?.activeId ?? ""} placeholder="Загрузка…" disabled={!data || data.busy || pending} onValueChange={(value) => void switchTo(Number(value))} options={data?.profiles.map((profile) => ({value:profile.id,label:profile.name})) ?? []} />
    <button className="resume-add" type="button" disabled={!data || !data.accountConnected || data.busy || pending} title={data?.accountConnected ? "Добавить своё резюме" : "Сначала войдите в HH"} onClick={() => { setCreatedId(null); setMode("create"); setUrl(""); setCopy(false); setError(null); setMessage(null); }}><Plus size={14} />Добавить резюме</button>
    <p>{data?.busy ? "Смена доступна после завершения процесса" : !data?.accountConnected ? "Войдите в HH, чтобы добавить резюме" : "Свои настройки, вакансии и статистика"}</p>
    {!mode && error && <p className="profile-error" role="alert">{error}</p>}
    {mode && createPortal(<div className="modal-backdrop"><section className="panel profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title"><header><div><p className="eyebrow">Профили поиска</p><h2 id="profile-dialog-title">Добавить резюме</h2></div><button type="button" className="icon-button" aria-label="Закрыть" disabled={pending} onClick={() => createdId ? openSettings() : setMode(null)}><X size={18} /></button></header>
      <p className="muted-text">У каждого резюме свои настройки поиска, сопроводительное письмо, очередь вакансий, логи и статистика. Вход в HH общий.</p>
      <form onSubmit={submit}>
        <small className="muted-text">Подходит только резюме из раздела «Мои резюме» текущего HH-аккаунта.</small>
        <label className="field-group"><span>Ссылка на резюме HH</span><input autoFocus required type="url" value={url} disabled={pending || Boolean(createdId)} placeholder="https://hh.ru/resume/..." onChange={(event) => setUrl(event.target.value)} /></label>
        <small className="muted-text">Название, должность, город, зарплата, формат работы и профиль для подбора заполнятся из резюме HH.</small>
        <label className="checkbox-field"><input type="checkbox" checked={copy} disabled={pending || Boolean(createdId)} onChange={(event) => setCopy(event.target.checked)} /><span>Скопировать фильтры и лимиты текущего резюме</span></label>
        <small className="muted-text">Скопированные поля уточняются данными из резюме. История и текст другого резюме не копируются.</small>
        {message && <p role="status" className="muted-text">{message}</p>}{error && <p className="inline-error" role="alert">{error}</p>}
        <div className="form-actions"><button type={createdId && !pending ? "button" : "submit"} onClick={createdId && !pending ? openSettings : undefined} className="button primary" disabled={pending || !url.trim()}>{pending ? "Подождите…" : createdId ? "Открыть настройки профиля" : "Добавить и разобрать"}</button><button type="button" className="button secondary" disabled={pending} onClick={() => createdId ? openSettings() : setMode(null)}>Отмена</button></div>
      </form></section></div>, document.body)}
  </div>;
}
