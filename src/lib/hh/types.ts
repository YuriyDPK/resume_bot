export type StopSignal = () => boolean;
export type DelayRange = { minSeconds: number; maxSeconds: number };

export type ScrapedVacancy = {
  externalId?: string | null;
  title: string;
  company: string;
  salary?: string | null;
  city?: string | null;
  url: string;
  description?: string | null;
  alreadyApplied?: boolean;
};

export type SearchPageProgress = {
  keyword: string;
  page: number;
  scraped: number;
  accepted: number;
  skippedKnown: number;
  skippedCity: number;
  skippedInvalid: number;
  skippedRejected: number;
};

export type ApplyToVacancyResult = {
  alreadyApplied: boolean;
  selectedResume?: string;
  coverLetterDelivery: "form" | "after-apply" | "chat" | "none";
  warning?: string;
};

export type ApplyOptions = {
  excludedWords: string[];
  preferredResumeUrl?: string | null;
  requirePreferredResume?: boolean;
  preferredResumeTitle?: string;
  allowTitleMatch?: boolean;
  expectedAccountId?: string;
  skipAdditionalRequirements?: boolean;
};

export type AutoApplyOptions = { limit: number; skipAdditionalRequirements?: boolean; vacancyIds?: number[] };

export type HHAutomationErrorCode = "captcha" | "auth" | "access" | "stopped" | "apply" | "browser" | "excluded" | "archived" | "unavailable" | "requirements" | "resume";

export class HHAutomationError extends Error {
  constructor(public code: HHAutomationErrorCode, message: string) {
    super(message);
    this.name = "HHAutomationError";
  }
}
