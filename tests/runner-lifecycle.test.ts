import { afterEach, describe, expect, it, vi } from "vitest";
import { getHHRunner, HHRunner, hhRunner } from "@/lib/hh/runner";

const state = globalThis as unknown as { hhRunner?: HHRunner };
const previous = state.hhRunner;
afterEach(() => { state.hhRunner = previous; });

describe("safe runtime updates", () => {
  it("keeps the exact running instance and manual page through an update", () => {
    const legacy = { getState: () => ({ running: true }), getBrowserView: vi.fn(() => ({ available: true })) } as unknown as HHRunner;
    state.hhRunner = legacy;
    expect(getHHRunner()).toBe(legacy);
    expect(hhRunner.getState().running).toBe(true);
    expect(legacy.getBrowserView).not.toHaveBeenCalled();
  });
  it("preserves a recoverable login page even after its task stopped", () => {
    const legacy = { getState: () => ({ running: false }), getBrowserView: () => ({ available: true }) } as unknown as HHRunner;
    state.hhRunner = legacy;
    expect(getHHRunner()).toBe(legacy);
  });
  it("replaces stale code once the previous task and browser are finished", () => {
    state.hhRunner = { getState: () => ({ running: false }), getBrowserView: () => ({ available: false }) } as unknown as HHRunner;
    const fresh = getHHRunner();
    expect(fresh).toBeInstanceOf(HHRunner);
    expect(fresh.supportsSelectedVacancies).toBe(true);
    expect(getHHRunner()).toBe(fresh);
    expect(hhRunner.getState()).toMatchObject({ running: false, mode: "idle" });
  });
});
