/**
 * Provider posting → ProRez canonical job fields, or an explicit skip reason.
 * Pure. Nothing is guessed silently:
 * - non-Canadian or unclear locations are skipped (./canada.ts);
 * - roles outside internship / co-op / new grad / junior are skipped (./classify.ts);
 * - a missing or ambiguous duration stays null (matching flags it for review);
 * - a missing workplace type is stored as on-site for display but flagged
 *   `arrangementStated: false`, so matching treats it as unknown (needs review).
 */
import { createHash } from "node:crypto";
import { normalizeDescription, summarizeDescription } from "../jobs/manual-submission";
import type { Discipline, JobLocation, JobType } from "../types";
import { resolveCanadianLocations } from "./canada";
import { classifyEmployment, extractDurationMonths, extractTerm, inferDisciplines } from "./classify";
import type { ProviderPosting } from "./types";

export const DESCRIPTION_MAX = 50_000;

export interface ImportedJob {
  postingId: string;
  company: string;
  title: string;
  jobType: JobType;
  durationMonths: number | null;
  term: string | null;
  disciplines: Discipline[];
  locations: JobLocation[];
  description: string | null;
  summary: string;
  url: string | null;
  /** SHA-256 over every provider-derived field; a change = material change. */
  contentHash: string;
  notes: {
    classification: string;
    arrangementInferred: boolean;
  };
}

export type NormalizeResult = { ok: true; job: ImportedJob } | { ok: false; reason: string };

export function normalizePosting(posting: ProviderPosting, employerName: string): NormalizeResult {
  const title = posting.title.replace(/\s+/g, " ").trim().slice(0, 200);

  const canada = resolveCanadianLocations({
    texts: posting.locationTexts,
    structured: posting.structuredLocations,
    workplace: posting.workplace,
  });
  if (!canada.canadian) return { ok: false, reason: canada.reason };

  const employment = classifyEmployment(title, posting.employmentType);
  if (!employment.ok) return { ok: false, reason: employment.reason };

  const raw = normalizeDescription(posting.descriptionText);
  const description = raw ? raw.slice(0, DESCRIPTION_MAX) : null;
  const termTexts = [title, description ?? ""];
  const durationMonths =
    employment.jobType === "internship" || employment.jobType === "co_op" ? extractDurationMonths(termTexts) : null;

  const job: Omit<ImportedJob, "contentHash"> = {
    postingId: posting.postingId,
    company: employerName.trim(),
    title,
    jobType: employment.jobType,
    durationMonths,
    term: extractTerm(termTexts),
    disciplines: inferDisciplines(title),
    locations: canada.locations.slice(0, 10),
    description,
    summary: summarizeDescription(description),
    url: posting.url,
    notes: { classification: employment.evidence, arrangementInferred: !canada.arrangementStated },
  };
  return { ok: true, job: { ...job, contentHash: hashImported(job) } };
}

function hashImported(job: Omit<ImportedJob, "contentHash">): string {
  const material = {
    company: job.company,
    title: job.title,
    jobType: job.jobType,
    durationMonths: job.durationMonths,
    term: job.term,
    disciplines: job.disciplines,
    locations: job.locations,
    description: job.description,
    url: job.url,
  };
  return createHash("sha256").update(JSON.stringify(material), "utf8").digest("hex");
}
