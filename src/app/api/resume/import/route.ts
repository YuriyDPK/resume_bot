import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isHHResumeUrl(value: string) {
  try {
    const url = new URL(value);
    return /(^|\.)hh\.ru$/.test(url.hostname) && url.pathname.includes("/resume/");
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const resumeUrl = String(body.resumeUrl ?? "").trim();

  if (!isHHResumeUrl(resumeUrl)) {
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
