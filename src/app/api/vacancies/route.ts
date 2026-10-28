import { activeProfileId } from "@/lib/profiles";
import type { Prisma } from "@/generated/prisma/client";
import { NextResponse } from "next/server";
import { writeLog } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { listVacancies } from "@/lib/vacancy-store";
import { hhRunner } from "@/lib/hh/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses = new Set(["found", "pending", "applied", "skipped", "failed"]);
type VacancyStatus = "found" | "pending" | "applied" | "skipped" | "failed";

export async function GET(request: Request) {
  return NextResponse.json(await listVacancies(new URL(request.url).searchParams));
}

export async function DELETE(request: Request) {
  if (hhRunner.getState().running) return NextResponse.json({ error: "Остановите текущий процесс перед удалением вакансий" }, { status: 409 });
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  if (statusParam && !allowedStatuses.has(statusParam)) return NextResponse.json({ error: "Неизвестный статус" }, { status: 400 });
  const status = statusParam && allowedStatuses.has(statusParam) ? (statusParam as VacancyStatus) : null;
  const where: Prisma.VacancyWhereInput = { profileId: await activeProfileId(), ...(status ? { status } : {}) };

  const deleted = await prisma.vacancy.deleteMany({ where });
  await writeLog("warn", status ? "Вакансии очищены по статусу" : "Все вакансии очищены", {
    status,
    count: deleted.count
  });

  return NextResponse.json({ deleted: deleted.count });
}
