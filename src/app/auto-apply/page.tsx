import { getHHAccount } from "@/lib/hh/account";
import { ensureSettings } from "@/lib/settings";
import { AutoApplyPanel } from "@/components/auto-apply-panel";
import { hhRunner } from "@/lib/hh/runner";

export const dynamic = "force-dynamic";

export default async function AutoApplyPage() {
  const settings = await ensureSettings();
  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Контролируемый запуск</p>
          <h1>Автоотклики</h1>
          <p className="page-subtitle">Резюме «{settings.name}». Отклики отправляются с настройками этого профиля.</p>
        </div>
      </header>
      <AutoApplyPanel key={settings.id} profileId={settings.id} canApply={Boolean(settings.resumeUrl) && (await getHHAccount()).status === "connected"} initialState={hhRunner.getState()} />
    </div>
  );
}
