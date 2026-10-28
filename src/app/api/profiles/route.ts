import { getHHAccount } from "@/lib/hh/account";
import { NextResponse } from "next/server";
import { hhRunner } from "@/lib/hh/runner";
import { createProfile, listProfiles, profileMatches, staleProfileMessage, withProfileChange } from "@/lib/profiles";
import { normalizeHHResumeUrl } from "@/lib/hh/resume-url";
import { foreignRequest } from "@/lib/request-origin";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ...await listProfiles(), busy: hhRunner.getState().running, accountConnected: (await getHHAccount()).status === "connected" });
}

export async function POST(request: Request) {
  if (foreignRequest(request)) return NextResponse.json({ error: "Недопустимый источник запроса" }, { status: 403 });
  const body = await request.json().catch(() => null);
  if (!body || !["create", "switch"].includes(body.action)) return NextResponse.json({ error: "Укажите действие с резюме" }, { status: 400 });
  try {
    let verified: Awaited<ReturnType<typeof hhRunner.inspectOwnResume>> | undefined;
    if (body.action === "create") {
      const url = normalizeHHResumeUrl(body.resumeUrl);
      if (!url) return NextResponse.json({ error: "Укажите корректную ссылку на своё резюме HH" }, { status: 400 });
      if (!await profileMatches(body.profileId)) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });
      if (hhRunner.getState().running || !hhRunner.supportsVerifiedResumes) return NextResponse.json({ error: "Завершите текущий процесс HH перед добавлением резюме" }, { status: 409 });
      if (body.copySettings !== undefined && typeof body.copySettings !== "boolean") return NextResponse.json({ error: "Укажите режим копирования настроек" }, { status: 400 });
      const id = new URL(url).pathname.split("/")[2].toLowerCase();
      const known = await prisma.setting.findMany({ select: { resumeUrl: true } });
      if (known.some((profile) => profile.resumeUrl?.match(/\/resume\/([a-z0-9_-]+)/i)?.[1].toLowerCase() === id)) return NextResponse.json({ error: "Это резюме уже добавлено. Выберите его в списке" }, { status: 409 });
      verified = await hhRunner.inspectOwnResume(url);
    }
    return await withProfileChange(async () => {
      if (hhRunner.getState().running) return NextResponse.json({ error: "Дождитесь завершения процесса или остановите его перед сменой резюме" }, { status: 409 });
      if (!hhRunner.supportsResumeProfiles) return NextResponse.json({ error: "Завершите текущий сеанс HH, чтобы применилось обновление профилей" }, { status: 409 });
      if (!await profileMatches(body.profileId)) return NextResponse.json({ error: staleProfileMessage }, { status: 409 });
      if (body.action === "switch") {
        if (!Number.isSafeInteger(body.id) || body.id < 1) return NextResponse.json({ error: "Некорректное резюме" }, { status: 400 });
        if (!await prisma.setting.findUnique({ where: { id: body.id } })) return NextResponse.json({ error: "Резюме не найдено" }, { status: 404 });
        await prisma.appState.update({ where: { id: 1 }, data: { activeProfileId: body.id } });
      } else {
        const resumeUrl = normalizeHHResumeUrl(body.resumeUrl);
        if (!resumeUrl) return NextResponse.json({ error: "Укажите корректную ссылку на резюме HH" }, { status: 400 });
        if (body.copySettings !== undefined && typeof body.copySettings !== "boolean") return NextResponse.json({ error: "Укажите режим копирования настроек" }, { status: 400 });
        await listProfiles();
        const resumeId = new URL(resumeUrl).pathname.split("/")[2].toLowerCase();
        const known = await prisma.setting.findMany({ select: { resumeUrl: true } });
        const existing = known.some((profile) => profile.resumeUrl?.match(/\/resume\/([a-z0-9_-]+)/i)?.[1].toLowerCase() === resumeId);
        if (existing) return NextResponse.json({ error: "Это резюме уже добавлено. Выберите его в списке" }, { status: 409 });
        // Replaced by HH's actual title once parsing succeeds. A failed import
        // remains recoverable through Settings without inventing a job title.
        await createProfile("Резюме HH · " + new URL(resumeUrl).pathname.split("/").at(-1)!.slice(-6), resumeUrl, body.copySettings === true, verified);
      }
      hhRunner.resetProfileState();
      return NextResponse.json(await listProfiles());
    });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Не удалось изменить резюме" }, { status: 409 }); }
}
