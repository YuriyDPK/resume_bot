/** Use a single HH URL for the same vacancy regardless of the regional HH host. */
export function normalizeHHVacancyUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port || !/(^|\.)hh\.ru$/i.test(url.hostname)) return null;
    const match = url.pathname.match(/^\/vacancy\/(\d+)\/?$/);
    return match ? `https://hh.ru/vacancy/${match[1]}` : null;
  } catch { return null; }
}
