import { describe, expect, it } from "vitest";
import { getApplications, getApprovals, getJobsWithMatches } from "./data";
import { computeOverviewMetrics } from "./metrics";

describe("computeOverviewMetrics (demo fixtures)", () => {
  it("derives counts from fixture data", async () => {
    const metrics = computeOverviewMetrics(await getJobsWithMatches(), await getApprovals(), await getApplications());
    expect(metrics.totalDiscovered).toBe(18);
    // Discovered (not yet saved/dismissed/expired) with fit >= 70.
    expect(metrics.newMatching).toBe(6);
    expect(metrics.pendingApprovals).toBe(4);
    // Ready for review and not submitted.
    expect(metrics.preparedNotSubmitted).toBe(2);
    // Recorded submissions: app-001, app-005, app-006.
    expect(metrics.submitted).toBe(3);
  });
});

describe("fixtures", () => {
  it("marks every job as demo data", async () => {
    expect((await getJobsWithMatches()).every(({ job, match }) => job.isDemo && (match?.isDemo ?? true))).toBe(true);
  });

  it("only uses reserved .example URLs", async () => {
    for (const { job } of await getJobsWithMatches()) {
      if (job.postingUrl) expect(new URL(job.postingUrl).hostname.endsWith(".example")).toBe(true);
    }
  });
});
