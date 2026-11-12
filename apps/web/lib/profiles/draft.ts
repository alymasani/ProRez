/**
 * Pure helpers for the search-profile form. `validateProfileDraft` runs in the
 * browser for instant feedback AND on the server (lib/profiles/schema.ts)
 * after strict structural parsing, so both sides apply identical rules.
 */
import type { AppSettings, SearchProfile, SearchProfileDraft } from "../types";

export const PROFILE_LIMITS = {
  nameMax: 60,
  descriptionMax: 500,
  keywordMax: 100,
  keywordsPerList: 50,
  maxYears: 15,
} as const;

export type ProfileDraftField =
  | "name"
  | "description"
  | "jobTypes"
  | "durations"
  | "minFitScore"
  | "maxYearsExperience"
  | "titleKeywords"
  | "excludedTitleKeywords"
  | "includeKeywords"
  | "excludeKeywords";

export type ProfileDraftErrors = Partial<Record<ProfileDraftField, string>>;

export function emptyProfileDraft(): SearchProfileDraft {
  return {
    name: "",
    description: "",
    enabled: true,
    criteria: {
      titleKeywords: [],
      excludedTitleKeywords: [],
      includeKeywords: [],
      excludeKeywords: [],
      disciplines: [],
      jobTypes: [],
      durations: [],
      provinces: [],
      arrangements: [],
      includeRemoteCanadaWide: true,
      experienceLevels: [],
      maxYearsExperience: null,
    },
    minFitScore: 70,
    notifications: { enabled: true, channel: "telegram", cadence: "immediate" },
    automationMode: "approval_required",
  };
}

/** A new profile pre-filled from the saved default settings (Settings page). */
export function draftFromSettings(settings: AppSettings): SearchProfileDraft {
  const draft = emptyProfileDraft();
  const s = settings.search;
  const termTypes = s.jobTypes.length === 0 || s.jobTypes.includes("internship") || s.jobTypes.includes("co_op");
  return {
    ...draft,
    criteria: {
      ...draft.criteria,
      provinces: [...s.provinces],
      arrangements: [...s.arrangements],
      jobTypes: [...s.jobTypes],
      durations: termTypes ? [...s.durations] : [],
      disciplines: [...s.disciplines],
      includeRemoteCanadaWide: s.includeRemoteCanadaWide,
    },
    notifications: { ...draft.notifications, cadence: settings.notifications.defaultCadence },
    automationMode: settings.workflow.defaultAutomationMode,
  };
}

/** Deep copy so editing a draft never mutates the source profile. */
export function draftFromProfile(profile: SearchProfile): SearchProfileDraft {
  const c = profile.criteria;
  return {
    name: profile.name,
    description: profile.description,
    enabled: profile.enabled,
    criteria: {
      ...c,
      titleKeywords: [...c.titleKeywords],
      excludedTitleKeywords: [...c.excludedTitleKeywords],
      includeKeywords: [...c.includeKeywords],
      excludeKeywords: [...c.excludeKeywords],
      disciplines: [...c.disciplines],
      jobTypes: [...c.jobTypes],
      durations: [...c.durations],
      provinces: [...c.provinces],
      arrangements: [...c.arrangements],
      experienceLevels: [...c.experienceLevels],
    },
    minFitScore: profile.minFitScore,
    notifications: { ...profile.notifications },
    automationMode: profile.automationMode,
  };
}

/** Whether the duration criterion applies (only internships and co-ops have terms). */
export function durationApplies(draft: SearchProfileDraft): boolean {
  const types = draft.criteria.jobTypes;
  return types.length === 0 || types.includes("internship") || types.includes("co_op");
}

/** "software, developer , ,engineer" → ["software", "developer", "engineer"] (deduped, case-insensitive). */
export function parseKeywordList(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim().replace(/\s+/g, " ");
    const key = value.toLowerCase();
    if (value && !seen.has(key)) {
      seen.add(key);
      result.push(value);
    }
  }
  return result;
}

function overlap(a: readonly string[], b: readonly string[]): string | undefined {
  const lower = new Set(a.map((k) => k.toLowerCase()));
  return b.find((k) => lower.has(k.toLowerCase()));
}

function keywordListError(list: readonly string[]): string | undefined {
  if (list.length > PROFILE_LIMITS.keywordsPerList) return `Use at most ${PROFILE_LIMITS.keywordsPerList} keywords.`;
  const tooLong = list.find((k) => k.length > PROFILE_LIMITS.keywordMax);
  if (tooLong) return `Keywords must be ${PROFILE_LIMITS.keywordMax} characters or fewer.`;
  return undefined;
}

export function validateProfileDraft(draft: SearchProfileDraft): ProfileDraftErrors {
  const errors: ProfileDraftErrors = {};
  const c = draft.criteria;

  const name = draft.name.trim();
  if (!name) errors.name = "Give this profile a name.";
  else if (name.length > PROFILE_LIMITS.nameMax) errors.name = `Keep the name under ${PROFILE_LIMITS.nameMax} characters.`;

  if (draft.description.length > PROFILE_LIMITS.descriptionMax) {
    errors.description = `Keep the description under ${PROFILE_LIMITS.descriptionMax} characters.`;
  }

  if (c.jobTypes.length === 0) errors.jobTypes = "Select at least one employment type.";

  if (!durationApplies(draft) && c.durations.length > 0) {
    errors.durations = "Durations only apply to internships and co-ops.";
  }

  if (!Number.isInteger(draft.minFitScore) || draft.minFitScore < 0 || draft.minFitScore > 100) {
    errors.minFitScore = "Minimum fit score must be a whole number from 0 to 100.";
  }

  const years = c.maxYearsExperience;
  if (years !== null && (!Number.isInteger(years) || years < 0 || years > PROFILE_LIMITS.maxYears)) {
    errors.maxYearsExperience = `Use a whole number of years from 0 to ${PROFILE_LIMITS.maxYears}, or leave blank.`;
  }

  const lists = {
    titleKeywords: c.titleKeywords,
    excludedTitleKeywords: c.excludedTitleKeywords,
    includeKeywords: c.includeKeywords,
    excludeKeywords: c.excludeKeywords,
  } as const;
  for (const [field, list] of Object.entries(lists) as [keyof typeof lists, string[]][]) {
    const error = keywordListError(list);
    if (error) errors[field] = error;
  }

  const titleConflict = overlap(c.titleKeywords, c.excludedTitleKeywords);
  if (titleConflict) errors.titleKeywords = `"${titleConflict}" is both included and excluded.`;
  const keywordConflict = overlap(c.includeKeywords, c.excludeKeywords);
  if (keywordConflict) errors.includeKeywords = `"${keywordConflict}" is both preferred and excluded.`;

  return errors;
}
