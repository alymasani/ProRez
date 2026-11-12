/**
 * Overview metrics derived from records. Pure functions so definitions are
 * explicit and testable.
 */
import type { Application, ApprovalRequest, JobWithMatch } from "./types";

/** Minimum fictional fit score for a job to count as a "match". */
export const MATCH_THRESHOLD = 70;

export interface OverviewMetrics {
  totalDiscovered: number;
  newMatching: number;
  pendingApprovals: number;
  /** Materials prepared but not yet submitted. */
  preparedNotSubmitted: number;
  /** Any application with a recorded submission date. */
  submitted: number;
}

export function computeOverviewMetrics(
  jobs: readonly JobWithMatch[],
  approvals: readonly ApprovalRequest[],
  applications: readonly Application[],
): OverviewMetrics {
  return {
    totalDiscovered: jobs.length,
    newMatching: jobs.filter(
      ({ job, match }) => job.discoveryStatus === "discovered" && (match?.fitScore ?? 0) >= MATCH_THRESHOLD,
    ).length,
    pendingApprovals: approvals.filter((a) => a.decision === "pending").length,
    preparedNotSubmitted: applications.filter(
      (a) => a.preparationStatus === "ready_for_review" && a.submissionStatus === "not_submitted",
    ).length,
    submitted: applications.filter((a) => a.submittedAt !== null).length,
  };
}
