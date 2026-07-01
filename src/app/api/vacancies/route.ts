import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { writeLog } from "@/lib/log";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedStatuses = new Set(["found", "pending", "applied", "skipped", "failed"]);
type VacancyStatus = "found" | "pending" | "applied" | "skipped" | "failed";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const status = statusParam && allowedStatuses.has(statusParam) ? (statusParam as VacancyStatus) : null;

  const vacancies = await prisma.vacancy.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }],
    take: 200
  });

  return NextResponse.json({ vacancies });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status");
  const status = statusParam && allowedStatuses.has(statusParam) ? (statusParam as VacancyStatus) : null;
  const where: Prisma.VacancyWhereInput = status ? { status } : {};

  const deleted = await prisma.vacancy.deleteMany({ where });
  await writeLog("warn", status ? "Вакансии очищены по статусу" : "Все вакансии очищены", {
    status,
    count: deleted.count
  });

  return NextResponse.json({ deleted: deleted.count });
}
