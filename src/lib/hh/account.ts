import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import { hhConfig } from "@/lib/env";

export type HHAccount = { status: "connected" | "disconnected" | "expired" | "unknown"; name: string; accountId?: string; profileUrl: string; checkedAt: string | null };
const profilePath = hhConfig.storageStatePath.replace(/\.json$/i, "") + ".account.json";
const emptyAccount: HHAccount = { status: "disconnected", name: "", profileUrl: "https://hh.ru/applicant/profile/me", checkedAt: null };
let verification: Promise<HHAccount> | undefined;

async function fingerprint() { return stat(hhConfig.storageStatePath).then((value) => `${value.mtimeMs}:${value.size}`).catch(() => null); }
async function metadata(): Promise<HHAccount | null> {
  try {
    const value = JSON.parse(await readFile(profilePath, "utf8"));
    return ["connected", "expired", "unknown"].includes(value?.status) && typeof value.name === "string" ? { ...emptyAccount, ...value, profileUrl: emptyAccount.profileUrl } : null;
  } catch { return null; }
}
export async function saveHHAccount(account: Pick<HHAccount, "name" | "accountId"> & { status?: HHAccount["status"] }) {
  const result: HHAccount = { ...emptyAccount, status: account.status ?? "connected", name: account.name.slice(0, 150), ...(account.accountId ? { accountId: account.accountId } : {}), checkedAt: new Date().toISOString() };
  await mkdir(path.dirname(profilePath), { recursive: true });
  const temporary = profilePath + "." + randomUUID() + ".tmp";
  await writeFile(temporary, JSON.stringify(result), { mode: 0o600 });
  await rename(temporary, profilePath);
  return result;
}
export async function expireHHAccount() {
  const previous = await metadata();
  if (previous?.status === "expired") return;
  await saveHHAccount({ status: "expired", name: previous?.name ?? "" });
}
export async function clearHHAccount() {
  await rm(hhConfig.storageStatePath, { force: true });
  await rm(profilePath, { force: true });
}

export async function readHHProfile(page: Page): Promise<{ name: string; accountId?: string } | null> {
  try {
    return await page.evaluate(() => {
      const visible = (element: Element) => element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
      if (!/(^|\.)hh\.ru$/.test(location.hostname) || /captcha|\/account\/login|\/auth\b/i.test(location.pathname) || [...document.querySelectorAll('[data-qa="captcha"], form[action*="captcha"], [data-qa="login"]')].some(visible)) return null;
      const protectedPage = /^\/applicant\/(?:profile\/me|resumes)\/?$/.test(location.pathname);
      const heading = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].some((element) => visible(element) && element.textContent?.trim() === "Мои резюме");
      const control = [...document.querySelectorAll('[data-qa="mainmenu_applicantProfile"], [data-qa="mainmenu_applicantProfileName"], [data-qa="mainmenu_logout"], a[href*="/account/logout"]')].some(visible);
      if (!control && !(protectedPage && heading)) return null;
      const raw = document.querySelector('[data-qa="mainmenu_applicantProfileName"]')?.textContent?.trim() || (protectedPage ? document.querySelector("h1")?.textContent?.trim() : "");
      const vars = (window as unknown as { globalVars?: { hhid?: string | number } }).globalVars;
      const id = vars?.hhid === undefined ? "" : String(vars.hhid);
      return { name: raw && !/^(?:мои резюме|резюме и профиль|профиль)$/i.test(raw) ? raw : "Аккаунт HH", ...(/^[a-z0-9_-]{1,100}$/i.test(id) ? { accountId: id } : {}) };
    });
  } catch { return null; }
}

export async function getHHAccount(allowVerify = false, force = false): Promise<HHAccount> {
  const stamp = await fingerprint();
  if (!stamp) return { ...emptyAccount };
  const cached = await metadata();
  if (!allowVerify || (!force && cached?.checkedAt && Date.now() - Date.parse(cached.checkedAt) < 5 * 60_000)) return cached ?? { ...emptyAccount, status: "unknown" };
  if (verification) return verification;
  verification = (async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ storageState: hhConfig.storageStatePath, locale: "ru-RU" });
      const page = await context.newPage();
      await page.goto("https://hh.ru/applicant/resumes", { waitUntil: "domcontentloaded", timeout: 15000 });
      let profile = await readHHProfile(page);
      for (let check = 0; !profile && check < 6; check += 1) {
        await page.waitForTimeout(400);
        profile = await readHHProfile(page);
      }
      if (await fingerprint() !== stamp) return (await metadata()) ?? { ...emptyAccount };
      if (profile) return saveHHAccount(profile);
      const login = /\/account\/login/.test(page.url()) || await page.locator('[data-qa="login"]').first().isVisible().catch(() => false);
      return saveHHAccount({ status: login ? "expired" : "unknown", name: cached?.name ?? "" });
    } catch {
      if (await fingerprint() !== stamp) return (await metadata()) ?? { ...emptyAccount };
      return saveHHAccount({ status: "unknown", name: cached?.name ?? "" });
    } finally { await browser.close(); }
  })();
  try { return await verification; } finally { verification = undefined; }
}
