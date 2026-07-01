import { unstable_noStore as noStore } from "next/cache";
import { VacancyTable, type VacancyRow } from "@/components/vacancy-table";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function VacanciesPage() {
  noStore();
  const vacancies = await prisma.vacancy.findMany({
    orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }],
    take: 200
  });

  const rows: VacancyRow[] = vacancies.map((vacancy) => ({
    id: vacancy.id,
    title: vacancy.title,
    company: vacancy.company,
    salary: vacancy.salary,
    city: vacancy.city,
    url: vacancy.url,
    matchScore: vacancy.matchScore,
    status: vacancy.status
  }));

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Vacancies</p>
          <h1>Вакансии</h1>
        </div>
      </header>
      <VacancyTable vacancies={rows} />
    </div>
  );
}
