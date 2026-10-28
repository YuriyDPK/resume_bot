export function normalizeHHResumeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || !/(^|\.)hh\.ru$/i.test(url.hostname) || !/^\/resume\/[a-z0-9_-]+\/?$/i.test(url.pathname)) return null;
    url.hash = "";
    return url.toString();
  } catch { return null; }
}
