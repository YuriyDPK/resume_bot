import { NextResponse } from "next/server";
import { inboxData } from "@/lib/inbox-store";
import { hhRunner } from "@/lib/hh/runner";
import { foreignRequest } from "@/lib/request-origin";
import { profileMatches, staleProfileMessage } from "@/lib/profiles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) { return NextResponse.json(await inboxData(new URL(request.url).searchParams), { headers: { "Cache-Control": "no-store, private" } }); }
export async function POST(request: Request) {
  if (foreignRequest(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await request.json().catch(() => ({}));
  if (!await profileMatches(body?.profileId)) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });
  try {
    if (!hhRunner.supportsVerifiedResumes) return NextResponse.json({ error: "Завершите текущий сеанс HH, чтобы применилось обновление" }, { status: 409 });
    return NextResponse.json({ state: hhRunner.startInboxSync() });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось обновить ответы" }, { status: 409 }); }
}
