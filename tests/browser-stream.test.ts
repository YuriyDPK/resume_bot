import { afterEach, describe, expect, it, vi } from "vitest";
import { HHBrowserSession } from "@/lib/hh/browser-session";

vi.mock("@/lib/log", () => ({ writeLog: vi.fn() }));

describe("live HH browser frames", () => {
  const session = new HHBrowserSession();
  afterEach(async () => { await session.close(); });
  it("streams changing frames for the selected page and stops on cancellation", async () => {
    const page = await session.ensureBrowser();
    await page.setContent('<div id="value">Первый кадр</div>');
    const pageId = session.getBrowserView().pageId!;
    const abort = new AbortController();
    expect(await session.streamBrowserFrames("stale-page", abort.signal)).toBeNull();
    const stream = await session.streamBrowserFrames(pageId, abort.signal);
    expect(stream).not.toBeNull();
    const reader = stream!.getReader();
    const decode = new TextDecoder();
    const frame = async () => {
      for (let i = 0; i < 10; i++) {
        const item = await reader.read();
        if (item.done) throw new Error("stream ended before a frame");
        const line = decode.decode(item.value);
        if (line.startsWith("data: ")) return JSON.parse(line.slice(6)) as { pageId: string; image: string };
      }
      throw new Error("no frame received");
    };
    const first = await frame();
    expect(first.pageId).toBe(pageId);
    expect(first.image.length).toBeGreaterThan(100);
    await page.locator("#value").evaluate((element) => { element.textContent = "Второй кадр"; element.style.background = "red"; });
    const second = await frame();
    expect(second.image).not.toBe(first.image);
    abort.abort();
    expect((await reader.read()).done).toBe(true);
  }, 15000);
});
