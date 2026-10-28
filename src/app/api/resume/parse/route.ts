import { profileMatches, staleProfileMessage } from "@/lib/profiles";
import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";
import { normalizeHHResumeUrl } from "@/lib/hh/resume-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin)) {
    return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  if (!await profileMatches(body?.profileId)) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });
  const resumeUrl = normalizeHHResumeUrl(body?.resumeUrl);
  if (!resumeUrl) return NextResponse.json({ error: "Укажите корректную HTTPS-ссылку на резюме HH" }, { status: 400 });
  if (hhRunner.getState().running) {
    return NextResponse.json({ error: "Остановите текущий процесс перед разбором резюме" }, { status: 409 });
  }
  try { return NextResponse.json(await hhRunner.parseResume(resumeUrl)); }
  catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось разобрать резюме", state: hhRunner.getState() }, { status: 500 });
  }
}
