/**
 * Pure helpers for the search-profile configuration form. Validation only —
 * profile evaluation against jobs is a future milestone.
 */
import type { SearchProfile, SearchProfileDraft } from "../types";

export type ProfileDraftErrors = Partial<
  Record<"name" | "jobTypes" | "durations" | "minFitScore" | "maxYearsExperience" | "titleKeywords", string>
>;

export function emptyProfileDraft(): SearchProfileDraft {
  return {
    name: "",
    description: "",
    enabled: true,
    criteria: {
      titleKeywords: [],
      excludedTitleKeywords: [],
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

export function draftFromProfile(profile: SearchProfile): SearchProfileDraft {
  return {
    name: profile.name,
    description: profile.description,
    enabled: profile.enabled,
    criteria: {
      ...profile.criteria,
      titleKeywords: [...profile.criteria.titleKeywords],
      excludedTitleKeywords: [...profile.criteria.excludedTitleKeywords],
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

export function validateProfileDraft(draft: SearchProfileDraft): ProfileDraftErrors {
  const errors: ProfileDraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = "Give this profile a name.";
  else if (name.length > 60) errors.name = "Keep the name under 60 characters.";

  if (draft.criteria.jobTypes.length === 0) errors.jobTypes = "Select at least one employment type.";

  if (!durationApplies(draft) && draft.criteria.durations.length > 0) {
    errors.durations = "Durations only apply to internships and co-ops.";
  }

  if (!Number.isInteger(draft.minFitScore) || draft.minFitScore < 0 || draft.minFitScore > 100) {
    errors.minFitScore = "Minimum fit score must be a whole number from 0 to 100.";
  }

  const years = draft.criteria.maxYearsExperience;
  if (years !== null && (!Number.isInteger(years) || years < 0 || years > 15)) {
    errors.maxYearsExperience = "Use a whole number of years from 0 to 15, or leave blank.";
  }

  const lowerInclude = new Set(draft.criteria.titleKeywords.map((k) => k.toLowerCase()));
  const overlap = draft.criteria.excludedTitleKeywords.find((k) => lowerInclude.has(k.toLowerCase()));
  if (overlap) errors.titleKeywords = `"${overlap}" is both included and excluded.`;

  return errors;
}
