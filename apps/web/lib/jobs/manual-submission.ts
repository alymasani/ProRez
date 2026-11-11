/**
 * Validation for the manual job submission form. Pure and framework-free.
 * Milestone 1 only validates and previews; nothing is persisted.
 */
import { APPLICATION_MODES, JOB_TYPES, type ApplicationMode, type JobType } from "../types";

export interface ManualSubmissionInput {
  jobUrl: string;
  description: string;
  company: string;
  title: string;
  location: string;
  jobType: string;
  durationMonths: string;
  mode: string;
}

export interface ManualSubmission {
  jobUrl: string | null;
  description: string | null;
  company: string;
  title: string;
  location: string | null;
  jobType: JobType;
  durationMonths: number | null;
  mode: ApplicationMode;
}

export type ManualSubmissionErrors = Partial<Record<keyof ManualSubmissionInput, string>>;

export type ValidationResult =
  | { ok: true; value: ManualSubmission }
  | { ok: false; errors: ManualSubmissionErrors };

export const EMPTY_MANUAL_SUBMISSION: ManualSubmissionInput = {
  jobUrl: "",
  description: "",
  company: "",
  title: "",
  location: "",
  jobType: "",
  durationMonths: "",
  mode: "",
};

export const DESCRIPTION_MIN_LENGTH = 50;
export const DESCRIPTION_MAX_LENGTH = 20_000;

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateManualSubmission(input: ManualSubmissionInput): ValidationResult {
  const errors: ManualSubmissionErrors = {};
  const jobUrl = input.jobUrl.trim();
  const description = input.description.trim();
  const company = input.company.trim();
  const title = input.title.trim();
  const location = input.location.trim();
  const durationRaw = input.durationMonths.trim();

  if (!jobUrl && !description) {
    errors.jobUrl = "Provide a job URL, a job description, or both.";
  }
  if (jobUrl && !isHttpUrl(jobUrl)) {
    errors.jobUrl = "Enter a full URL starting with http:// or https://.";
  }
  if (description && description.length < DESCRIPTION_MIN_LENGTH) {
    errors.description = `Description looks too short (minimum ${DESCRIPTION_MIN_LENGTH} characters).`;
  }
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description is too long (maximum ${DESCRIPTION_MAX_LENGTH.toLocaleString("en-CA")} characters).`;
  }
  if (!company) errors.company = "Company name is required.";
  if (!title) errors.title = "Position title is required.";

  const jobType = (JOB_TYPES as readonly string[]).includes(input.jobType)
    ? (input.jobType as JobType)
    : null;
  if (!jobType) errors.jobType = "Select an employment type.";

  let durationMonths: number | null = null;
  if (durationRaw) {
    const parsed = Number(durationRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 24) {
      errors.durationMonths = "Duration must be a whole number of months between 1 and 24.";
    } else {
      durationMonths = parsed;
    }
  }

  const mode = (APPLICATION_MODES as readonly string[]).includes(input.mode)
    ? (input.mode as ApplicationMode)
    : null;
  if (!mode) errors.mode = "Choose Quick Apply or Full Build.";

  if (Object.keys(errors).length > 0 || !jobType || !mode) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      jobUrl: jobUrl || null,
      description: description || null,
      company,
      title,
      location: location || null,
      jobType,
      durationMonths,
      mode,
    },
  };
}
