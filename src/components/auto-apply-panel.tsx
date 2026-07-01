"use client";

import { useEffect, useState, useTransition } from "react";
import { Play, ShieldAlert, Square } from "lucide-react";
import type { RunnerState } from "@/lib/hh/runner";

const limits = [5, 10, 20];

export function AutoApplyPanel({ initialState }: { initialState: RunnerState }) {
  const [limit, setLimit] = useState(5);
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
        body: JSON.stringify({ action, limit })
      });
      const payload = await response.json();
      if (!response.ok) setError(payload.error ?? "Не удалось выполнить действие");
      if (payload.state) setState(payload.state);
    });
  }

  const progress = state.target > 0 ? Math.round((state.processed / state.target) * 100) : 0;

  return (
    <section className="panel control-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Manual launch only</p>
          <h2>Автоотклики по найденным вакансиям</h2>
        </div>
        <ShieldAlert size={20} />
      </div>

      <div className="control-grid single-control">
        <label className="field-group">
          <span>Количество откликов</span>
          <div className="segmented-control">
            {limits.map((value) => (
              <button key={value} className={limit === value ? "selected" : ""} onClick={() => setLimit(value)} type="button">
                {value}
              </button>
            ))}
          </div>
        </label>
      </div>

      <div className="runner-card">
        <div>
          <span className={state.running ? "live-dot running" : "live-dot"} />
          <strong>{state.message}</strong>
        </div>
        <div className="progress-line" aria-hidden="true">
          <span style={{ width: progress + "%" }} />
        </div>
        <small>
          {state.processed} / {state.target || limit}
        </small>
      </div>

      {error ? <p className="inline-error">{error}</p> : null}

      <div className="form-actions">
        <button className="button primary" disabled={state.running || isPending} onClick={() => submit("start")}>
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
