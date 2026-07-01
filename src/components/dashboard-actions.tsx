"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, RefreshCw, Search, Square } from "lucide-react";
import type { RunnerState } from "@/lib/hh/runner";

export function DashboardActions({ initialState }: { initialState: RunnerState }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const timer = window.setInterval(async () => {
      const response = await fetch("/api/auto-apply", { cache: "no-store" });
      const payload = await response.json();
      if (payload.state) setState(payload.state);
      router.refresh();
    }, 5000);

    return () => window.clearInterval(timer);
  }, [router]);

  async function run(endpoint: string, body?: unknown) {
    setError(null);
    startTransition(async () => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const payload = await response.json();
      if (!response.ok) setError(payload.error ?? "Ошибка запуска");
      if (payload.state) setState(payload.state);
      router.refresh();
    });
  }

  return (
    <div className="action-cluster">
      <button className="button secondary" onClick={() => run("/api/auth/hh")} disabled={state.running || isPending}>
        <KeyRound size={17} />
        <span>Войти в HH</span>
      </button>
      <button className="button primary" onClick={() => run("/api/search")} disabled={state.running || isPending}>
        <Search size={17} />
        <span>Запустить поиск</span>
      </button>
      <button className="icon-button" onClick={() => run("/api/auto-apply", { action: "stop" })} disabled={!state.running} title="Stop">
        {state.running ? <Square size={17} /> : <RefreshCw size={17} />}
      </button>
      <div className="runner-state" aria-live="polite">
        <span className={state.running ? "live-dot running" : "live-dot"} />
        <span>{state.message}</span>
      </div>
      {error ? <p className="inline-error">{error}</p> : null}
    </div>
  );
}
