import { getHHAccount } from "@/lib/hh/account";
import { ensureSettings } from "@/lib/settings";
import { unstable_noStore as noStore } from "next/cache";
import { VacancyTable } from "@/components/vacancy-table";
import { listVacancies } from "@/lib/vacancy-store";
import { hhRunner } from "@/lib/hh/runner";

export const dynamic = "force-dynamic";

export default async function VacanciesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  noStore();
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) if (typeof value === "string") params.set(key, value);
  const data = await listVacancies(params);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Ваша очередь</p>
          <h1>Вакансии</h1>
        </div>
      </header>
      <VacancyTable key={params.toString()} data={data} resumeReady={Boolean((await ensureSettings()).resumeUrl) && (await getHHAccount()).status === "connected"} running={hhRunner.getState().running} />
    </div>
  );
}
