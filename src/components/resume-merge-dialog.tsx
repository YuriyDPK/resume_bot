"use client";

import { useEffect, useRef } from "react";
import { resumeFieldLabels, type ParsedResume, type ResumeEditableSettings, type ResumeField, type ResumeMergeMode } from "@/lib/resume-parser";

function display(value: unknown, key: ResumeField) {
  if (value === undefined || value === null || value === "") return "Пусто";
  if (key === "remoteOnly") return value ? "Только удалённая работа" : "Без ограничения на удалённую работу";
  if (key === "minSalary") return Number(value).toLocaleString("ru-RU") + " ₽";
  return String(value);
}

export function ResumeMergeDialog({ parsed, current, onChoose, onCancel }: {
  parsed: ParsedResume; current: ResumeEditableSettings; onChoose: (mode: ResumeMergeMode) => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return <dialog ref={dialog} className="resume-merge-dialog" aria-labelledby="resume-merge-title" onCancel={(event) => { event.preventDefault(); onCancel(); }}>
    <h2 id="resume-merge-title">В настройках уже есть данные</h2>
    <p>Заменить заполненные поля данными из резюме или заполнить только пустые?</p>
    <div className="resume-preview-table"><table>
      <thead><tr><th>Поле</th><th>Сейчас</th><th>Из резюме</th></tr></thead>
      <tbody>{(Object.keys(parsed.fields) as ResumeField[]).map((key) => <tr key={key}>
        <th scope="row">{resumeFieldLabels[key]}</th>
        <td><div className="resume-preview-value">{display(current[key], key)}</div></td>
        <td><div className="resume-preview-value">{display(parsed.fields[key], key)}</div></td>
      </tr>)}</tbody>
    </table></div>
    <p className="muted-text">Поля, которых нет в резюме, останутся без изменений. В режиме «Только пустые» выбранный формат работы сохраняется, в том числе снятая галочка.</p>
    <div className="form-actions">
      <button className="button primary" type="button" onClick={() => onChoose("replace")}>Заменить заполненные поля</button>
      <button className="button secondary" type="button" onClick={() => onChoose("empty")}>Заполнить только пустые</button>
      <button className="button secondary" type="button" onClick={onCancel}>Отмена</button>
    </div>
    <p className="muted-text">Изменения появятся в форме. Для сохранения настроек нажмите «Сохранить».</p>
  </dialog>;
}
