import { activeProfileId } from "@/lib/profiles";
import { NextResponse } from "next/server";
import { writeLog } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { hhRunner } from "@/lib/hh/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (hhRunner.getState().running) return NextResponse.json({ error: "Остановите текущий процесс перед удалением вакансий" }, { status: 409 });
  const id = Number((await params).id);

  if (!Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "Некорректный id вакансии" }, { status: 400 });
  }

  const vacancy = await prisma.vacancy.findUnique({ where: { id, profileId: await activeProfileId() } });
  if (!vacancy) {
    return NextResponse.json({ error: "Вакансия не найдена" }, { status: 404 });
  }

  await prisma.vacancy.delete({ where: { id, profileId: await activeProfileId() } });
  await writeLog("warn", "Вакансия удалена", {
    vacancyId: id,
    title: vacancy.title,
    company: vacancy.company
  });

  return NextResponse.json({ deleted: 1, vacancyId: id });
}
