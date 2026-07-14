"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Send, SkipForward, Trash2 } from "lucide-react";

export type VacancyRow = {
  id: number;
  title: string;
  company: string;
  salary: string | null;
  city: string | null;
  url: string;
  matchScore: number;
  status: string;
};

const statusLabels: Record<string, string> = {
  found: "found",
  pending: "pending",
  applied: "applied",
  skipped: "skipped",
  failed: "failed"
};

export function VacancyTable({ vacancies }: { vacancies: VacancyRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [hideCompleted, setHideCompleted] = useState(true);
  const [isPending, startTransition] = useTransition();
  const visibleVacancies = hideCompleted ? vacancies.filter((vacancy) => vacancy.status !== "applied" && vacancy.status !== "failed") : vacancies;
  const hiddenCount = vacancies.length - visibleVacancies.length;

  function postAction(id: number, action: "apply" | "skip") {
    setBusyId(id);
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/vacancies/" + id + "/" + action, { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error ?? "Действие не выполнено");
      } else {
        setMessage(action === "apply" ? "Отклик обработан" : "Вакансия пропущена");
      }
      setBusyId(null);
      router.refresh();
    });
  }

  function deleteVacancy(id: number, title: string) {
    const confirmed = window.confirm("Удалить вакансию «" + title + "»? Связанные записи откликов тоже будут удалены.");
    if (!confirmed) return;

    setBusyId(id);
    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/vacancies/" + id, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      setMessage(response.ok ? "Вакансия удалена" : payload.error ?? "Не удалось удалить вакансию");
      setBusyId(null);
      router.refresh();
    });
  }

  function clearVacancies() {
    const confirmed = window.confirm("Удалить все вакансии? Связанные записи откликов тоже будут удалены.");
    if (!confirmed) return;

    setMessage(null);
    startTransition(async () => {
      const response = await fetch("/api/vacancies", { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      setMessage(response.ok ? "Очищено вакансий: " + (payload.deleted ?? 0) : payload.error ?? "Не удалось очистить вакансии");
      router.refresh();
    });
  }

  return (
    <section className="panel table-panel">
      <div className="table-toolbar">
        <div className="toolbar-title">
          <strong>
            {visibleVacancies.length} из {vacancies.length} вакансий
          </strong>
          {message ? <span className="muted-text">{message}</span> : null}
        </div>
        <div className="table-actions">
          <label className="compact-checkbox">
            <input type="checkbox" checked={hideCompleted} onChange={(event) => setHideCompleted(event.target.checked)} />
            <span>Скрыть applied/failed</span>
          </label>
          <button className="button danger" type="button" onClick={clearVacancies} disabled={isPending || vacancies.length === 0}>
            <Trash2 size={17} />
            <span>Очистить все</span>
          </button>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Компания</th>
              <th>Зарплата</th>
              <th>Город</th>
              <th>Ссылка</th>
              <th>Match score</th>
              <th>Статус</th>
              <th>Действия</th>
            </tr>
          </thead>
          <tbody>
            {visibleVacancies.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-cell">
                  {vacancies.length === 0 ? "Вакансии появятся после запуска поиска." : "Все вакансии скрыты текущим фильтром."}
                </td>
              </tr>
            ) : (
              visibleVacancies.map((vacancy) => (
                <tr key={vacancy.id}>
                  <td className="title-cell">{vacancy.title}</td>
                  <td>{vacancy.company}</td>
                  <td>{vacancy.salary ?? "-"}</td>
                  <td>{vacancy.city ?? "-"}</td>
                  <td>
                    <a className="link-button" href={vacancy.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={16} />
                      <span>Открыть</span>
                    </a>
                  </td>
                  <td>
                    <div className="score-wrap">
                      <span>{vacancy.matchScore}</span>
                      <div className="score-track" aria-hidden="true">
                        <div className="score-fill" style={{ width: vacancy.matchScore + "%" }} />
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={"status-pill " + vacancy.status}>{statusLabels[vacancy.status] ?? vacancy.status}</span>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="icon-button"
                        title="Откликнуться"
                        disabled={isPending || busyId === vacancy.id || vacancy.status === "applied" || vacancy.status === "skipped"}
                        onClick={() => postAction(vacancy.id, "apply")}
                      >
                        <Send size={16} />
                      </button>
                      <button
                        className="icon-button ghost"
                        title="Пропустить"
                        disabled={isPending || busyId === vacancy.id || vacancy.status === "applied" || vacancy.status === "skipped"}
                        onClick={() => postAction(vacancy.id, "skip")}
                      >
                        <SkipForward size={16} />
                      </button>
                      <button
                        className="icon-button danger"
                        title="Удалить"
                        disabled={isPending || busyId === vacancy.id}
                        onClick={() => deleteVacancy(vacancy.id, vacancy.title)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {hiddenCount > 0 ? <p className="table-footnote muted-text">Скрыто applied/failed: {hiddenCount}</p> : null}
    </section>
  );
}
