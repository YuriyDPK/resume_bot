import { describe, expect, it } from "vitest";
import { normalizeHHVacancyUrl } from "@/lib/hh/vacancy-url";

describe("HH vacancy URLs", () => {
  it.each([
    "https://hh.ru/vacancy/138929519?from=share_android",
    "https://www.hh.ru/vacancy/138929519/",
    "https://spb.hh.ru/vacancy/138929519?from=search#top",
    "https://nn.hh.ru/vacancy/138929519"
  ])("normalizes %s to the same vacancy", (url) => {
    expect(normalizeHHVacancyUrl(url)).toBe("https://hh.ru/vacancy/138929519");
  });
  it.each([
    "https://hh.ru.evil.example/vacancy/123", "https://evilhh.ru/vacancy/123", "http://spb.hh.ru/vacancy/123",
    "https://user:password@hh.ru/vacancy/123", "https://hh.ru:8443/vacancy/123", "https://hh.ru/vacancy/123abc",
    "https://hh.ru/vacancy/123/other", "https://hh.ru/search/vacancy/123", "/vacancy/123", "not a url"
  ])("rejects unsafe or invalid address %s", (url) => {
    expect(normalizeHHVacancyUrl(url)).toBeNull();
  });
});
