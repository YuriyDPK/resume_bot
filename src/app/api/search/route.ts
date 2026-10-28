import { profileMatches, staleProfileMessage } from "@/lib/profiles";
import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  if (!await profileMatches(body?.profileId)) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });
  try {
    const state = hhRunner.startSearch();
    return NextResponse.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось запустить поиск";
    return NextResponse.json({ error: message, state: hhRunner.getState() }, { status: 409 });
  }
}
