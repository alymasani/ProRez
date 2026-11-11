import { describe, expect, it } from "vitest";
import { getApplications, getApprovals, getJobsWithMatches } from "./data";
import { computeOverviewMetrics } from "./metrics";

describe("computeOverviewMetrics (demo fixtures)", () => {
  const metrics = computeOverviewMetrics(getJobsWithMatches(), getApprovals(), getApplications());

  it("derives counts from fixture data", () => {
    expect(metrics.totalDiscovered).toBe(18);
    // New + fit >= 70: job-001, 002, 005, 010 (job-006 64, job-012 68, job-017 unscored).
    expect(metrics.newMatching).toBe(4);
    expect(metrics.pendingApprovals).toBe(4);
    // Prepared and not submitted: app-003 only.
    expect(metrics.preparedNotSubmitted).toBe(1);
    // Recorded submissions: app-001, app-005, app-006.
    expect(metrics.submitted).toBe(3);
  });
});

describe("fixtures", () => {
  it("marks every job as demo data", () => {
    expect(getJobsWithMatches().every(({ job, match }) => job.isDemo && (match?.isDemo ?? true))).toBe(true);
  });

  it("only uses reserved .example URLs", () => {
    for (const { job } of getJobsWithMatches()) {
      if (job.postingUrl) expect(new URL(job.postingUrl).hostname.endsWith(".example")).toBe(true);
    }
  });
});
