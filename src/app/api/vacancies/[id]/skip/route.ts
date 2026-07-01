import { NextResponse } from "next/server";
import { writeLog } from "@/lib/log";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Некорректный id вакансии" }, { status: 400 });
  }

  const vacancy = await prisma.vacancy.update({ where: { id }, data: { status: "skipped" } });
  await writeLog("info", "Вакансия пропущена", { vacancyId: id });

  return NextResponse.json({ vacancy });
}
