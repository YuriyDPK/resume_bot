import { profileMatches, staleProfileMessage } from "@/lib/profiles";
import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ state: hhRunner.getState() });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Некорректные параметры запуска" }, { status: 400 });
  }

  if (body.action === "stop") {
    return NextResponse.json({ state: hhRunner.stop() });
  }

  if (!await profileMatches(body.profileId)) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });

  if (body.action !== "start") {
    return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
  }

  if (!hhRunner.supportsVerifiedResumes) return NextResponse.json({ error: "Завершите текущий сеанс HH для обновления проверки владельца резюме" }, { status: 409 });

  const limit = Number(body.limit);

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return NextResponse.json({ error: "Укажите количество откликов от 1 до 1000" }, { status: 400 });
  }
  if (body.skipAdditionalRequirements !== undefined && typeof body.skipAdditionalRequirements !== "boolean") {
    return NextResponse.json({ error: "Укажите режим пропуска дополнительных требований" }, { status: 400 });
  }

  try {
    const state = await hhRunner.startAutoApply({ limit, skipAdditionalRequirements: body.skipAdditionalRequirements ?? false });
    return NextResponse.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось запустить автоотклики";
    return NextResponse.json({ error: message, state: hhRunner.getState() }, { status: 409 });
  }
}
