import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  const id = Number.parseInt(params.id, 10);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Некорректный id вакансии" }, { status: 400 });
  }

  try {
    const state = await hhRunner.applyVacancy(id);
    return NextResponse.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ошибка отклика";
    return NextResponse.json({ error: message, state: hhRunner.getState() }, { status: 500 });
  }
}
