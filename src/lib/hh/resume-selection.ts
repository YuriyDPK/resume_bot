import { queryMatchesText, searchTerms } from "@/lib/text";
import type { FilterableVacancy } from "@/lib/vacancy-filter";

export type ResumeCandidate = { title: string; id?: string; disabled?: boolean };

export function rankResumes<T extends ResumeCandidate>(vacancy: FilterableVacancy, candidates: T[], preferredResumeUrl?: string | null, requirePreferred = false) {
  const titleTerms = new Set(searchTerms(vacancy.title));
  const descriptionTerms = new Set(searchTerms(vacancy.description));
  const preferredId = preferredResumeUrl?.match(/\/resume\/([a-z0-9_-]+)/i)?.[1];

  return candidates.filter((candidate) => !candidate.disabled && (!requirePreferred || Boolean(preferredId && candidate.id === preferredId))).map((candidate, index) => {
    const candidateTerms = searchTerms(candidate.title);
    const titleMatches = candidateTerms.filter((term) => titleTerms.has(term)).length;
    const descriptionMatches = candidateTerms.filter((term) => !titleTerms.has(term) && descriptionTerms.has(term)).length;
    // The same scoring applies to every profession. Titles and specialties dominate
    // incidental description mentions, including single-letter driver categories.
    let score = titleMatches * 25 + Math.min(15, descriptionMatches * 3);
    if (queryMatchesText(candidate.title, vacancy.title)) score += 20;
    if (candidateTerms.length > 0 && titleMatches > 0) score += Math.round(titleMatches / candidateTerms.length * 10);
    const preferred = Boolean(preferredId && candidate.id === preferredId);
    return { candidate, score, preferred, index };
  }).sort((a, b) => b.score - a.score || Number(b.preferred) - Number(a.preferred) || a.index - b.index);
}
