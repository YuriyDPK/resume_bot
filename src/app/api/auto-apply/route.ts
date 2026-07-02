import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ state: hhRunner.getState() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  if (body.action === "stop") {
    return NextResponse.json({ state: hhRunner.stop() });
  }

  if (body.action !== "start") {
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  }

  const limit = Number(body.limit);

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return NextResponse.json({ error: "Укажите количество откликов от 1 до 1000" }, { status: 400 });
  }

  try {
    const state = await hhRunner.startAutoApply({ limit });
    return NextResponse.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось запустить автоотклики";
    return NextResponse.json({ error: message, state: hhRunner.getState() }, { status: 409 });
  }
}
