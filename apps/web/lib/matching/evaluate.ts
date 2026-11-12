import type { IsoDateTime, JobPosting, SearchProfile } from "../types";
import { evaluateJob, type JobEvaluation } from "./engine";

/** Canonical profile order for tie-breaking: oldest first, then name, then id. */
export function sortProfilesForEvaluation(profiles: readonly SearchProfile[]): SearchProfile[] {
  return [...profiles].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
}

/** Evaluates many jobs against the same profile set (pure). */
export function evaluateJobs(
  jobs: readonly { job: JobPosting; dedupeKey: string }[],
  profiles: readonly SearchProfile[],
  evaluatedAt: IsoDateTime,
): JobEvaluation[] {
  const ordered = sortProfilesForEvaluation(profiles);
  return jobs.map(({ job, dedupeKey }) => evaluateJob(job, dedupeKey, ordered, evaluatedAt));
}
