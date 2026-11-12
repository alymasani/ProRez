/**
 * Server-side parsing for job mutations. Input is untrusted: unknown fields
 * are rejected (never silently dropped), sizes are bounded before any
 * processing, and then the shared rules in manual-submission.ts are applied.
 */
import { z } from "zod";
import { DISCIPLINES } from "../types";
import { MANUAL_JOB_LIMITS, validateManualJob, type ManualJob, type ManualJobErrors } from "./manual-submission";
import { JOB_URL_MAX_LENGTH } from "./url";

const text = (max: number) => z.string().max(max);

export const manualJobInputSchema = z.strictObject({
  jobUrl: text(JOB_URL_MAX_LENGTH * 2),
  description: text(MANUAL_JOB_LIMITS.descriptionMax * 2),
  company: text(1000),
  title: text(1000),
  city: text(1000),
  province: text(10),
  arrangement: text(20),
  jobType: text(30),
  durationMonths: text(20),
  term: text(500),
  experienceRequirement: text(2000),
  disciplines: z.array(z.enum(DISCIPLINES)).max(DISCIPLINES.length * 2),
  salaryMin: text(30),
  salaryMax: text(30),
  salaryCurrency: text(10),
  salaryPeriod: text(10),
  notes: text(MANUAL_JOB_LIMITS.notesMax * 2),
});

export type ParseJobResult =
  | { ok: true; job: ManualJob }
  | { ok: false; fieldErrors: ManualJobErrors; formErrors: string[] };

export function formatIssues(issues: z.ZodError["issues"], subject: string): string[] {
  return issues.map((issue) => {
    const path = issue.path.join(".") || subject;
    if (issue.code === "unrecognized_keys") {
      return `Unsupported field${issue.keys.length > 1 ? "s" : ""} in ${path}: ${issue.keys.join(", ")}. Nothing was saved.`;
    }
    return `${path}: ${issue.message}`;
  });
}

export function parseManualJobInput(input: unknown, mode: "create" | "edit"): ParseJobResult {
  const parsed = manualJobInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: {}, formErrors: formatIssues(parsed.error.issues, "job") };
  const result = validateManualJob(parsed.data, mode);
  return result.ok ? { ok: true, job: result.value } : { ok: false, fieldErrors: result.errors, formErrors: [] };
}

export const NOTES_SCHEMA = z.string().max(MANUAL_JOB_LIMITS.notesMax);

export const DISCOVERY_ACTIONS = ["save", "unsave", "dismiss", "restore", "expire", "reopen"] as const;
export type DiscoveryAction = (typeof DISCOVERY_ACTIONS)[number];
