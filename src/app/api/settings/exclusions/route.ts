import { NextResponse } from "next/server";
import { activeProfileId, profileMatches, profileChangePending, staleProfileMessage, withProfileChange } from "@/lib/profiles";
import { prisma } from "@/lib/prisma";
import { hhRunner } from "@/lib/hh/runner";
import { ensureSettings } from "@/lib/settings";
import { normalizeText, parseExcludedWords } from "@/lib/vacancy-filter";
import { foreignRequest } from "@/lib/request-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const expected = new URL(request.url).searchParams.get("profileId");
  if (expected && !await profileMatches(Number(expected))) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });
  const setting = await ensureSettings();
  return NextResponse.json({ words: parseExcludedWords(setting.excludedWords), descriptionWords: parseExcludedWords(setting.excludedDescriptionWords) });
}
export async function POST(request: Request) {
  if (foreignRequest(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || !["add", "remove"].includes(body.action) || typeof body.word !== "string" || !body.word.trim() || body.word.length > 150 || /[\n,;]/.test(body.word)) return NextResponse.json({ error: "Введите одно слово или фразу до 150 символов" }, { status: 400 });
  if (body.scope !== undefined && !["title", "description"].includes(body.scope)) return NextResponse.json({ error: "Некорректная область стоп-фразы" }, { status: 400 });
  if (profileChangePending()) return NextResponse.json({ error: "Дождитесь изменения профиля" }, { status: 409 });
  try { return await withProfileChange(async () => {
  if (hhRunner.getState().running) return NextResponse.json({ error: "Дождитесь завершения процесса перед изменением фильтров" }, { status: 409 });
  if (!await profileMatches(body.profileId)) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });
  const profileId = await activeProfileId();
  const phrase = body.word.trim();
  if (body.vacancyId !== undefined && (!Number.isSafeInteger(body.vacancyId) || body.vacancyId < 1)) return NextResponse.json({ error: "Некорректная вакансия" }, { status: 400 });
  const words = await prisma.$transaction(async (tx) => {
    const setting = await tx.setting.findUniqueOrThrow({ where: { id: profileId } });
    const field = body.scope === "description" ? "excludedDescriptionWords" : "excludedWords";
    const current = parseExcludedWords(setting[field]);
    const next = body.action === "add" ? parseExcludedWords([...current, phrase]) : current.filter((word) => normalizeText(word) !== normalizeText(phrase));
    await tx.setting.update({ where: { id: profileId }, data: { [field]: next.join("\n") } });
    if (body.action === "add" && body.vacancyId) await tx.vacancy.updateMany({ where: { id: body.vacancyId, profileId, status: { not: "applied" } }, data: { status: "skipped" } });
    return next;
  });
  return NextResponse.json({ words });
  }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось изменить стоп-фразы" }, { status: 409 }); }
}
