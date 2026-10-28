import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, DELETE } from "@/app/api/auth/hh/route";
import { getHHAccount } from "@/lib/hh/account";
import { hhRunner, type RunnerState } from "@/lib/hh/runner";
vi.mock("@/lib/hh/account", () => ({ getHHAccount: vi.fn() }));
vi.mock("@/lib/hh/runner", () => ({ hhRunner: { getState: vi.fn(), logout: vi.fn() } }));
describe("HH profile and sign out", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.mocked(hhRunner.getState).mockReturnValue({ running: false } as RunnerState); });
  it("returns a verified profile without exposing auth storage", async () => {
    const account = { status: "connected" as const, name: "Тестовый пользователь", profileUrl: "https://hh.ru/applicant/profile/me", checkedAt: "2026-10-28T10:00:00Z" };
    vi.mocked(getHHAccount).mockResolvedValue(account);
    const response = await GET(new Request("http://localhost:3000/api/auth/hh"));
    expect((await response.json()).account).toEqual(account);
    expect(getHHAccount).toHaveBeenCalledWith(true, false);
    expect(response.headers.get("cache-control")).toContain("private");
  });
  it("does not launch a background verification during an active job", async () => {
    vi.mocked(hhRunner.getState).mockReturnValue({ running: true } as RunnerState);
    await GET(new Request("http://localhost:3000/api/auth/hh"));
    expect(getHHAccount).toHaveBeenCalledWith(false, false);
  });
  it("uses the runner's coordinated logout", async () => {
    expect((await DELETE(new Request("http://localhost:3000/api/auth/hh", { method: "DELETE" }))).status).toBe(200);
    expect(hhRunner.logout).toHaveBeenCalledTimes(1);
  });
  it("leaves the account untouched if a job refuses logout", async () => {
    vi.mocked(hhRunner.logout).mockRejectedValue(new Error("Уже запущен процесс"));
    expect((await DELETE(new Request("http://localhost:3000/api/auth/hh", { method: "DELETE" }))).status).toBe(409);
  });
});
