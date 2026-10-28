import type { Page } from "playwright";

export const browserKeys = ["Enter", "Tab", "Shift+Tab", "Backspace", "Delete", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "SelectAll"] as const;
export type BrowserInput =
  | { type: "click"; x: number; y: number }
  | { type: "pointer"; action: "down" | "move" | "up"; x: number; y: number }
  | { type: "text"; text: string }
  | { type: "key"; key: typeof browserKeys[number] }
  | { type: "scroll"; deltaY: number };

export function parseBrowserInput(value: unknown): BrowserInput | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if ((input.type === "click" || input.type === "pointer") && typeof input.x === "number" && Number.isFinite(input.x) && input.x >= 0 &&
    typeof input.y === "number" && Number.isFinite(input.y) && input.y >= 0) {
    if (input.type === "click") return { type: "click", x: input.x, y: input.y };
    if (input.action === "down" || input.action === "move" || input.action === "up") return { type: "pointer", action: input.action, x: input.x, y: input.y };
  }
  if (input.type === "text" && typeof input.text === "string" && input.text.length > 0 && input.text.length <= 500) return { type: "text", text: input.text };
  if (input.type === "key" && browserKeys.includes(input.key as typeof browserKeys[number])) return { type: "key", key: input.key as typeof browserKeys[number] };
  if (input.type === "scroll" && typeof input.deltaY === "number" && Number.isFinite(input.deltaY) && Math.abs(input.deltaY) <= 600) return { type: "scroll", deltaY: input.deltaY };
  return null;
}

export async function forwardBrowserInput(page: Page, input: BrowserInput) {
  if (input.type === "click" || input.type === "pointer") {
    const viewport = page.viewportSize();
    if (!viewport || input.x >= viewport.width || input.y >= viewport.height) throw new Error("Координаты за пределами страницы HH");
    if (input.type === "click") await page.mouse.click(input.x, input.y);
    else {
      await page.mouse.move(input.x, input.y);
      if (input.action === "down") await page.mouse.down();
      if (input.action === "up") await page.mouse.up();
    }
  } else if (input.type === "text") await page.keyboard.insertText(input.text);
  else if (input.type === "key") await page.keyboard.press(input.key === "SelectAll" ? process.platform === "darwin" ? "Meta+A" : "Control+A" : input.key);
  else if (input.type === "scroll") await page.mouse.wheel(0, input.deltaY);
}
