import { NextResponse } from "next/server";
import { writeLog } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { ensureSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function cleanKeywords(value: unknown) {
  const raw = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return Array.from(
    new Set(
      raw
        .split(/[\n,;]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function rangeFromBody(body: Record<string, unknown>, minKey: string, maxKey: string, fallbackMin: number, fallbackMax: number) {
  const first = Math.max(0, positiveNumber(body[minKey], fallbackMin));
  const second = Math.max(0, positiveNumber(body[maxKey], fallbackMax));
  return {
    min: Math.min(first, second),
    max: Math.max(first, second)
  };
}

export async function GET() {
  const settings = await ensureSettings();
  return NextResponse.json({ settings });
}

export async function PUT(request: Request) {
  const body = await request.json();
  const keywords = cleanKeywords(body.keywords);
  const applyDelayRange = rangeFromBody(body, "applyDelayMinSeconds", "applyDelayMaxSeconds", 3, 8);
  const searchDelayRange = rangeFromBody(body, "searchDelayMinSeconds", "searchDelayMaxSeconds", 1, 3);

  const settingData = {
    id: 1,
    city: String(body.city ?? "Москва").trim() || "Москва",
    minSalary: optionalNumber(body.minSalary),
    coverLetterTemplate: String(body.coverLetterTemplate ?? "").trim(),
    resumeText: String(body.resumeText ?? "").trim(),
    resumeUrl: String(body.resumeUrl ?? "").trim() || null,
    dailyLimit: Math.max(1, optionalNumber(body.dailyLimit) ?? 5),
    searchLimit: Math.min(1000, Math.max(1, optionalNumber(body.searchLimit) ?? 50)),
    searchAllRussia: Boolean(body.searchAllRussia),
    remoteOnly: Boolean(body.remoteOnly),
    searchDelayMinSeconds: searchDelayRange.min,
    searchDelayMaxSeconds: searchDelayRange.max,
    applyDelayMinSeconds: applyDelayRange.min,
    applyDelayMaxSeconds: applyDelayRange.max
  };

  const setting = await prisma.$transaction(async (tx) => {
    const saved = await tx.setting.upsert({
      where: { id: 1 },
      create: settingData,
      update: settingData
    });

    await tx.searchKeyword.deleteMany();
    if (keywords.length > 0) {
      await tx.searchKeyword.createMany({ data: keywords.map((value) => ({ value, enabled: true })) });
    }
    return saved;
  });

  await writeLog("info", "Настройки обновлены", { keywords: keywords.length });
  const updated = await ensureSettings();

  return NextResponse.json({ settings: { ...setting, keywords: updated.keywords } });
}
