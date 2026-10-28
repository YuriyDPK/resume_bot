import { resumeTitleFromText } from "@/lib/resume-parser";
import { activeProfileId, profileChangePending, profileMatches, staleProfileMessage } from "@/lib/profiles";
import { NextResponse } from "next/server";
import { writeLog } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { ensureSettings } from "@/lib/settings";
import { parseExcludedWords } from "@/lib/vacancy-filter";
import { hhRunner } from "@/lib/hh/runner";
import { normalizeHHResumeUrl } from "@/lib/hh/resume-url";
import { resumeIdFromUrl } from "@/lib/hh/ownership";

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
  if (hhRunner.getState().running) {
    return NextResponse.json({ error: "Остановите текущий процесс перед изменением настроек" }, { status: 409 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Некорректные настройки" }, { status: 400 });
  }
  if (profileChangePending() || !await profileMatches(body.profileId)) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });
  const profileId = await activeProfileId();
  const previous = await ensureSettings(profileId);
  const resumeUrl = body.resumeUrl ? normalizeHHResumeUrl(body.resumeUrl) : null;
  if (body.resumeUrl && !resumeUrl) return NextResponse.json({ error: "Укажите корректную ссылку на своё резюме HH" }, { status: 400 });
  let owner: { accountId: string } | undefined;
  if (resumeUrl && resumeIdFromUrl(resumeUrl) !== resumeIdFromUrl(previous.resumeUrl)) {
    try {
      if (!hhRunner.supportsVerifiedResumes) throw new Error("Завершите текущий сеанс HH для обновления проверки резюме");
      owner = await hhRunner.verifyOwnResume(resumeUrl);
      if (previous.hhAccountId && previous.hhAccountId !== owner.accountId) throw new Error("Для другого HH-аккаунта добавьте отдельное резюме");
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось подтвердить владельца резюме" }, { status: 409 }); }
  }
  const keywords = cleanKeywords(body.keywords);
  const applyDelayRange = rangeFromBody(body, "applyDelayMinSeconds", "applyDelayMaxSeconds", 3, 8);
  const searchDelayRange = rangeFromBody(body, "searchDelayMinSeconds", "searchDelayMaxSeconds", 1, 3);

  const settingData = {
    id: profileId,
    ...(resumeTitleFromText(String(body.resumeText ?? "")) ? { name: resumeTitleFromText(String(body.resumeText)) } : {}),
    city: String(body.city ?? "").trim(),
    minSalary: optionalNumber(body.minSalary),
    coverLetterTemplate: String(body.coverLetterTemplate ?? "").trim(),
    resumeText: String(body.resumeText ?? "").trim(),
    resumeUrl,
    ...(owner ? { hhAccountId: owner.accountId, resumeVerifiedAt: new Date() } : {}),
    excludedWords: parseExcludedWords(Array.isArray(body.excludedWords) ? body.excludedWords.map(String) : String(body.excludedWords ?? "")).join("\n"),
    browserHeadless: true,
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
      where: { id: profileId },
      create: settingData,
      update: settingData
    });

    await tx.searchKeyword.deleteMany({ where: { profileId } });
    if (keywords.length > 0) {
      await tx.searchKeyword.createMany({ data: keywords.map((value) => ({ profileId, value, enabled: true })) });
    }
    return saved;
  });

  await writeLog("info", "Настройки обновлены", { keywords: keywords.length }, profileId);
  const updated = await ensureSettings(profileId);

  return NextResponse.json({ settings: { ...setting, keywords: updated.keywords } });
}
