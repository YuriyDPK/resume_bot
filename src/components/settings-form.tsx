"use client";

import { type FormEvent, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Save } from "lucide-react";

export type SettingsFormValue = {
  keywords: string;
  city: string;
  minSalary: number | "";
  coverLetterTemplate: string;
  resumeText: string;
  resumeUrl: string;
  dailyLimit: number;
  applyDelayMinSeconds: number;
  applyDelayMaxSeconds: number;
};

export function SettingsForm({ initialValue }: { initialValue: SettingsFormValue }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isImporting, startImportTransition] = useTransition();

  function update<K extends keyof SettingsFormValue>(key: K, nextValue: SettingsFormValue[K]) {
    setValue((current) => ({ ...current, [key]: nextValue }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value)
      });
      const payload = await response.json().catch(() => ({}));
      setMessage(response.ok ? "Настройки сохранены" : payload.error ?? "Не удалось сохранить настройки");
      router.refresh();
    });
  }

  function importResume() {
    setMessage(null);
    startImportTransition(async () => {
      const response = await fetch("/api/resume/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resumeUrl: value.resumeUrl })
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
      setMessage("Резюме загружено из HH, ключевые слова обновлены");
      router.refresh();
    });
  }

  return (
    <form className="panel settings-form" onSubmit={submit}>
      <label className="field-group full-span">
        <span>Ссылка на резюме HH</span>
        <input value={value.resumeUrl} onChange={(event) => update("resumeUrl", event.target.value)} placeholder="https://hh.ru/resume/..." />
      </label>

      <div className="form-actions full-span compact-actions">
        <button className="button secondary" type="button" disabled={isImporting || isPending || !value.resumeUrl.trim()} onClick={importResume}>
          <Download size={17} />
          <span>Загрузить из HH</span>
        </button>
      </div>

      <label className="field-group full-span">
        <span>Ключевые слова для поиска</span>
        <textarea value={value.keywords} onChange={(event) => update("keywords", event.target.value)} rows={4} />
      </label>

      <label className="field-group">
        <span>Город</span>
        <input value={value.city} onChange={(event) => update("city", event.target.value)} />
      </label>

      <label className="field-group">
        <span>Минимальная зарплата</span>
        <input
          type="number"
          min={0}
          value={value.minSalary}
          onChange={(event) => update("minSalary", event.target.value === "" ? "" : Number(event.target.value))}
        />
      </label>

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

      <label className="field-group full-span">
        <span>Профиль резюме для подбора</span>
        <textarea value={value.resumeText} onChange={(event) => update("resumeText", event.target.value)} rows={6} />
      </label>

      <label className="field-group full-span">
        <span>Шаблон сопроводительного письма</span>
        <textarea value={value.coverLetterTemplate} onChange={(event) => update("coverLetterTemplate", event.target.value)} rows={6} />
      </label>

      <div className="form-actions full-span">
        <button className="button primary" disabled={isPending || isImporting}>
          <Save size={17} />
          <span>Сохранить</span>
        </button>
        {message ? <span className="muted-text">{message}</span> : null}
      </div>
    </form>
  );
}
