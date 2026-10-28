import { describe, expect, it } from "vitest";
import { dayStart, parseRowIds, periodStart } from "@/lib/list-filters";
import { vacancyFilters, vacancyOrder, vacancyParams, vacancyWhere } from "@/lib/vacancy-query";
import { logFilters, logWhere } from "@/lib/log-query";

describe("list filtering and scoped selection", () => {
  it("uses the Moscow date around midnight regardless of host timezone", () => {
    expect(dayStart(new Date("2026-10-28T22:30:00Z")).toISOString()).toBe("2026-10-28T21:00:00.000Z");
    expect(periodStart("week", new Date("2026-10-28T10:00:00Z"))?.toISOString()).toBe("2026-10-21T21:00:00.000Z");
  });
  it.each([null, [], [0], [-1], ["1"], [NaN], [1.5], Array.from({ length: 201 }, (_, i) => i + 1)])("rejects unsafe bulk scopes: %j", (ids) => expect(parseRowIds(ids)).toBeNull());
  it("deduplicates an explicit selection", () => expect(parseRowIds([4, 2, 4])).toEqual([4, 2]));
  it("round trips all vacancy filters through a shareable URL", () => {
    const filters = vacancyFilters(new URLSearchParams("status=applied&q=бухгалтер&city=Казань&company=Пример&minScore=60&salary=with&sort=newest&page=2&pageSize=50&latest=true&appliedToday=true"));
    expect(vacancyFilters(vacancyParams(filters))).toEqual(filters);
    const where = vacancyWhere(filters, "batch");
    expect(where.AND).toEqual(expect.arrayContaining([{ status: "applied" }, { matchScore: { gte: 60 } }, { searchBatchId: "batch" }, expect.objectContaining({ applications: expect.any(Object) })]));
  });
  it("preserves applied status when a dashboard link requests today's applications", () => {
    const filters = vacancyFilters(new URLSearchParams("status=applied&appliedToday=true"));
    const where = JSON.stringify(vacancyWhere(filters));
    expect(where).toContain('"appliedAt"');
    expect(where).not.toContain('"createdAt"');
  });
  it("defaults to queued jobs and bounds invalid page and score inputs", () => {
    const filters = vacancyFilters(new URLSearchParams("status=invalid&minScore=900&page=-1&pageSize=9999"));
    expect(filters).toMatchObject({ status: "active", minScore: 100, page: 1, pageSize: 25 });
    expect(vacancyWhere(filters).AND).toContainEqual({ status: { in: ["found", "pending"] } });
    expect(vacancyOrder("score")).toEqual([{ matchScore: "desc" }, { id: "desc" }]);
  });
  it("does not silently turn an absent latest search batch into all vacancies", () => {
    expect(vacancyWhere(vacancyFilters(new URLSearchParams("latest=true"))).AND).toContainEqual({ searchBatchId: "__no_active_batch__" });
  });
  it("scopes log searches by level, period and message or metadata", () => {
    const filters = logFilters(new URLSearchParams("q=ошибка&level=error&period=today&sort=asc"));
    expect(filters.sort).toBe("asc");
    expect(logWhere(filters)).toMatchObject({ level: "error", createdAt: { gte: expect.any(Date) }, OR: expect.any(Array) });
  });
});
