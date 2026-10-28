import { activeProfileId, profileChangePending, profileMatches, staleProfileMessage } from "@/lib/profiles";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hhRunner } from "@/lib/hh/runner";
import { writeLog } from "@/lib/log";
import { parseRowIds } from "@/lib/list-filters";
import { foreignRequest } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  if (foreignRequest(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (profileChangePending() || !await profileMatches(body?.profileId)) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });
  const profileId = await activeProfileId();
  const ids = parseRowIds(body?.ids);
  if (!ids || !["skip", "queue", "delete", "apply"].includes(body?.action)) return NextResponse.json({ error: "Выберите вакансии и действие" }, { status: 400 });
  if (hhRunner.getState().running) return NextResponse.json({ error: "Остановите текущий процесс перед изменением очереди" }, { status: 409 });
  if (body.action === "apply") {
    if (!hhRunner.supportsSelectedVacancies || !hhRunner.supportsVerifiedResumes) return NextResponse.json({ error: "Обновление завершится после текущего сеанса HH. Завершите вход и повторите запуск выбранных вакансий" }, { status: 409 });
    const state = await hhRunner.startAutoApply({ limit: ids.length, vacancyIds: ids });
    return NextResponse.json({ state });
  }
  const result = body.action === "delete" ? await prisma.vacancy.deleteMany({ where: { profileId, id: { in: ids } } }) :
    await prisma.vacancy.updateMany({ where: { profileId, id: { in: ids }, status: { not: "applied" } }, data: { status: body.action === "skip" ? "skipped" : "pending" } });
  await writeLog(body.action === "delete" ? "warn" : "info", "Групповое действие с вакансиями", { action: body.action, count: result.count }, profileId);
  return NextResponse.json({ changed: result.count });
}
