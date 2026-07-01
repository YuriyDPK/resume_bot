import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowedLimits = new Set([5, 10, 20]);

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

  if (!allowedLimits.has(limit)) {
    return NextResponse.json({ error: "Выберите допустимое количество откликов" }, { status: 400 });
  }

  try {
    const state = await hhRunner.startAutoApply({ limit });
    return NextResponse.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось запустить автоотклики";
    return NextResponse.json({ error: message, state: hhRunner.getState() }, { status: 409 });
  }
}
