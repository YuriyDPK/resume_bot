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
    dailyLimit: settings.dailyLimit,
    searchLimit: settings.searchLimit,
    searchAllRussia: settings.searchAllRussia,
    remoteOnly: settings.remoteOnly,
    applyDelayMinSeconds: settings.applyDelayMinSeconds,
    applyDelayMaxSeconds: settings.applyDelayMaxSeconds
  };

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Preferences</p>
          <h1>Settings</h1>
        </div>
      </header>
      <SettingsForm initialValue={value} />
    </div>
  );
}
