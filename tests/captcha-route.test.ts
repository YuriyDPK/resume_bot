import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/hh/captcha/route";
import { hhRunner } from "@/lib/hh/runner";

vi.mock("@/lib/hh/runner", () => ({ hhRunner: { getCaptchaScreenshot: vi.fn(), sendCaptchaInput: vi.fn() } }));

describe("local manual CAPTCHA API", () => {
  beforeEach(() => vi.resetAllMocks());
  it("returns the current image without caching it", async () => {
    vi.mocked(hhRunner.getCaptchaScreenshot).mockResolvedValue(Buffer.from("png"));
    const response = await GET();
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.text()).toBe("png");
  });
  it("reports no active challenge", async () => {
    vi.mocked(hhRunner.getCaptchaScreenshot).mockResolvedValue(null);
    expect((await GET()).status).toBe(409);
  });
  it("passes through the human's action", async () => {
    const response = await POST(new Request("http://localhost:3000/api/hh/captcha", {
      method: "POST", body: JSON.stringify({ type: "click", x: 25, y: 30 }), headers: { origin: "http://localhost:3000" }
    }));
    expect(response.status).toBe(200);
    expect(hhRunner.sendCaptchaInput).toHaveBeenCalledWith({ type: "click", x: 25, y: 30 });
  });
  it("rejects foreign origins and invalid commands without touching the browser", async () => {
    expect((await POST(new Request("http://localhost:3000/api/hh/captcha", { method: "POST", headers: { origin: "https://foreign.example" }, body: "{}" }))).status).toBe(403);
    expect((await POST(new Request("http://localhost:3000/api/hh/captcha", { method: "POST", body: JSON.stringify({ type: "key", key: "Control+R" }) }))).status).toBe(400);
    expect(hhRunner.sendCaptchaInput).not.toHaveBeenCalled();
  });
});
