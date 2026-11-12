import { afterEach, describe, expect, it, vi } from "vitest";
import { foreignRequest } from "@/lib/request-origin";

describe("request origin behind HTTPS proxy", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("accepts only the configured public origin while retaining cross-site protection", () => {
    vi.stubEnv("APP_PUBLIC_ORIGIN", "https://bot.example");
    expect(foreignRequest(new Request("http://localhost:3013/", { headers: { origin: "https://bot.example" } }))).toBe(false);
    expect(foreignRequest(new Request("http://localhost:3013/", { headers: { origin: "https://evil.example" } }))).toBe(true);
    expect(foreignRequest(new Request("http://localhost:3013/", { headers: { origin: "https://bot.example", "sec-fetch-site": "cross-site" } }))).toBe(true);
  });
});
