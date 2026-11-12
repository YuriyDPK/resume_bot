"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronDown, Hand, Maximize, Minimize, Monitor, RefreshCw, Square, ZoomIn, ZoomOut } from "lucide-react";
import type { HHRunner } from "@/lib/hh/runner";
import { browserKeys, type BrowserInput } from "@/lib/hh/browser-view";
import type { CaptchaInput } from "@/lib/hh/captcha";

type BrowserView = ReturnType<HHRunner["getBrowserView"]>;
type Input = CaptchaInput | { type: "reload" };

export function HHBrowserWorkspace() {
  const [view, setView] = useState<BrowserView | null>(null);
  const [collapsed, setCollapsed] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [panning, setPanning] = useState(false);
  const workspace = useRef<HTMLElement>(null);
  const nativeFullscreen = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch("/api/hh/browser", { cache: "no-store", signal: controller.signal });
        if (response.ok) setView(await response.json());
      } catch { /* Keep the current view during a transient connection error. */ }
      if (!controller.signal.aborted) timer = setTimeout(poll, document.hidden ? 3000 : 1000);
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);

  useEffect(() => {
    function syncFullscreen() {
      if (workspace.current && document.fullscreenElement === workspace.current) nativeFullscreen.current = true;
      else if (nativeFullscreen.current) { nativeFullscreen.current = false; setExpanded(false); }
    }
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () => document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  async function setFullscreen(next: boolean) {
    if (!next) {
      if (document.fullscreenElement === workspace.current) await document.exitFullscreen().catch(() => undefined);
      nativeFullscreen.current = false;
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (workspace.current?.requestFullscreen) await workspace.current.requestFullscreen().catch(() => undefined);
  }

  function changeZoom(next: number) {
    const value = Math.max(1, Math.min(4, next));
    setZoom(value);
    if (value === 1) setPanning(false);
  }

  if (!view || (!view.available && !view.state.running)) return null;
  const key = `${view.state.startedAt ?? view.pageId}:${view.state.manualPauseId}`;
  const waiting = view.state.waitingForUser;
  const heading = waiting ? view.state.manualActionReason === "form" ? "Завершите действие на HH" : "Решите CAPTCHA вручную" :
    view.login ? "Войдите в HH" : "Браузер HH";

  if (collapsed === key) return <button className={`hh-browser-launcher${waiting ? " needs-action" : ""}`} onClick={() => setCollapsed(null)}>
    <Monitor size={19} /><span>{waiting ? "HH ждёт вашего действия" : "Показать браузер HH"}</span>
    <span className={view.state.running ? "live-dot running" : "live-dot"} />
  </button>;

  return <section ref={workspace} className={`hh-workspace${expanded ? " expanded" : ""}`} aria-labelledby="hh-browser-heading">
    <header className="hh-browser-toolbar">
      <div className="hh-browser-title"><Monitor size={21} /><div><h2 id="hh-browser-heading">{heading}</h2>
        <span>{view.interactive ? "Вы управляете страницей" : "Бот работает"} · {view.state.processed} / {view.state.target || "—"}</span></div></div>
      <div className="hh-browser-actions">
        <div className="hh-zoom-controls" role="group" aria-label="Масштаб страницы HH">
          <button className="icon-button" type="button" aria-label="Уменьшить масштаб" title="Уменьшить масштаб" disabled={zoom <= 1} onClick={() => changeZoom(zoom - 0.5)}><ZoomOut size={18} /></button>
          <button className="hh-zoom-value" type="button" title="Вернуть обычный масштаб" aria-label={`Масштаб ${Math.round(zoom * 100)}%, вернуть обычный`} onClick={() => changeZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button className="icon-button" type="button" aria-label="Увеличить масштаб" title="Увеличить масштаб" disabled={zoom >= 4} onClick={() => changeZoom(zoom + 0.5)}><ZoomIn size={18} /></button>
          <button className={`icon-button${panning ? " active" : ""}`} type="button" aria-label="Перемещать увеличенное изображение" title="Перемещать увеличенное изображение" aria-pressed={panning} disabled={zoom <= 1} onClick={() => setPanning(!panning)}><Hand size={18} /></button>
        </div>
        <button className="icon-button" type="button" aria-label={expanded ? "Выйти из полного экрана" : "На весь экран"} title={expanded ? "Выйти из полного экрана" : "На весь экран"} onClick={() => void setFullscreen(!expanded)}>{expanded ? <Minimize size={18} /> : <Maximize size={18} />}</button>
        {view.state.running ? <StopButton /> : null}
        <button className="button secondary" onClick={() => { void setFullscreen(false); setCollapsed(key); }}><ChevronDown size={17} />Свернуть</button>
      </div>
    </header>
    <div className={`hh-browser-status${waiting ? " needs-action" : ""}`} role="status">{view.state.message}</div>
    <div className="hh-browser-address" title={view.url}>{view.url.startsWith("https://") ? view.url : "Подключаюсь к HH…"}</div>
    {view.available ? <BrowserSurface key={key} view={view} zoom={zoom} panning={panning} /> : <div className="hh-browser-loading" role="status">Открываю страницу HH…</div>}
  </section>;
}

function StopButton() {
  const [error, setError] = useState(false);
  async function stop() {
    try {
      const response = await fetch("/api/auto-apply", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "stop" }) });
      setError(!response.ok);
    } catch { setError(true); }
  }
  return <button className="button secondary" onClick={stop}><Square size={15} />{error ? "Повторить остановку" : "Остановить процесс"}</button>;
}

function BrowserSurface({ view, zoom, panning }: { view: BrowserView; zoom: number; panning: boolean }) {
  const [frame, setFrame] = useState<{ url: string; pageId: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const framePageId = useRef<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const alive = useRef(true);
  const dragging = useRef(false);
  const lastMove = useRef(0);
  const panStart = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const interactive = view.interactive && !resuming;

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let currentUrl: string | undefined;
    async function refresh() {
      if (!document.hidden) {
        try {
          const response = await fetch("/api/hh/browser?frame=1", { cache: "no-store", signal: controller.signal });
          const pageId = response.headers.get("X-HH-Page-Id");
          if (response.ok && response.status !== 204 && pageId) {
            const blob = await response.blob();
            if (controller.signal.aborted) return;
            const url = URL.createObjectURL(blob);
            setFrame({ url, pageId });
            if (currentUrl) URL.revokeObjectURL(currentUrl);
            currentUrl = url;
          }
        } catch { /* Navigation may briefly interrupt a frame. */ }
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, document.hidden ? 1500 : 400);
    }
    void refresh();
    return () => { alive.current = false; controller.abort(); clearTimeout(timer); if (currentUrl) URL.revokeObjectURL(currentUrl); };
  }, []);

  useEffect(() => {
    if (interactive) viewport.current?.focus({ preventScroll: true });
  }, [interactive]);

  function send(input: Input) {
    const pageId = framePageId.current;
    if (!interactive) return Promise.resolve(false);
    if (!pageId) {
      setError("Дождитесь загрузки изображения страницы HH и повторите действие.");
      return Promise.resolve(false);
    }
    const action = queue.current.then(async () => {
      try {
        const response = await fetch("/api/hh/browser", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pageId, pauseId: view.state.manualPauseId, input }) });
        if (!response.ok) {
          const payload = await response.json();
          if (alive.current) setError(payload.error ?? "Действие не передано");
          return false;
        }
        if (alive.current) setError(null);
        return true;
      } catch { if (alive.current) setError("Не удалось связаться с ботом. Повторите действие."); return false; }
    });
    queue.current = action;
    return action;
  }

  function point(event: PointerEvent<HTMLDivElement>) {
    const element = image.current;
    if (!element?.naturalWidth) return null;
    const rect = element.getBoundingClientRect();
    const scale = Math.min(rect.width / element.naturalWidth, rect.height / element.naturalHeight);
    const left = rect.left + (zoom > 1 ? 0 : (rect.width - element.naturalWidth * scale) / 2);
    const top = rect.top + (zoom > 1 ? 0 : (rect.height - element.naturalHeight * scale) / 2);
    if (event.type === "pointerdown" && (event.clientX < left || event.clientY < top || event.clientX >= left + element.naturalWidth * scale || event.clientY >= top + element.naturalHeight * scale)) return null;
    return { x: Math.max(0, Math.min(element.naturalWidth - 1, (event.clientX - left) / scale)),
      y: Math.max(0, Math.min(element.naturalHeight - 1, (event.clientY - top) / scale)) };
  }

  function pointer(event: PointerEvent<HTMLDivElement>, action: "down" | "move" | "up") {
    if (panning) {
      if (event.pointerType === "touch") return;
      if (action === "down" && event.button === 0) {
        panStart.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      } else if (action === "move" && panStart.current) {
        event.currentTarget.scrollLeft = panStart.current.left - (event.clientX - panStart.current.x);
        event.currentTarget.scrollTop = panStart.current.top - (event.clientY - panStart.current.y);
      } else if (action === "up") panStart.current = null;
      return;
    }
    if (!interactive || (action === "down" && event.button !== 0)) return;
    if (action === "move" && (!dragging.current || Date.now() - lastMove.current < 80)) return;
    if (action === "up" && !dragging.current) return;
    const coordinates = point(event);
    if (!coordinates) return;
    event.preventDefault();
    if (action === "down") {
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      event.currentTarget.focus({ preventScroll: true });
    }
    if (action === "up") dragging.current = false;
    if (action === "move") lastMove.current = Date.now();
    void send({ type: "pointer", action, ...coordinates });
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!interactive || panning || event.nativeEvent.isComposing) return;
    let input: BrowserInput | null = null;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") input = { type: "key", key: "SelectAll" };
    else if (event.metaKey || event.ctrlKey || event.altKey) return;
    else if (event.key === "Tab") input = { type: "key", key: event.shiftKey ? "Shift+Tab" : "Tab" };
    else if (event.key.length === 1) input = { type: "text", text: event.key };
    else if (browserKeys.includes(event.key as typeof browserKeys[number])) input = { type: "key", key: event.key as typeof browserKeys[number] };
    if (input) { event.preventDefault(); void send(input); }
  }

  async function resume() {
    const action = send({ type: "continue" });
    setResuming(true);
    if (!await action && alive.current) setResuming(false);
  }

  return <>
    <div ref={viewport} className={`hh-viewport${interactive ? " interactive" : ""}${panning ? " panning" : ""}`} role="application" tabIndex={interactive ? 0 : -1}
      aria-label="Страница HH внутри бота" aria-disabled={!interactive} onKeyDown={keyDown}
      onPointerDown={(event) => pointer(event, "down")} onPointerMove={(event) => pointer(event, "move")}
      onPointerUp={(event) => pointer(event, "up")} onPointerCancel={(event) => pointer(event, "up")}
      onPaste={(event) => { if (interactive && !panning) { event.preventDefault(); void send({ type: "text", text: event.clipboardData.getData("text").slice(0, 500) }); } }}
      onWheel={(event) => { if (interactive && !panning) void send({ type: "scroll", deltaY: Math.max(-600, Math.min(600, event.deltaY)) }); }}>
      {frame ? <div className="hh-viewport-stage" style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}>
        {/* A live browser frame must retain its viewport coordinates. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={image} src={frame.url} alt="Текущая страница HH" draggable={false} style={{ objectPosition: zoom > 1 ? "top left" : "center" }} onLoad={() => { framePageId.current = frame.pageId; }} />
      </div> : <p role="status">Загружаю страницу HH…</p>}
    </div>
    <footer className="hh-browser-footer">
      {interactive ? <>
        <p className="muted-text">{panning ? "Перетащите изображение, чтобы увидеть нужную часть. Для работы со страницей выключите перемещение." : "Нажмите нужное поле прямо на странице HH и печатайте обычной клавиатурой. Для перемещения увеличенного изображения нажмите кнопку с ладонью."}</p>
        {view.login && !view.state.waitingForUser ? <button className="button secondary" type="button" onClick={() => void send({ type: "reload" })}><RefreshCw size={15} />Перезагрузить HH</button> : null}
      </> : <p className="muted-text">{resuming ? "Проверяю результат HH…" : "Можно наблюдать за работой. Когда HH запросит ваше действие, управление включится здесь."}</p>}
      {view.state.waitingForUser ? <div className="hh-resume-controls"><button className="button primary" disabled={!interactive} onClick={() => void resume()}>
        {resuming ? "Проверяю результат HH…" : "Проверить и продолжить"}</button><span className="muted-text">Очередь ждёт вашего подтверждения и ответа HH.</span></div> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </footer>
  </>;
}
