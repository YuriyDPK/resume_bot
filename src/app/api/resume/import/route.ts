import { profileMatches, staleProfileMessage } from "@/lib/profiles";
import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";
import { normalizeHHResumeUrl } from "@/lib/hh/resume-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!await profileMatches(body?.profileId)) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });
  const resumeUrl = normalizeHHResumeUrl(body?.resumeUrl);

  if (!resumeUrl) {
    return NextResponse.json({ error: "Укажите корректную ссылку на резюме HH" }, { status: 400 });
  }

  try {
    const result = await hhRunner.importResume(resumeUrl);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось загрузить резюме";
    return NextResponse.json({ error: message, state: hhRunner.getState() }, { status: 500 });
  }
}
