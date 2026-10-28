import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";
import { parseCaptchaInput } from "@/lib/hh/captcha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const screenshot = await hhRunner.getCaptchaScreenshot();
  if (!screenshot) return NextResponse.json({ error: "Сейчас нет проверки HH" }, { status: 409 });
  return new Response(new Uint8Array(screenshot), { headers: {
    "Content-Type": "image/png", "Cache-Control": "no-store, private",
    "Cross-Origin-Resource-Policy": "same-origin"
  } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  }
  const input = parseCaptchaInput(await request.json().catch(() => null));
  if (!input) return NextResponse.json({ error: "Некорректное действие" }, { status: 400 });
  try {
    await hhRunner.sendCaptchaInput(input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось передать действие" }, { status: 409 });
  }
}
