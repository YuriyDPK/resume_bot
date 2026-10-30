import type { ParsedResume } from "@/lib/resume-parser";
import { neutralProfile } from "@/lib/default-settings";
import { resumeTitleFromText } from "@/lib/resume-parser";
import { prisma } from "@/lib/prisma";

// One HH session and one active queue per installation. Keep this lock across HMR.
const workspace = globalThis as unknown as { resumeProfileMutation?: boolean };
export function profileChangePending() { return Boolean(workspace.resumeProfileMutation); }

export async function withProfileChange<T>(action: () => Promise<T>) {
  if (profileChangePending()) throw new Error("Дождитесь завершения переключения резюме");
  workspace.resumeProfileMutation = true;
  try { return await action(); }
  finally { workspace.resumeProfileMutation = false; }
}

export async function activeProfileId() {
  const state = await prisma.appState.upsert({ where: { id: 1 }, create: { id: 1, activeProfileId: 1 }, update: {} });
  return state.activeProfileId;
}

export async function profileMatches(expected: unknown) {
  return expected === undefined || (Number.isSafeInteger(expected) && expected === await activeProfileId());
}

export const staleProfileMessage = "Резюме было переключено. Обновите страницу перед выполнением действия";

export async function listProfiles() {
  const activeId = await activeProfileId();
  // First launch keeps the previous settings and all history under id 1.
  await prisma.setting.upsert({ where: { id: 1 }, create: { ...neutralProfile, id: 1 }, update: {} });
  const profiles = await prisma.setting.findMany({ orderBy: { id: "asc" }, select: { id: true, name: true, resumeUrl: true, resumeText: true } });
  return { activeId, profiles: profiles.map(({ resumeText, ...profile }) => ({ ...profile, name: resumeTitleFromText(resumeText) || profile.name })) };
}

export async function createProfile(name: string, resumeUrl: string | null, copySettings: boolean, verified?: { parsed: ParsedResume; accountId: string }) {
  const sourceId = await activeProfileId();
  return prisma.$transaction(async (tx) => {
    const last = await tx.setting.findFirst({ orderBy: { id: "desc" }, select: { id: true } });
    const source = copySettings ? await tx.setting.findUnique({ where: { id: sourceId } }) : null;
    // Queues, history and resume text never travel with copied search preferences.
    const preferences = source ? {
      city: source.city, minSalary: source.minSalary, excludedWords: source.excludedWords, excludedDescriptionWords: source.excludedDescriptionWords,
      remoteOnly: source.remoteOnly, searchAllRussia: source.searchAllRussia,
      dailyLimit: source.dailyLimit, searchLimit: source.searchLimit,
      searchDelayMinSeconds: source.searchDelayMinSeconds, searchDelayMaxSeconds: source.searchDelayMaxSeconds,
      applyDelayMinSeconds: source.applyDelayMinSeconds, applyDelayMaxSeconds: source.applyDelayMaxSeconds
    } : {};
    const fields = verified?.parsed.fields;
    const profile = await tx.setting.create({ data: { ...neutralProfile, ...preferences, id: (last?.id ?? 0) + 1, name: verified?.parsed.title || name, resumeUrl,
      ...(verified ? { hhAccountId: verified.accountId, resumeVerifiedAt: new Date() } : {}),
      ...(fields?.resumeText ? { resumeText: fields.resumeText } : {}), ...(fields?.city ? { city: fields.city, searchAllRussia: false } : {}),
      ...(fields?.minSalary !== undefined ? { minSalary: fields.minSalary } : {}), ...(fields?.remoteOnly !== undefined ? { remoteOnly: fields.remoteOnly } : {})
    } });
    if (fields?.keywords) {
      const keywords = [...new Set(fields.keywords.split("\n").map((value) => value.trim()).filter(Boolean))];
      if (keywords.length) await tx.searchKeyword.createMany({ data: keywords.map((value) => ({ profileId: profile.id, value, enabled: true })) });
    } else if (source) {
      const keywords = await tx.searchKeyword.findMany({ where: { profileId: sourceId } });
      if (keywords.length) await tx.searchKeyword.createMany({ data: keywords.map(({ value, enabled }) => ({ profileId: profile.id, value, enabled })) });
    }
    await tx.appState.upsert({ where: { id: 1 }, create: { id: 1, activeProfileId: profile.id }, update: { activeProfileId: profile.id } });
    return profile;
  });
}
