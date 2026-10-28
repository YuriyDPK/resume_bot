import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/hh/browser/route";
import { hhRunner } from "@/lib/hh/runner";

vi.mock("@/lib/hh/runner", () => ({ hhRunner: { getBrowserView: vi.fn(), getBrowserFrame: vi.fn(), sendBrowserInput: vi.fn() } }));
const url = "http://localhost:3000/api/hh/browser";

describe("embedded HH browser API", () => {
  beforeEach(() => vi.resetAllMocks());
  it("returns private JPEG frames paired with the page identity", async () => {
    vi.mocked(hhRunner.getBrowserFrame).mockResolvedValue({ image: Buffer.from("jpeg"), pageId: "current-page" });
    const response = await GET(new Request(url + "?frame=1"));
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-hh-page-id")).toBe("current-page");
    expect(await response.text()).toBe("jpeg");
  });
  it("does not launch a browser to obtain an idle frame", async () => {
    vi.mocked(hhRunner.getBrowserFrame).mockResolvedValue(null);
    expect((await GET(new Request(url + "?frame=1"))).status).toBe(204);
  });
  it("forwards valid human commands with both page and pause identities", async () => {
    const response = await POST(new Request(url, { method: "POST", headers: { origin: "http://localhost:3000" },
      body: JSON.stringify({ pageId: "page", pauseId: 3, input: { type: "pointer", action: "down", x: 12, y: 30 } }) }));
    expect(response.status).toBe(200);
    expect(hhRunner.sendBrowserInput).toHaveBeenCalledWith("page", 3, { type: "pointer", action: "down", x: 12, y: 30 });
  });
  it("rejects cross-site reads, writes, malformed input and missing pause identities", async () => {
    expect((await GET(new Request(url + "?frame=1", { headers: { "sec-fetch-site": "cross-site" } }))).status).toBe(403);
    expect((await POST(new Request(url, { method: "POST", headers: { origin: "https://foreign.example" }, body: "{}" }))).status).toBe(403);
    for (const body of [null, {}, { pageId: "page", input: { type: "continue" } }, { pageId: "page", pauseId: 1, input: { type: "key", key: "Control+R" } }]) {
      expect((await POST(new Request(url, { method: "POST", body: JSON.stringify(body) }))).status).toBe(400);
    }
    expect(hhRunner.getBrowserFrame).not.toHaveBeenCalled();
    expect(hhRunner.sendBrowserInput).not.toHaveBeenCalled();
  });
});
