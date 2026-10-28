import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Setting } from "@/generated/prisma/client";
import { ensureSettings, saveImportedResume } from "@/lib/settings";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/profiles", () => ({ activeProfileId: vi.fn(async () => 1) }));
vi.mock("@/lib/prisma", () => {
  const methods = {
    setting: { upsert: vi.fn(), update: vi.fn() },
    searchKeyword: { findMany: vi.fn(), upsert: vi.fn() }
  };
  return { prisma: { ...methods, $transaction: vi.fn(async (callback: (tx: typeof methods) => Promise<unknown>) => callback(methods)) } };
});

describe("neutral settings and resume import", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.setting.upsert).mockResolvedValue({ id: 1, resumeText: "", browserHeadless: true } as Setting);
    vi.mocked(prisma.searchKeyword.findMany).mockResolvedValue([]);
  });
  it("creates a neutral profile without seeded professions or someone else's resume", async () => {
    const settings = await ensureSettings();
    expect(prisma.setting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ resumeText: "", resumeUrl: null, browserHeadless: true }), update: {}
    }));
    expect(settings.keywords).toEqual([]);
  });
  it("preserves explicitly configured queries while importing a different resume", async () => {
    vi.mocked(prisma.searchKeyword.findMany).mockResolvedValue([{ profileId: 1, id: 1, value: "Врач", enabled: true, createdAt: new Date(), updatedAt: new Date() }]);
    expect(await saveImportedResume("https://hh.ru/resume/test", "Желаемая должность: Повар")).toEqual(["Врач"]);
    expect(prisma.searchKeyword.upsert).not.toHaveBeenCalled();
    expect(prisma.setting.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: "Повар", resumeUrl: "https://hh.ru/resume/test", resumeText: "Желаемая должность: Повар" } }));
  });
  it("uses an arbitrary desired profession when no manual queries exist", async () => {
    expect(await saveImportedResume("https://hh.ru/resume/test", "Желаемая должность: Повар")).toEqual(["Повар"]);
    expect(prisma.searchKeyword.upsert).toHaveBeenCalledWith({ where: { profileId_value: { profileId: 1, value: "Повар" } }, create: { profileId: 1, value: "Повар", enabled: true }, update: { enabled: true } });
  });
});
