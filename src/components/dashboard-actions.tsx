"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut, RefreshCw, Search, Square, UserRound } from "lucide-react";
import type { RunnerState } from "@/lib/hh/runner";
import type { HHAccount } from "@/lib/hh/account";

export function DashboardActions({ initialState, initialAccount, profileId }: { initialState: RunnerState; initialAccount: HHAccount; profileId: number }) {
  const router = useRouter();
  const [state, setState] = useState(initialState);
  const [account, setAccount] = useState(initialAccount);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let previous = "";
    async function poll() {
      await Promise.allSettled([
        fetch("/api/auto-apply", { cache: "no-store", signal: controller.signal }).then(async (response) => { if (response.ok) {
          const next = (await response.json()).state;
          setState(next);
          const key = JSON.stringify([next.running, next.processed, next.message]);
          if (next.running || (previous && previous !== key)) router.refresh();
          previous = key;
        } }),
        fetch("/api/auth/hh", { cache: "no-store", signal: controller.signal }).then(async (response) => { if (response.ok) setAccount((await response.json()).account); })
      ]);
      if (!controller.signal.aborted) timer = setTimeout(poll, 5000);
    }
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [router]);
  function run(endpoint: string, body?: Record<string, unknown>, method = "POST") {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify({ ...body, profileId }) : undefined });
        const payload = await response.json();
        if (!response.ok) { setError(payload.error ?? "Не удалось выполнить действие"); return; }
        if (payload.state) setState(payload.state);
        if (method === "DELETE") setAccount({ ...account, status: "disconnected", name: "" });
        router.refresh();
      } catch { setError("Не удалось связаться с ботом"); }
    });
  }
  return <div className="dashboard-actions">
    <div className="action-cluster">
      {account.status === "connected" ? <div className="account-chip"><span className="account-avatar"><UserRound size={18} /></span><a href={account.profileUrl} target="_blank" rel="noreferrer"><strong>{account.name || "Аккаунт HH"}</strong><small>Вход выполнен</small></a>
        <button className="icon-button danger-quiet" title="Выйти из HH" aria-label="Выйти из HH" disabled={state.running || isPending} onClick={() => run("/api/auth/hh", undefined, "DELETE")}><LogOut size={16} /></button></div> :
        <button className="button secondary" onClick={() => run("/api/auth/hh")} disabled={state.running || isPending}><KeyRound size={16} />{state.mode === "login" && state.running ? "Ожидаю вход…" : "Войти в HH"}</button>}
      <button className="button primary" onClick={() => run("/api/search")} disabled={state.running || isPending}><Search size={17} />Запустить поиск</button>
      <button className="icon-button" title={state.running ? "Остановить процесс" : "Обновить обзор"} aria-label={state.running ? "Остановить процесс" : "Обновить обзор"} onClick={() => state.running ? run("/api/auto-apply", { action: "stop" }) : router.refresh()}>{state.running ? <Square size={16} /> : <RefreshCw size={16} />}</button>
    </div>
    <div className="dashboard-runner-state" aria-live="polite"><span className={state.running ? "live-dot running" : "live-dot"} />{state.message}{account.status === "expired" && !state.running && <span> · Сессия HH истекла, войдите заново</span>}</div>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </div>;
}
