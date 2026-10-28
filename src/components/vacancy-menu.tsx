"use client";

import { useState, type ReactNode } from "react";
import { ContextMenu, Popover } from "radix-ui";
import { Ban, ExternalLink, SkipForward, X } from "lucide-react";

export function VacancyMenu({ children, row, profileId, disabled, onChange, onSkip }: {
  children: ReactNode; row: { id: number; title: string; url: string }; profileId: number; disabled: boolean;
  onChange: () => void; onSkip: () => void;
}) {
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [words, setWords] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function edit() {
    setError(null); setOpen(true); setBusy(true);
    try {
      const response = await fetch("/api/settings/exclusions?profileId=" + profileId, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setWords(payload.words);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось загрузить фильтры"); }
    finally { setBusy(false); }
  }
  async function save(action: "add" | "remove", phrase: string) {
    if (!phrase.trim() || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/settings/exclusions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, word: phrase, profileId, ...(action === "add" ? { vacancyId: row.id } : {}) }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setWords(payload.words); setWord(""); onChange();
      if (action === "add") setOpen(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось сохранить фильтр"); }
    finally { setBusy(false); }
  }
  return <>
    <ContextMenu.Root modal={false}><ContextMenu.Trigger asChild onContextMenu={(event) => {
      setPoint({ x: event.clientX, y: event.clientY });
      const selected = window.getSelection()?.toString().trim() ?? "";
      setWord(selected.length <= 150 ? selected : "");
    }}>{children}</ContextMenu.Trigger><ContextMenu.Portal><ContextMenu.Content className="context-content" collisionPadding={10}>
      <ContextMenu.Label className="context-label">Вакансия</ContextMenu.Label>
      <ContextMenu.Item className="context-item" disabled={disabled} onSelect={() => void edit()}><Ban size={15} />Не интересует…</ContextMenu.Item>
      <ContextMenu.Item className="context-item" disabled={disabled} onSelect={onSkip}><SkipForward size={15} />Пропустить вакансию</ContextMenu.Item>
      <ContextMenu.Separator className="context-separator" />
      <ContextMenu.Item className="context-item" asChild><a href={row.url} target="_blank" rel="noreferrer"><ExternalLink size={15} />Открыть в HH</a></ContextMenu.Item>
    </ContextMenu.Content></ContextMenu.Portal></ContextMenu.Root>
    <Popover.Root open={open} onOpenChange={setOpen} modal={false}><Popover.Anchor virtualRef={{ current: { getBoundingClientRect: () => new DOMRect(point.x, point.y, 1, 1) } }} />
      <Popover.Portal><Popover.Content className="exclusion-popover" side="bottom" align="start" sideOffset={5} collisionPadding={12} onCloseAutoFocus={(event) => event.preventDefault()}>
        <header><div><strong>Не интересует</strong><small>Стоп-фраза для этого резюме</small></div><Popover.Close className="icon-button" aria-label="Закрыть фильтр"><X size={15} /></Popover.Close></header>
        <p className="exclusion-vacancy">{row.title}</p><p className="muted-text">Введите только нежелательное слово или часть названия. Всю вакансию добавлять не нужно.</p>
        <form onSubmit={(event) => { event.preventDefault(); void save("add", word); }}><label className="field-group"><span>Слово или фраза</span><div className="clearable-input"><input aria-label="Нежелательное слово или фраза" maxLength={150} value={word} placeholder="Например, стажёр" onChange={(event) => setWord(event.target.value)} disabled={busy} /><button type="button" className="icon-button" aria-label="Очистить стоп-фразу" onClick={() => setWord("")} disabled={!word || busy}><X size={14} /></button></div></label>
          <button className="button primary" type="submit" disabled={busy || !word.trim()}>Добавить и пропустить</button></form>
        {words.length > 0 && <div className="exclusion-current"><small>Уже исключены</small><div className="filter-chips">{words.map((phrase) => <span className="exclusion-chip" key={phrase}><button type="button" onClick={() => setWord(phrase)} title="Подставить в поле">{phrase}</button><button type="button" disabled={busy} aria-label={"Удалить стоп-фразу " + phrase} onClick={() => void save("remove", phrase)}><X size={12} /></button></span>)}</div></div>}
        {error && <p className="inline-error" role="alert">{error}</p>}
      </Popover.Content></Popover.Portal>
    </Popover.Root>
  </>;
}
