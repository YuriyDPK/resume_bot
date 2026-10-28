"use client";

import { type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Clock3, Download, FileText, MessageSquare, Save, ScanText, Search } from "lucide-react";
import { ResumeMergeDialog } from "@/components/resume-merge-dialog";
import { mergeResumeFields, resumeConflicts, type ParsedResume, type ResumeMergeMode } from "@/lib/resume-parser";

export type SettingsFormValue = {
  keywords: string;
  city: string;
  minSalary: number | "";
  coverLetterTemplate: string;
  resumeText: string;
  resumeUrl: string;
  excludedWords: string;
  dailyLimit: number;
  searchLimit: number;
  searchAllRussia: boolean;
  remoteOnly: boolean;
  searchDelayMinSeconds: number;
  searchDelayMaxSeconds: number;
  applyDelayMinSeconds: number;
  applyDelayMaxSeconds: number;
};

export function SettingsForm({ initialValue, profileId }: { initialValue: SettingsFormValue; profileId: number }) {
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isImporting, startImportTransition] = useTransition();
  const [isParsing, startParseTransition] = useTransition();
  const [proposal, setProposal] = useState<{ parsed: ParsedResume; url: string } | null>(null);
  const [parseNotes, setParseNotes] = useState<string[]>([]);
  const latestValue = useRef(value);
  useEffect(() => { latestValue.current = value; }, [value]);

  function update<K extends keyof SettingsFormValue>(key: K, nextValue: SettingsFormValue[K]) {
    setDirty(true);
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...value, profileId })
      });
      const payload = await response.json().catch(() => ({}));
      setMessage(response.ok ? "Настройки сохранены" : payload.error ?? "Не удалось сохранить настройки");
      if (response.ok && payload.settings) {
        setDirty(false);
        setValue((current) => ({
          ...current,
          ...payload.settings,
          minSalary: payload.settings.minSalary ?? "",
          resumeUrl: payload.settings.resumeUrl ?? "",
          keywords: Array.isArray(payload.settings.keywords)
            ? payload.settings.keywords.map((keyword: { value: string }) => keyword.value).join("\n")
            : current.keywords
        }));
      }
      router.refresh();
    });
  }

  function importResume() {
    setMessage(null);
    startImportTransition(async () => {
      const response = await fetch("/api/resume/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeUrl: value.resumeUrl, profileId })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setMessage(payload.error ?? "Не удалось загрузить резюме");
        return;
      }

      setValue((current) => ({
        ...current,
        resumeText: payload.resumeText ?? current.resumeText,
        keywords: Array.isArray(payload.keywords) && payload.keywords.length > 0 ? payload.keywords.join("\n") : current.keywords
      }));
      setDirty(true);
      setMessage("Резюме загружено. Ваши поисковые запросы сохранены; пустой список заполняется желаемой должностью из резюме.");
      router.refresh();
    });
  }

  function applyParsed(parsed: ParsedResume, mode: ResumeMergeMode) {
    setDirty(true);
    setValue((current) => mergeResumeFields(current, parsed.fields, mode));
    setParseNotes(parsed.notes);
    setProposal(null);
    setMessage(mode === "empty" ? "Пустые поля заполнены. Существующие значения сохранены. Проверьте форму и нажмите «Сохранить»." :
      "Данные из резюме подставлены. Проверьте форму и нажмите «Сохранить».");
  }

  function parseResume() {
    const url = value.resumeUrl.trim();
    setMessage(null);
    setParseNotes([]);
    startParseTransition(async () => {
      try {
        const response = await fetch("/api/resume/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resumeUrl: url, profileId }) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.parsed) { setMessage(payload.error ?? "Не удалось разобрать резюме"); return; }
        if (latestValue.current.resumeUrl.trim() !== url) { setMessage("Ссылка изменилась во время разбора. Повторите разбор новой ссылки."); return; }
        const parsed = payload.parsed as ParsedResume;
        if (resumeConflicts(latestValue.current, parsed.fields).length) setProposal({ parsed, url });
        else applyParsed(parsed, "empty");
      } catch { setMessage("Не удалось связаться с ботом. Повторите разбор резюме."); }
    });
  }

  return (
    <form data-dirty={dirty} className="settings-form" onSubmit={submit}>
      <section className="panel settings-section" id="resume-profile"><header className="settings-section-heading"><span className="settings-section-icon"><FileText size={19} /></span><div><h2>Резюме из HH</h2><p>Загрузите профиль или заполните настройки из резюме по ссылке.</p></div><span className="section-number">01</span></header><div className="settings-section-body">
      <label className="field-group full-span">
        <span>Ссылка на резюме HH</span>
        <input value={value.resumeUrl} onChange={(event) => update("resumeUrl", event.target.value)} placeholder="https://hh.ru/resume/..." />
      </label>

      <div className="form-actions full-span compact-actions resume-import-actions">
        <button className="button secondary" type="button" disabled={isImporting || isParsing || isPending || !value.resumeUrl.trim()} onClick={importResume}>
          <Download size={17} />
          <span>Загрузить из HH</span>
        </button>
        <button className="button secondary" type="button" disabled={isImporting || isParsing || isPending || !value.resumeUrl.trim()} onClick={parseResume}>
          <ScanText size={17} /><span>{isParsing ? "Разбираю резюме…" : "Распарсить по ссылке"}</span>
        </button>
        <small className="muted-text">Должность, город, желаемая зарплата, формат работы и профиль для подбора — из резюме HH. Существующие данные заменяются только после вашего выбора.</small>
      </div>

      {parseNotes.length ? <div className="resume-parse-notes full-span" role="status"><strong>Обратите внимание</strong><ul>{parseNotes.map((note) => <li key={note}>{note}</li>)}</ul></div> : null}
      </div></section>

      <section className="panel settings-section" id="search-filters"><header className="settings-section-heading"><span className="settings-section-icon"><Search size={19} /></span><div><h2>Поиск вакансий</h2><p>Профессии, география и условия подходящей работы.</p></div><span className="section-number">02</span></header><div className="settings-section-body">

      <label className="field-group full-span">
        <span>Ключевые слова для поиска</span>
        <textarea value={value.keywords} onChange={(event) => update("keywords", event.target.value)} rows={4} placeholder={"Например: бухгалтер\nводитель категории B\nврач-терапевт"} />
        <small>Любая профессия или набор навыков. Каждый запрос — отдельный вариант поиска. Эти настройки имеют приоритет над текстом резюме.</small>
      </label>

      <label className="field-group full-span">
        <span>Слова, которых не должно быть в вакансии</span>
        <textarea
          value={value.excludedWords}
          onChange={(event) => update("excludedWords", event.target.value)}
          rows={3}
          placeholder="Например: стажер, junior, холодные звонки"
        />
        <small>Через запятую, точку с запятой или с новой строки. Проверяются название, компания и полное описание, включая формы русских слов. Запреты действуют и перед откликом.</small>
      </label>

      <div className="field-group checkbox-group full-span">
        <span>Встроенный браузер HH</span>
        <small>Вход, отклики и ручные проверки открываются прямо внутри бота. Отдельное окно браузера не требуется. Панель можно свернуть во время работы.</small>
      </div>

      <label className="field-group">
        <span>Города (через запятую)</span>
        <input
          value={value.city}
          disabled={value.searchAllRussia}
          onChange={(event) => update("city", event.target.value)}
          placeholder="Москва, Санкт-Петербург"
        />
      </label>

      <div className="field-group checkbox-group">
        <span>География</span>
        <label className="checkbox-field">
          <input type="checkbox" checked={value.searchAllRussia} onChange={(event) => update("searchAllRussia", event.target.checked)} />
          <span>Искать по всей России</span>
        </label>
      </div>

      <div className="field-group checkbox-group">
        <span>Формат работы</span>
        <label className="checkbox-field">
          <input type="checkbox" checked={value.remoteOnly} onChange={(event) => update("remoteOnly", event.target.checked)} />
          <span>Только удалённая работа</span>
        </label>
      </div>

      <label className="field-group">
        <span>Минимальная зарплата</span>
        <input
          type="number"
          min={0}
          value={value.minSalary}
          onChange={(event) => update("minSalary", event.target.value === "" ? "" : Number(event.target.value))}
        />
      </label>
      </div></section>

      <section className="panel settings-section" id="limits"><header className="settings-section-heading"><span className="settings-section-icon"><Clock3 size={19} /></span><div><h2>Лимиты и паузы</h2><p>Управляйте темпом поиска и отправки откликов.</p></div><span className="section-number">03</span></header><div className="settings-section-body">

      <label className="field-group">
        <span>Дневной лимит</span>
        <input
          type="number"
          min={1}
          value={value.dailyLimit}
          onChange={(event) => update("dailyLimit", Math.max(1, Number(event.target.value)))}
        />
      </label>

      <label className="field-group">
        <span>Сколько новых вакансий найти</span>
        <input
          type="number"
          min={1}
          max={1000}
          value={value.searchLimit}
          onChange={(event) => update("searchLimit", Math.min(1000, Math.max(1, Number(event.target.value))))}
        />
      </label>

      <label className="field-group">
        <span>Задержка поиска от, сек</span>
        <input
          type="number"
          min={0}
          value={value.searchDelayMinSeconds}
          onChange={(event) => update("searchDelayMinSeconds", Math.max(0, Number(event.target.value)))}
        />
      </label>

      <label className="field-group">
        <span>Задержка поиска до, сек</span>
        <input
          type="number"
          min={0}
          value={value.searchDelayMaxSeconds}
          onChange={(event) => update("searchDelayMaxSeconds", Math.max(0, Number(event.target.value)))}
        />
      </label>

      <label className="field-group">
        <span>Задержка отклика от, сек</span>
        <input
          type="number"
          min={0}
          value={value.applyDelayMinSeconds}
          onChange={(event) => update("applyDelayMinSeconds", Math.max(0, Number(event.target.value)))}
        />
      </label>

      <label className="field-group">
        <span>Задержка отклика до, сек</span>
        <input
          type="number"
          min={0}
          value={value.applyDelayMaxSeconds}
          onChange={(event) => update("applyDelayMaxSeconds", Math.max(0, Number(event.target.value)))}
        />
      </label>
      </div></section>

      <section className="panel settings-section" id="profile-text"><header className="settings-section-heading"><span className="settings-section-icon"><MessageSquare size={19} /></span><div><h2>Профиль и письмо</h2><p>Опыт для подбора вакансий и текст сопроводительного письма.</p></div><span className="section-number">04</span></header><div className="settings-section-body">

      <label className="field-group full-span">
        <span>Профиль резюме для подбора</span>
        <textarea aria-label="Профиль резюме для подбора" value={value.resumeText} onChange={(event) => update("resumeText", event.target.value)} rows={7} placeholder={"Желаемая должность: ваша профессия\nОпыт, навыки и пожелания к работе"} />
      </label>

      <label className="field-group full-span">
        <span>Шаблон сопроводительного письма</span>
        <textarea value={value.coverLetterTemplate} onChange={(event) => update("coverLetterTemplate", event.target.value)} rows={6} />
      </label>
      </div></section>

      <div className="form-actions full-span settings-save-bar">
        <button className="button primary" disabled={isPending || isImporting || isParsing}>
          <Save size={17} />
          <span>Сохранить</span>
        </button>
        {message ? <span className="muted-text" role="status">{message}</span> : null}
      </div>
      {proposal ? <ResumeMergeDialog parsed={proposal.parsed} current={value} onChoose={(mode) => {
        if (value.resumeUrl.trim() !== proposal.url) { setProposal(null); setMessage("Ссылка изменилась. Повторите разбор."); return; }
        applyParsed(proposal.parsed, mode);
      }} onCancel={() => { setProposal(null); setMessage("Разбор отменён. Данные в форме не изменены."); }} /> : null}
    </form>
  );
}
