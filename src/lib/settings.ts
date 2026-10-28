import { resumeTitleFromText } from "@/lib/resume-parser";
import { neutralProfile } from "@/lib/default-settings";
import { prisma } from "@/lib/prisma";
import { activeProfileId } from "@/lib/profiles";
import { deriveSearchKeywordsFromResume } from "@/lib/matching";

export async function ensureSettings(profileId?: number) {
  const id = profileId ?? await activeProfileId();
  const setting = await prisma.setting.upsert({
    where: { id }, update: {},
    create: { ...neutralProfile, id }
  });
  const keywords = await prisma.searchKeyword.findMany({ where: { profileId: id, enabled: true }, orderBy: { createdAt: "asc" } });
  return { ...setting, name: resumeTitleFromText(setting.resumeText) || setting.name, keywords };
}

export async function saveImportedResume(resumeUrl: string, resumeText: string, profileId?: number) {
  const { id } = await ensureSettings(profileId);
  return prisma.$transaction(async (tx) => {
    await tx.setting.update({ where: { id }, data: { resumeUrl, resumeText, ...(resumeTitleFromText(resumeText) ? { name: resumeTitleFromText(resumeText) } : {}) } });
    const existing = await tx.searchKeyword.findMany({ where: { profileId: id, enabled: true }, orderBy: { createdAt: "asc" } });
    // Explicit user queries remain authoritative when importing or refreshing a resume.
    if (existing.length > 0) return existing.map((keyword) => keyword.value);
    const queries = deriveSearchKeywordsFromResume(resumeText);
    for (const value of queries) {
      await tx.searchKeyword.upsert({ where: { profileId_value: { profileId: id, value } }, create: { profileId: id, value, enabled: true }, update: { enabled: true } });
    }
    return queries;
  });
}
