import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/resume/parse/route";
import { hhRunner, type RunnerState } from "@/lib/hh/runner";

vi.mock("@/lib/hh/runner", () => ({ hhRunner: { getState: vi.fn(), parseResume: vi.fn() } }));
const url = "http://localhost:3000/api/resume/parse";
const state: RunnerState = { running: false, mode: "idle", stopRequested: false, waitingForCaptcha: false, waitingForUser: false, manualPauseId: 0, message: "Готов", processed: 0, target: 0 };
const request = (body: unknown) => new Request(url, { method: "POST", headers: { origin: "http://localhost:3000" }, body: JSON.stringify(body) });

describe("resume parse preview API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(hhRunner.getState).mockReturnValue(state);
  });
  it("returns the parsed preview for a valid link", async () => {
    const result = { state, parsed: { fields: { keywords: "Повар", city: "Казань" }, notes: [] } };
    vi.mocked(hhRunner.parseResume).mockResolvedValue(result);
    const response = await POST(request({ resumeUrl: "https://hh.ru/resume/test" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(hhRunner.parseResume).toHaveBeenCalledWith("https://hh.ru/resume/test");
  });
  it.each([null, {}, { resumeUrl: "https://foreign.example/resume/test" }, { resumeUrl: "https://hh.ru/vacancy/123" }])("rejects invalid links without starting a browser: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(hhRunner.parseResume).not.toHaveBeenCalled();
  });
  it("does not interrupt a running application job", async () => {
    vi.mocked(hhRunner.getState).mockReturnValue({ ...state, running: true, mode: "auto" });
    expect((await POST(request({ resumeUrl: "https://hh.ru/resume/test" }))).status).toBe(409);
    expect(hhRunner.parseResume).not.toHaveBeenCalled();
  });
  it("rejects foreign origins", async () => {
    const response = await POST(new Request(url, { method: "POST", headers: { origin: "https://foreign.example" }, body: JSON.stringify({ resumeUrl: "https://hh.ru/resume/test" }) }));
    expect(response.status).toBe(403);
    expect(hhRunner.parseResume).not.toHaveBeenCalled();
  });
  it("reports a failed read without supplying fabricated fields", async () => {
    vi.mocked(hhRunner.parseResume).mockRejectedValue(new Error("Нет доступа к резюме"));
    const response = await POST(request({ resumeUrl: "https://hh.ru/resume/test" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Нет доступа к резюме" });
  });
});
