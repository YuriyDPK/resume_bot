import { activeProfileId, profileChangePending, profileMatches, staleProfileMessage } from "@/lib/profiles";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { listLogs } from "@/lib/log-store";
import { logFilters, logWhere } from "@/lib/log-query";
import { parseRowIds } from "@/lib/list-filters";
import { foreignRequest } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json(await listLogs(new URL(request.url).searchParams));
}

export async function DELETE(request: Request) {
  if (foreignRequest(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (profileChangePending() || !await profileMatches(body?.profileId)) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });
  const profileId = await activeProfileId();
  const ids = parseRowIds(body?.ids);
  if (ids) return NextResponse.json({ deleted: (await prisma.log.deleteMany({ where: { profileId, id: { in: ids } } })).count });
  if (body?.allMatching !== true || !body.filters || typeof body.filters !== "object" || Array.isArray(body.filters)) return NextResponse.json({ error: "Выберите записи или явно подтвердите очистку выборки" }, { status: 400 });
  const params = new URLSearchParams();
  for (const key of ["q", "level", "period"]) if (typeof body.filters[key] === "string") params.set(key, body.filters[key]);
  if (params.has("level") && !["all", "info", "warn", "error"].includes(params.get("level")!)) return NextResponse.json({ error: "Неизвестный уровень логов" }, { status: 400 });
  if (params.has("period") && !["all", "today", "week", "month"].includes(params.get("period")!)) return NextResponse.json({ error: "Неизвестный период" }, { status: 400 });
  return NextResponse.json({ deleted: (await prisma.log.deleteMany({ where: { ...logWhere(logFilters(params)), profileId } })).count });
}
