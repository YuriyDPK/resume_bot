import { NextResponse } from "next/server";
import { writeLog } from "@/lib/log";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  const id = Number.parseInt(params.id, 10);

  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Некорректный id вакансии" }, { status: 400 });
  }

  const vacancy = await prisma.vacancy.findUnique({ where: { id } });
  if (!vacancy) {
    return NextResponse.json({ error: "Вакансия не найдена" }, { status: 404 });
  }

  await prisma.vacancy.delete({ where: { id } });
  await writeLog("warn", "Вакансия удалена", {
    vacancyId: id,
    title: vacancy.title,
    company: vacancy.company
  });

  return NextResponse.json({ deleted: 1, vacancyId: id });
}
