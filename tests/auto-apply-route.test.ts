import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auto-apply/route";
import { hhRunner } from "@/lib/hh/runner";

vi.mock("@/lib/hh/runner", () => ({ hhRunner: { supportsVerifiedResumes: true, startAutoApply: vi.fn(), getState: vi.fn(), stop: vi.fn() } }));
const request = (body: unknown) => new Request("http://localhost:3000/api/auto-apply", { method: "POST", body: JSON.stringify(body) });

describe("auto-apply launch options", () => {
  beforeEach(() => vi.resetAllMocks());
  it.each([true, false])("passes the selected additional requirements policy: %s", async (skipAdditionalRequirements) => {
    expect((await POST(request({ action: "start", limit: 10, skipAdditionalRequirements }))).status).toBe(200);
    expect(hhRunner.startAutoApply).toHaveBeenCalledWith({ limit: 10, skipAdditionalRequirements });
  });
  it("defaults to manual waiting when the option was omitted", async () => {
    expect((await POST(request({ action: "start", limit: 5 }))).status).toBe(200);
    expect(hhRunner.startAutoApply).toHaveBeenCalledWith({ limit: 5, skipAdditionalRequirements: false });
  });
  it.each(["true", "false", 1, null])("rejects an invalid checkbox value: %s", async (skipAdditionalRequirements) => {
    expect((await POST(request({ action: "start", limit: 5, skipAdditionalRequirements }))).status).toBe(400);
    expect(hhRunner.startAutoApply).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { action: "start", limit: 0 }])("rejects malformed launch requests: %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(hhRunner.startAutoApply).not.toHaveBeenCalled();
  });
  it("still accepts Stop without a launch option", async () => {
    expect((await POST(request({ action: "stop" }))).status).toBe(200);
    expect(hhRunner.stop).toHaveBeenCalledTimes(1);
  });
});
