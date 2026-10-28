import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id < 1) {
    return NextResponse.json({ error: "Некорректный id вакансии" }, { status: 400 });
  }

  if (!hhRunner.supportsVerifiedResumes) return NextResponse.json({ error: "Завершите текущий сеанс HH для обновления проверки резюме" }, { status: 409 });

  try {
    const state = await hhRunner.applyVacancy(id);
    return NextResponse.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка отклика";
    return NextResponse.json({ error: message, state: hhRunner.getState() }, { status: 500 });
  }
}
