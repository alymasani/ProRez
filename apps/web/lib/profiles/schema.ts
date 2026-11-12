/**
 * Server-side parsing for profile mutations. Input from the network is
 * untrusted, so it is parsed strictly:
 * - unknown fields (e.g. a criterion this version does not support) are
 *   REJECTED with an explicit error, never silently dropped;
 * - every enum value is checked against the supported vocabulary;
 * - keyword lists are trimmed and de-duplicated;
 * - then the shared semantic rules in draft.ts are applied.
 */
import { z } from "zod";
import {
  AUTOMATION_MODES,
  DISCIPLINES,
  DURATION_REQUIREMENTS,
  EXPERIENCE_LEVELS,
  JOB_TYPES,
  NOTIFICATION_CADENCES,
  PROVINCES,
  WORK_ARRANGEMENTS,
  type SearchProfileDraft,
} from "../types";
import { PROFILE_LIMITS, validateProfileDraft, type ProfileDraftErrors } from "./draft";

const keywordList = z
  .array(z.string().max(PROFILE_LIMITS.keywordMax * 2))
  .max(PROFILE_LIMITS.keywordsPerList * 2)
  .transform((list) => {
    const seen = new Set<string>();
    return list
      .map((k) => k.trim().replace(/\s+/g, " "))
      .filter((k) => k !== "" && !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()));
  });

const uniqueEnumList = <T extends readonly [string, ...string[]]>(values: T) =>
  z.array(z.enum(values)).transform((list) => Array.from(new Set(list)));

const criteriaSchema = z.strictObject({
  titleKeywords: keywordList,
  excludedTitleKeywords: keywordList,
  includeKeywords: keywordList,
  excludeKeywords: keywordList,
  disciplines: uniqueEnumList(DISCIPLINES),
  jobTypes: uniqueEnumList(JOB_TYPES),
  durations: uniqueEnumList(DURATION_REQUIREMENTS),
  provinces: uniqueEnumList(PROVINCES),
  arrangements: uniqueEnumList(WORK_ARRANGEMENTS),
  includeRemoteCanadaWide: z.boolean(),
  experienceLevels: uniqueEnumList(EXPERIENCE_LEVELS),
  maxYearsExperience: z.number().int().nullable(),
});

export const profileDraftSchema = z.strictObject({
  name: z.string().transform((s) => s.trim()),
  description: z.string().transform((s) => s.trim()),
  enabled: z.boolean(),
  criteria: criteriaSchema,
  minFitScore: z.number(),
  notifications: z.strictObject({
    enabled: z.boolean(),
    channel: z.literal("telegram"),
    cadence: z.enum(NOTIFICATION_CADENCES),
  }),
  automationMode: z.enum(AUTOMATION_MODES),
});

export type ParseProfileResult =
  | { ok: true; draft: SearchProfileDraft }
  | { ok: false; fieldErrors: ProfileDraftErrors; formErrors: string[] };

export function parseProfileDraft(input: unknown): ParseProfileResult {
  const parsed = profileDraftSchema.safeParse(input);
  if (!parsed.success) {
    const formErrors = parsed.error.issues.map((issue) => {
      const path = issue.path.join(".") || "profile";
      if (issue.code === "unrecognized_keys") {
        return `Unsupported setting${issue.keys.length > 1 ? "s" : ""} in ${path}: ${issue.keys.join(", ")}. Nothing was saved.`;
      }
      return `${path}: ${issue.message}`;
    });
    return { ok: false, fieldErrors: {}, formErrors };
  }

  const draft = parsed.data satisfies SearchProfileDraft;
  const fieldErrors = validateProfileDraft(draft);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, formErrors: [] };
  return { ok: true, draft };
}
