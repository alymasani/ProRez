/**
 * Validation for manually submitted (and manually edited) jobs. Pure and
 * framework-free: the form runs it for instant feedback and the server runs
 * it again after strict structural parsing (lib/jobs/schema.ts).
 *
 * Everything here is untrusted user input. Descriptions are kept as plain
 * text; nothing is interpreted, rendered as HTML, or fetched.
 */
import {
  DISCIPLINES,
  JOB_TYPES,
  PROVINCES,
  SALARY_CURRENCIES,
  SALARY_PERIODS,
  WORK_ARRANGEMENTS,
  type Discipline,
  type JobLocation,
  type JobPosting,
  type JobSalary,
  type JobType,
  type Province,
  type SalaryCurrency,
  type SalaryPeriod,
  type WorkArrangement,
} from "../types";
import { JOB_URL_ERROR_MESSAGES, parseJobUrl, type AtsPostingRef } from "./url";

export const MANUAL_JOB_LIMITS = {
  companyMax: 120,
  titleMax: 200,
  cityMax: 100,
  termMax: 60,
  experienceMax: 300,
  notesMax: 5000,
  descriptionMin: 50,
  descriptionMax: 50_000,
  salaryMax: 10_000_000,
  durationMin: 1,
  durationMax: 24,
} as const;

/** Raw form values (strings, as typed). */
export interface ManualJobInput {
  jobUrl: string;
  description: string;
  company: string;
  title: string;
  city: string;
  province: string;
  arrangement: string;
  jobType: string;
  durationMonths: string;
  term: string;
  experienceRequirement: string;
  disciplines: string[];
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: string;
  salaryPeriod: string;
  notes: string;
}

export type ManualJobField = keyof ManualJobInput;
export type ManualJobErrors = Partial<Record<ManualJobField, string>>;

/** Normalized, validated job details. */
export interface ManualJob {
  url: { original: string; canonical: string; ats: AtsPostingRef | null } | null;
  description: string | null;
  company: string;
  title: string;
  location: JobLocation | null;
  jobType: JobType;
  durationMonths: number | null;
  term: string | null;
  experienceRequirement: string | null;
  disciplines: Discipline[];
  salary: JobSalary | null;
  notes: string;
}

export type ManualJobValidation = { ok: true; value: ManualJob } | { ok: false; errors: ManualJobErrors };

export const EMPTY_MANUAL_JOB_INPUT: ManualJobInput = {
  jobUrl: "",
  description: "",
  company: "",
  title: "",
  city: "",
  province: "",
  arrangement: "",
  jobType: "",
  durationMonths: "",
  term: "",
  experienceRequirement: "",
  disciplines: [],
  salaryMin: "",
  salaryMax: "",
  salaryCurrency: "CAD",
  salaryPeriod: "",
  notes: "",
};

const TERM_TYPES: readonly JobType[] = ["internship", "co_op"];

/** Collapses internal whitespace in single-line fields. */
const oneLine = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Plain-text normalization for pasted descriptions: unify line endings and
 * drop control characters (other than newlines and tabs). Nothing else is
 * changed, so the stored text stays faithful to what was pasted.
 */
export function normalizeDescription(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim();
}

function oneOf<T extends string>(values: readonly T[], value: string): T | null {
  return (values as readonly string[]).includes(value) ? (value as T) : null;
}

function wholeNumber(raw: string): number | null | "invalid" {
  const value = raw.trim().replace(/[$,\s]/g, "");
  if (!value) return null;
  if (!/^\d+$/.test(value)) return "invalid";
  return Number(value);
}

/**
 * - "create": a URL, a description, or both are required.
 * - "edit":   the URL is not editable (it identifies the posting); a
 *             description is optional and, if changed, is captured as a new
 *             immutable snapshot by the service.
 */
export function validateManualJob(input: ManualJobInput, mode: "create" | "edit" = "create"): ManualJobValidation {
  const errors: ManualJobErrors = {};
  const L = MANUAL_JOB_LIMITS;

  // --- Source: URL and/or description
  let url: ManualJob["url"] = null;
  if (mode === "create") {
    const rawUrl = input.jobUrl.trim();
    if (rawUrl) {
      const parsed = parseJobUrl(rawUrl);
      if (parsed.ok) url = { original: parsed.original, canonical: parsed.canonical, ats: parsed.ats };
      else errors.jobUrl = JOB_URL_ERROR_MESSAGES[parsed.error];
    }
  }
  const description = normalizeDescription(input.description);
  if (mode === "create" && !input.jobUrl.trim() && !description) {
    errors.jobUrl = "Provide the job URL, paste the job description, or both.";
  }
  if (description && description.length < L.descriptionMin) {
    errors.description = `The description looks too short (minimum ${L.descriptionMin} characters). Paste the full posting.`;
  } else if (description.length > L.descriptionMax) {
    errors.description = `The description is too long (maximum ${L.descriptionMax.toLocaleString("en-CA")} characters).`;
  }

  // --- Position
  const company = oneLine(input.company);
  const title = oneLine(input.title);
  if (!company) errors.company = "Company name is required.";
  else if (company.length > L.companyMax) errors.company = `Keep the company name under ${L.companyMax} characters.`;
  if (!title) errors.title = "Position title is required.";
  else if (title.length > L.titleMax) errors.title = `Keep the title under ${L.titleMax} characters.`;

  const jobType = oneOf(JOB_TYPES, input.jobType);
  if (!jobType) errors.jobType = "Select an employment type.";

  let durationMonths: number | null = null;
  const duration = wholeNumber(input.durationMonths);
  if (duration === "invalid" || (typeof duration === "number" && (duration < L.durationMin || duration > L.durationMax))) {
    errors.durationMonths = `Duration must be a whole number of months from ${L.durationMin} to ${L.durationMax}.`;
  } else if (typeof duration === "number") {
    if (jobType && !TERM_TYPES.includes(jobType)) {
      errors.durationMonths = "Duration only applies to internships and co-ops. Leave it blank for this type.";
    } else {
      durationMonths = duration;
    }
  }

  const term = oneLine(input.term);
  if (term.length > L.termMax) errors.term = `Keep the term under ${L.termMax} characters.`;
  const experienceRequirement = oneLine(input.experienceRequirement);
  if (experienceRequirement.length > L.experienceMax) {
    errors.experienceRequirement = `Keep this under ${L.experienceMax} characters.`;
  }

  const disciplines = Array.from(new Set(input.disciplines));
  if (disciplines.some((d) => !oneOf(DISCIPLINES, d))) errors.disciplines = "Choose disciplines from the list.";

  // --- Location (Canada only). All three parts or none; remote roles may omit the city.
  let location: JobLocation | null = null;
  const city = oneLine(input.city);
  const province = input.province ? oneOf(PROVINCES, input.province) : null;
  const arrangement = input.arrangement ? oneOf(WORK_ARRANGEMENTS, input.arrangement) : null;
  const anyLocation = Boolean(city || input.province || input.arrangement);
  if (anyLocation) {
    if (input.province && !province) errors.province = "Choose a province or territory.";
    if (input.arrangement && !arrangement) errors.arrangement = "Choose on-site, hybrid or remote.";
    if (!input.province) errors.province = "Choose a province or territory, or clear the location.";
    if (!input.arrangement) errors.arrangement = "Choose on-site, hybrid or remote.";
    if (!city && arrangement !== "remote") errors.city = "Enter the city (it can be left blank for remote roles).";
    if (city.length > L.cityMax) errors.city = `Keep the city under ${L.cityMax} characters.`;
    if (province && arrangement && (city || arrangement === "remote") && city.length <= L.cityMax) {
      location = { city: city || "Remote", province: province as Province, arrangement: arrangement as WorkArrangement };
    }
  }

  // --- Salary (optional, whole currency units)
  let salary: JobSalary | null = null;
  const min = wholeNumber(input.salaryMin);
  const max = wholeNumber(input.salaryMax);
  if (min === "invalid" || (typeof min === "number" && min > L.salaryMax)) {
    errors.salaryMin = "Use a whole number (e.g. 25 or 85000).";
  }
  if (max === "invalid" || (typeof max === "number" && max > L.salaryMax)) {
    errors.salaryMax = "Use a whole number (e.g. 30 or 95000).";
  }
  if (typeof min === "number" && typeof max === "number" && min > max) {
    errors.salaryMax = "The maximum must be at least the minimum.";
  }
  const currency = oneOf(SALARY_CURRENCIES, input.salaryCurrency);
  const period = oneOf(SALARY_PERIODS, input.salaryPeriod);
  if (typeof min === "number" || typeof max === "number") {
    if (!currency) errors.salaryCurrency = "Choose a currency.";
    if (!period) errors.salaryPeriod = "Choose per hour, month or year.";
    if (currency && period && min !== "invalid" && max !== "invalid") {
      salary = { min, max, currency: currency as SalaryCurrency, period: period as SalaryPeriod };
    }
  } else if (input.salaryPeriod && !period) {
    errors.salaryPeriod = "Choose per hour, month or year.";
  }

  const notes = input.notes.replace(/\r\n?/g, "\n").trim();
  if (notes.length > L.notesMax) errors.notes = `Keep notes under ${L.notesMax.toLocaleString("en-CA")} characters.`;

  if (Object.keys(errors).length > 0 || !jobType) return { ok: false, errors };
  return {
    ok: true,
    value: {
      url,
      description: description || null,
      company,
      title,
      location,
      jobType,
      durationMonths,
      term: term || null,
      experienceRequirement: experienceRequirement || null,
      disciplines: disciplines as Discipline[],
      salary,
      notes,
    },
  };
}

/** Pre-fills the edit form from a stored job. */
export function inputFromJob(job: JobPosting): ManualJobInput {
  const location = job.locations[0];
  return {
    jobUrl: job.postingUrl ?? "",
    description: job.description ?? "",
    company: job.company,
    title: job.title,
    city: location?.city ?? "",
    province: location?.province ?? "",
    arrangement: location?.arrangement ?? "",
    jobType: job.jobType,
    durationMonths: job.durationMonths?.toString() ?? "",
    term: job.term ?? "",
    experienceRequirement: job.experienceRequirement ?? "",
    disciplines: [...job.disciplines],
    salaryMin: job.salary?.min?.toString() ?? "",
    salaryMax: job.salary?.max?.toString() ?? "",
    salaryCurrency: job.salary?.currency ?? "CAD",
    salaryPeriod: job.salary?.period ?? "",
    notes: job.notes,
  };
}

/** Short plain-text summary for list views: the first paragraph, trimmed. */
export function summarizeDescription(description: string | null, maxLength = 280): string {
  if (!description) return "";
  const firstParagraph = description.split(/\n\s*\n/).find((p) => p.trim()) ?? "";
  const flat = firstParagraph.replace(/\s+/g, " ").trim();
  return flat.length <= maxLength ? flat : `${flat.slice(0, maxLength - 1).trimEnd()}…`;
}
