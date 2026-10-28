import { activeProfileId } from "@/lib/profiles";
import { NextResponse } from "next/server";
import { writeLog } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { hhRunner } from "@/lib/hh/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (hhRunner.getState().running) return NextResponse.json({ error: "Остановите текущий процесс перед изменением очереди" }, { status: 409 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "Некорректный id вакансии" }, { status: 400 });
  }

  const existing = await prisma.vacancy.findUnique({ where: { id, profileId: await activeProfileId() } });
  if (!existing) return NextResponse.json({ error: "Вакансия не найдена" }, { status: 404 });
  if (existing.status === "applied") return NextResponse.json({ error: "По вакансии уже отправлен отклик" }, { status: 409 });
  const vacancy = await prisma.vacancy.update({ where: { id, profileId: await activeProfileId() }, data: { status: "skipped" } });
  await writeLog("info", "Вакансия пропущена", { vacancyId: id });

  return NextResponse.json({ vacancy });
}
