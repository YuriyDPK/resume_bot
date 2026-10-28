"use client";

import { useEffect, useState, useTransition } from "react";
import { Play, Send, Square } from "lucide-react";
import type { RunnerState } from "@/lib/hh/runner";

export function AutoApplyPanel({ initialState, profileId, canApply }: { initialState: RunnerState; profileId: number; canApply: boolean }) {
  const [countInput, setCountInput] = useState("5");
  const limit = Math.max(1, Math.min(1000, Number(countInput) || 1));
  const validCount = countInput.trim() !== "" && Number.isInteger(Number(countInput)) && Number(countInput) >= 1 && Number(countInput) <= 1000;
  const [skipAdditionalRequirements, setSkipAdditionalRequirements] = useState(initialState.skipAdditionalRequirements ?? false);
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const response = await fetch("/api/auto-apply", { cache: "no-store" });
      const payload = await response.json();
      if (payload.state) setState(payload.state);
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  function submit(action: "start" | "stop") {
    setError(null);
    startTransition(async () => {
      const response = await fetch("/api/auto-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, limit, skipAdditionalRequirements, profileId })
      });
      const payload = await response.json();
      if (!response.ok) setError(payload.error ?? "Не удалось выполнить действие");
      if (payload.state) setState(payload.state);
    });
  }

  const progress = state.target > 0 ? Math.round((state.processed / state.target) * 100) : 0;

  return (
    <section className="panel control-panel apply-launch-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Управление очередью</p>
          <h2>Новый запуск</h2>
          <p className="section-description">Выберите количество новых откликов. Уже отправленные и пропуски не учитываются. Дневной лимит из настроек также действует.</p>
        </div>
        <span className="launch-icon"><Send size={22} /></span>
      </div>

      <div className="amount-picker">
        <div className="amount-heading"><div><label htmlFor="apply-count">Количество откликов</label><small>От 1 до 1 000 за запуск</small></div><div className="amount-input">
          <input
            id="apply-count" aria-label="Количество откликов"
            type="number"
            min={1}
            max={1000}
            value={countInput}
            disabled={state.running || isPending}
            onChange={(event) => setCountInput(event.target.value)} onBlur={() => setCountInput(String(limit))}
          />
          <span>откликов</span></div></div>
        <input className="count-range" type="range" aria-label="Количество откликов ползунком" min={1} max={1000} step={1} value={limit} disabled={state.running || isPending} onChange={(event) => setCountInput(event.target.value)} style={{ background: `linear-gradient(to right, var(--blue) ${(limit - 1) / 999 * 100}%, #e6eaf0 ${(limit - 1) / 999 * 100}%)` }} />
        <div className="range-labels"><span>1</span><span>1 000</span></div>
        <div className="count-presets">{[5, 10, 25, 50, 100].map((count) => <button key={count} type="button" className={limit === count ? "selected" : ""} disabled={state.running || isPending} onClick={() => setCountInput(String(count))}>{count}</button>)}<span>или введите своё число</span></div>
      </div>

      <div className="field-group apply-policy">
        <label className="checkbox-field">
          <input type="checkbox" checked={state.running && state.mode === "auto" ? state.skipAdditionalRequirements ?? false : skipAdditionalRequirements}
            aria-label="Пропускать вакансии с дополнительными требованиями"
            disabled={state.running || isPending} onChange={(event) => setSkipAdditionalRequirements(event.target.checked)} />
          <span>Пропускать вакансии с дополнительными требованиями</span>
        </label>
        <small className="muted-text">Включено — вопросы работодателя и дополнительные условия пропускаются. Выключено — очередь ждёт ручного действия. CAPTCHA всегда ставит очередь на паузу.</small>
      </div>

      <div className="runner-card apply-progress">
        <div>
          <span className={state.running ? "live-dot running" : "live-dot"} />
          <strong>{state.message}</strong><span className="progress-percent">{Math.min(100, progress)}%</span>
        </div>
        <div className="progress-line" aria-hidden="true">
          <span style={{ width: progress + "%" }} />
        </div>
        <small>
          {state.processed} / {state.target || limit}
        </small>
      </div>

      {!canApply && <p className="notice-line">Для откликов войдите в HH и добавьте своё резюме в настройках.</p>}
      {error ? <p className="inline-error">{error}</p> : null}

      <div className="form-actions">
        <button className="button primary" disabled={state.running || isPending || !validCount || !canApply} onClick={() => submit("start")}>
          <Play size={17} />
          <span>Start</span>
        </button>
        <button className="button secondary" disabled={!state.running || isPending} onClick={() => submit("stop")}>
          <Square size={17} />
          <span>Stop</span>
        </button>
      </div>
    </section>
  );
}
