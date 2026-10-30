import { unstable_noStore as noStore } from "next/cache";
import { SettingsForm, type SettingsFormValue } from "@/components/settings-form";
import { ensureSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  noStore();
  const settings = await ensureSettings();

  const value: SettingsFormValue = {
    keywords: settings.keywords.map((keyword) => keyword.value).join("\n"),
    city: settings.city,
    minSalary: settings.minSalary ?? "",
    coverLetterTemplate: settings.coverLetterTemplate,
    resumeText: settings.resumeText,
    resumeUrl: settings.resumeUrl ?? "",
    excludedWords: settings.excludedWords,
    excludedDescriptionWords: settings.excludedDescriptionWords,
    dailyLimit: settings.dailyLimit,
    searchLimit: settings.searchLimit,
    searchAllRussia: settings.searchAllRussia,
    remoteOnly: settings.remoteOnly,
    searchDelayMinSeconds: settings.searchDelayMinSeconds,
    searchDelayMaxSeconds: settings.searchDelayMaxSeconds,
    applyDelayMinSeconds: settings.applyDelayMinSeconds,
    applyDelayMaxSeconds: settings.applyDelayMaxSeconds
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Ваш профиль поиска</p>
          <h1>Настройки</h1>
          <p className="page-subtitle">Резюме «{settings.name}»: отдельные настройки поиска и откликов.</p>
        </div>
      </header>
      <SettingsForm key={settings.id} initialValue={value} profileId={settings.id} />
    </div>
  );
}
