import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";
import { parseCaptchaInput } from "@/lib/hh/captcha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function foreignRequest(request: Request) {
  const origin = request.headers.get("origin");
  return request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== new URL(request.url).origin);
}

export async function GET(request: Request) {
  if (foreignRequest(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  if (!new URL(request.url).searchParams.has("frame")) {
    return NextResponse.json(hhRunner.getBrowserView(), { headers: { "Cache-Control": "no-store, private" } });
  }
  const frame = await hhRunner.getBrowserFrame();
  if (!frame) return new Response(null, { status: 204, headers: { "Cache-Control": "no-store, private" } });
  return new Response(new Uint8Array(frame.image), { headers: {
    "Content-Type": "image/jpeg", "Cache-Control": "no-store, private",
    "Cross-Origin-Resource-Policy": "same-origin", "X-HH-Page-Id": frame.pageId
  } });
}

export async function POST(request: Request) {
  if (foreignRequest(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const input = body?.input?.type === "reload" ? { type: "reload" as const } : parseCaptchaInput(body?.input);
  if (!input || typeof body?.pageId !== "string" || !body.pageId || body.pageId.length > 100 || !Number.isSafeInteger(body.pauseId) || body.pauseId < 0) {
    return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });
  }
  try {
    await hhRunner.sendBrowserInput(body.pageId, body.pauseId, input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось передать действие" }, { status: 409 });
  }
}
