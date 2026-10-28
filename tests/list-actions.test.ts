import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as bulk } from "@/app/api/vacancies/bulk/route";
import { DELETE as deleteLogs } from "@/app/api/logs/route";
import { prisma } from "@/lib/prisma";
import { hhRunner, type RunnerState } from "@/lib/hh/runner";

vi.mock("@/lib/profiles", () => ({ activeProfileId: vi.fn(async () => 1), profileChangePending: () => false, profileMatches: async () => true }));
vi.mock("@/lib/prisma", () => ({ prisma: { vacancy: { updateMany: vi.fn(), deleteMany: vi.fn() }, log: { deleteMany: vi.fn() } } }));
vi.mock("@/lib/hh/runner", () => ({ hhRunner: { supportsVerifiedResumes: true, getState: vi.fn(), startAutoApply: vi.fn(), supportsSelectedVacancies: true } }));
vi.mock("@/lib/log", () => ({ writeLog: vi.fn() }));
const state = { running: false } as RunnerState;
const request = (url: string, body: unknown) => new Request("http://localhost:3000" + url, { method: "POST", body: JSON.stringify(body) });

describe("bulk actions with explicit row identities", () => {
  beforeEach(() => {
    vi.resetAllMocks(); vi.mocked(hhRunner.getState).mockReturnValue(state);
    vi.mocked(prisma.vacancy.updateMany).mockResolvedValue({ count: 2 });
    vi.mocked(prisma.vacancy.deleteMany).mockResolvedValue({ count: 2 });
    vi.mocked(prisma.log.deleteMany).mockResolvedValue({ count: 2 });
  });
  it("updates only selected non-applied vacancies", async () => {
    expect((await bulk(request("/api/vacancies/bulk", { action: "skip", ids: [1, 2] }))).status).toBe(200);
    expect(prisma.vacancy.updateMany).toHaveBeenCalledWith({ where: { profileId: 1, id: { in: [1, 2] }, status: { not: "applied" } }, data: { status: "skipped" } });
  });
  it("requeues selected jobs without deleting application history", async () => {
    await bulk(request("/api/vacancies/bulk", { action: "queue", ids: [3] }));
    expect(prisma.vacancy.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "pending" } }));
    expect(prisma.vacancy.deleteMany).not.toHaveBeenCalled();
  });
  it("launches only the explicit selected ids", async () => {
    await bulk(request("/api/vacancies/bulk", { action: "apply", ids: [2, 4] }));
    expect(hhRunner.startAutoApply).toHaveBeenCalledWith({ limit: 2, vacancyIds: [2, 4] });
  });
  it("does not interpret an empty selection or invalid action as delete all", async () => {
    for (const body of [null, {}, { action: "delete", ids: [] }, { action: "delete", ids: ["1"] }, { action: "all", ids: [1] }]) expect((await bulk(request("/api/vacancies/bulk", body))).status).toBe(400);
    expect(prisma.vacancy.deleteMany).not.toHaveBeenCalled();
  });
  it("does not send a selected launch to a legacy runner that ignores ids", async () => {
    Object.assign(hhRunner, { supportsSelectedVacancies: false });
    try {
      expect((await bulk(request("/api/vacancies/bulk", { action: "apply", ids: [1] }))).status).toBe(409);
      expect(hhRunner.startAutoApply).not.toHaveBeenCalled();
    } finally { Object.assign(hhRunner, { supportsSelectedVacancies: true }); }
  });
  it("refuses queue mutations during automation", async () => {
    vi.mocked(hhRunner.getState).mockReturnValue({ ...state, running: true });
    expect((await bulk(request("/api/vacancies/bulk", { action: "delete", ids: [1] }))).status).toBe(409);
    expect(prisma.vacancy.deleteMany).not.toHaveBeenCalled();
  });
  it("deletes precisely selected logs", async () => {
    await deleteLogs(request("/api/logs", { ids: [11, 12] }));
    expect(prisma.log.deleteMany).toHaveBeenCalledWith({ where: { profileId: 1, id: { in: [11, 12] } } });
  });
  it("clears matching logs without widening their filter", async () => {
    await deleteLogs(request("/api/logs", { allMatching: true, filters: { level: "error", q: "таймаут", period: "today" } }));
    expect(prisma.log.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ level: "error", createdAt: expect.any(Object), OR: expect.any(Array) }) });
  });
  it("requires explicit filtered clearing and rejects invalid scopes", async () => {
    for (const body of [{}, { ids: [] }, { allMatching: true, filters: { level: "invalid" } }, { allMatching: true, filters: { period: "invalid" } }]) expect((await deleteLogs(request("/api/logs", body))).status).toBe(400);
    expect(prisma.log.deleteMany).not.toHaveBeenCalled();
  });
});
