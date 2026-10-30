import { describe, expect, it } from "vitest";
import { exportSettings, importSettings, type TransferSettings } from "@/lib/settings-transfer";

const settings: TransferSettings = {
  keywords: "Директор\nРуководитель", city: "Москва", minSalary: 150000,
  coverLetterTemplate: "Здравствуйте", resumeText: "Опыт управления", resumeUrl: "https://hh.ru/resume/test",
  excludedWords: "менеджер", excludedDescriptionWords: "вахта", dailyLimit: 10, searchLimit: 50,
  searchAllRussia: false, remoteOnly: false, searchDelayMinSeconds: 1, searchDelayMaxSeconds: 3,
  applyDelayMinSeconds: 3, applyDelayMaxSeconds: 8
};

describe("settings file", () => {
  it("round-trips every editable setting and omits account and queue data", () => {
    const serialized = exportSettings({ ...settings, hhAccountId: "private", activeSearchBatchId: "batch" } as TransferSettings);
    expect(importSettings(serialized)).toEqual(settings);
    expect(serialized).not.toContain("hhAccountId");
    expect(serialized).not.toContain("activeSearchBatchId");
  });
  it("rejects corrupted, incomplete and incompatible files", () => {
    expect(() => importSettings("{" )).toThrow();
    expect(() => importSettings(JSON.stringify({ format: "hh-bot-settings", version: 2, settings }))).toThrow();
    expect(() => importSettings(JSON.stringify({ format: "hh-bot-settings", version: 1, settings: { ...settings, remoteOnly: "false" } }))).toThrow();
    expect(() => importSettings(JSON.stringify({ format: "hh-bot-settings", version: 1, settings: { ...settings, searchLimit: 1001 } }))).toThrow();
  });
});
