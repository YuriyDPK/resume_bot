import type { Page } from "playwright";
import { readHHProfile } from "@/lib/hh/account";
import { HHAutomationError } from "@/lib/hh/types";

export function resumeIdFromUrl(value: string | null | undefined) {
  if (!value) return null;
  try { const url = new URL(value, "https://hh.ru"); return /(^|\.)hh\.ru$/i.test(url.hostname) ? url.pathname.match(/^\/resume\/([a-z0-9_-]+)\/?$/i)?.[1].toLowerCase() ?? null : null; }
  catch { return null; }
}

export async function readOwnResumes(page: Page) {
  if (!/^\/applicant\/(?:resumes|profile\/me)\/?$/.test(new URL(page.url()).pathname)) throw new HHAutomationError("auth", "Откройте «Мои резюме» в своём аккаунте HH");
  const account = await readHHProfile(page);
  if (!account?.accountId) throw new HHAutomationError("auth", "HH не подтвердил владельца аккаунта. Выполните вход заново");
  const resumes = await page.evaluate(() => [...document.querySelectorAll<HTMLAnchorElement>('[data-qa="resume"] a[href*="/resume/"], [data-qa^="resume-card-link-"], [data-qa="compact-resume-list"] a[href*="/resume/"]')].map((element) => ({ url: element.href, title: element.innerText.trim() })));
  return { accountId: account.accountId, resumes: resumes.flatMap((resume) => { const id = resumeIdFromUrl(resume.url); return id ? [{ ...resume, id }] : []; }) };
}
