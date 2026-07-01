import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const state = hhRunner.startLogin();
    return NextResponse.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось открыть HH";
    return NextResponse.json({ error: message, state: hhRunner.getState() }, { status: 409 });
  }
}
