import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import { CaptchaController, parseCaptchaInput } from "@/lib/hh/captcha";

describe("manual CAPTCHA pause", () => {
  let challenge: boolean;
  let controller: CaptchaController;
  const content = vi.fn(async () => "Ответ HH");
  const onChange = vi.fn();
  const page = {
    isClosed: vi.fn(() => false), bringToFront: vi.fn(async () => undefined),
    locator: () => ({ innerText: content }), viewportSize: () => ({ width: 1366, height: 900 }),
    screenshot: vi.fn(async () => Buffer.from("test-png")),
    mouse: { click: vi.fn(), wheel: vi.fn() }, keyboard: { insertText: vi.fn(), press: vi.fn() }
  };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    challenge = true;
    page.isClosed.mockReturnValue(false);
    content.mockResolvedValue("Ответ HH");
    controller = new CaptchaController(async () => challenge);
    controller.setHandler(onChange);
  });
  afterEach(() => vi.useRealTimers());

  it("keeps the exact page and waits without a timeout until the human finishes", async () => {
    const waiting = controller.wait(page as unknown as Page);
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
    expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(await controller.screenshot()).toEqual(Buffer.from("test-png"));
    challenge = false;
    await controller.input({ type: "continue" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await waiting).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(await controller.screenshot()).toBeNull();
  });
  it("does not resume during an empty intermediate document", async () => {
    const waiting = controller.wait(page as unknown as Page);
    await vi.advanceTimersByTimeAsync(500);
    challenge = false;
    content.mockResolvedValue("");
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).not.toHaveBeenCalledWith(false);
    content.mockResolvedValue("Продолжение работы");
    await controller.input({ type: "continue" });
    await vi.advanceTimersByTimeAsync(1000);
    await waiting;
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
  it("supports explicit Stop while waiting", async () => {
    let stop = false;
    const waiting = controller.wait(page as unknown as Page, () => stop);
    await vi.advanceTimersByTimeAsync(500);
    stop = true;
    const result = expect(waiting).rejects.toMatchObject({ code: "stopped" });
    await vi.advanceTimersByTimeAsync(500);
    await result;
    expect(onChange).toHaveBeenLastCalledWith(false);
  });
  it("forwards human input only while the same challenge is active", async () => {
    const waiting = controller.wait(page as unknown as Page);
    await vi.advanceTimersByTimeAsync(500);
    await controller.input({ type: "click", x: 10, y: 20 });
    await controller.input({ type: "text", text: "human input" });
    await controller.input({ type: "key", key: "Enter" });
    expect(page.mouse.click).toHaveBeenCalledWith(10, 20);
    expect(page.keyboard.insertText).toHaveBeenCalledWith("human input");
    expect(page.keyboard.press).toHaveBeenCalledWith("Enter");
    await expect(controller.input({ type: "click", x: 5000, y: 20 })).rejects.toThrow("Координаты");
    challenge = false;
    await controller.input({ type: "continue" });
    await expect(controller.input({ type: "click", x: 10, y: 20 })).rejects.toThrow("завершена");
    expect(page.mouse.click).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    await waiting;
  });
  it("returns immediately when no challenge exists", async () => {
    challenge = false;
    expect(await controller.wait(page as unknown as Page)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("stays paused when the widget disappears for a long time without human confirmation", async () => {
    const waiting = controller.wait(page as unknown as Page);
    await vi.advanceTimersByTimeAsync(500);
    challenge = false;
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    expect(onChange).not.toHaveBeenCalledWith(false);
    challenge = true;
    await expect(controller.input({ type: "continue" })).rejects.toThrow("ещё открыта");
    challenge = false;
    await controller.input({ type: "continue" });
    await vi.advanceTimersByTimeAsync(1000);
    await waiting;
  });
  it("treats a closed verification window as cancellation rather than permission to skip", async () => {
    const waiting = controller.wait(page as unknown as Page);
    await vi.advanceTimersByTimeAsync(500);
    page.isClosed.mockReturnValue(true);
    const result = expect(waiting).rejects.toMatchObject({ code: "stopped" });
    await vi.advanceTimersByTimeAsync(500);
    await result;
  });
  it("can hold an unfamiliar form even without a recognized CAPTCHA marker", async () => {
    challenge = false;
    const waiting = controller.wait(page as unknown as Page, undefined, { reason: "form", message: "Завершите форму" });
    await vi.advanceTimersByTimeAsync(10000);
    expect(onChange).toHaveBeenCalledWith(true, { reason: "form", message: "Завершите форму" });
    expect(onChange).not.toHaveBeenCalledWith(false);
    await controller.input({ type: "continue" });
    await vi.advanceTimersByTimeAsync(1000);
    await waiting;
  });
  it.each([null, {}, { type: "key", key: "Control+A" }, { type: "click", x: -1, y: 2 }, { type: "click", x: Infinity, y: 2 }, { type: "text", text: "" }, { type: "scroll", deltaY: 10000 }])("rejects invalid user input %j", (value) => {
    expect(parseCaptchaInput(value)).toBeNull();
  });
  it("accepts supported human input", () => {
    expect(parseCaptchaInput({ type: "key", key: "Enter" })).toEqual({ type: "key", key: "Enter" });
    expect(parseCaptchaInput({ type: "click", x: 5, y: 6 })).toEqual({ type: "click", x: 5, y: 6 });
    expect(parseCaptchaInput({ type: "text", text: "abc" })).toEqual({ type: "text", text: "abc" });
  });
});
