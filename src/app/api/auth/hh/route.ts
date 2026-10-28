import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";
import { getHHAccount } from "@/lib/hh/account";
import { foreignRequest } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (foreignRequest(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  return NextResponse.json({ account: await getHHAccount(!hhRunner.getState().running, new URL(request.url).searchParams.get("refresh") === "true"), state: hhRunner.getState() }, { headers: { "Cache-Control": "no-store, private" } });
}

export async function DELETE(request: Request) {
  if (foreignRequest(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (hhRunner.getState().running || typeof hhRunner.logout !== "function") return NextResponse.json({ error: "Выход доступен после завершения текущего процесса HH" }, { status: 409 });
  try { return NextResponse.json({ state: await hhRunner.logout() }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось выйти из HH" }, { status: 409 }); }
}

export async function POST(request: Request) {
  if (foreignRequest(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  try {
    const state = hhRunner.startLogin();
    return NextResponse.json({ state });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось открыть HH";
    return NextResponse.json({ error: message, state: hhRunner.getState() }, { status: 409 });
  }
}
