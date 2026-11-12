import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createSourceAndJob, createTestPrisma, truncateAll } from "./helpers";

const db = createTestPrisma();
afterAll(() => db.$disconnect());
beforeEach(() => truncateAll(db));

const UNIQUE = { code: "P2002" };
const FOREIGN_KEY = { code: "P2003" };
const T0 = new Date("2026-11-01T00:00:00Z");
const T1 = new Date("2026-11-02T00:00:00Z");

describe("canonical jobs and source observations", () => {
  it("rejects two canonical jobs with the same dedupe key", async () => {
    await createSourceAndJob(db, "job-a");
    await expect(
      db.jobPosting.create({
        data: {
          id: "job-b",
          dedupeKey: "acme|developer|job-a",
          company: "Acme",
          title: "Developer",
          jobType: "co_op",
          firstDiscoveredAt: T0,
        },
      }),
    ).rejects.toMatchObject(UNIQUE);
  });

  it("allows one job to have several observations from different sources", async () => {
    await createSourceAndJob(db);
    await db.jobSource.create({ data: { id: "src-lever", provider: "lever", label: "Lever", description: "" } });
    await db.sourceObservation.createMany({
      data: [
        { jobId: "job-a", sourceId: "src-test", externalId: "gh-1", firstSeenAt: T0, lastSeenAt: T0 },
        { jobId: "job-a", sourceId: "src-lever", externalId: "lv-9", firstSeenAt: T1, lastSeenAt: T1 },
      ],
    });
    const job = await db.jobPosting.findUniqueOrThrow({ where: { id: "job-a" }, include: { observations: true } });
    expect(job.observations).toHaveLength(2);
    expect(await db.jobPosting.count()).toBe(1);
  });

  it("rejects the same external id twice on one source", async () => {
    await createSourceAndJob(db, "job-a");
    await createSourceAndJob(db, "job-b");
    await db.sourceObservation.create({
      data: { jobId: "job-a", sourceId: "src-test", externalId: "gh-1", firstSeenAt: T0, lastSeenAt: T0 },
    });
    await expect(
      db.sourceObservation.create({
        data: { jobId: "job-b", sourceId: "src-test", externalId: "gh-1", firstSeenAt: T0, lastSeenAt: T0 },
      }),
    ).rejects.toMatchObject(UNIQUE);
  });

  it("allows multiple manual observations without external ids", async () => {
    await createSourceAndJob(db);
    await db.sourceObservation.createMany({
      data: [
        { jobId: "job-a", sourceId: "src-test", externalId: null, firstSeenAt: T0, lastSeenAt: T0 },
        { jobId: "job-a", sourceId: "src-test", externalId: null, firstSeenAt: T1, lastSeenAt: T1 },
      ],
    });
    expect(await db.sourceObservation.count()).toBe(2);
  });

  it("cannot delete a source that still has observations", async () => {
    await createSourceAndJob(db);
    await db.sourceObservation.create({
      data: { jobId: "job-a", sourceId: "src-test", externalId: "x", firstSeenAt: T0, lastSeenAt: T0 },
    });
    await expect(db.jobSource.delete({ where: { id: "src-test" } })).rejects.toMatchObject(FOREIGN_KEY);
  });

  it("deleting a job cascades to its locations, observations, match and profile matches", async () => {
    await createSourceAndJob(db);
    await db.jobLocation.create({ data: { jobId: "job-a", position: 0, city: "Toronto", province: "ON", arrangement: "hybrid" } });
    await db.sourceObservation.create({
      data: { jobId: "job-a", sourceId: "src-test", externalId: "x", firstSeenAt: T0, lastSeenAt: T0 },
    });
    await db.jobMatch.create({ data: { jobId: "job-a", fitScore: 80, computedAt: T0 } });
    await db.searchProfile.create({ data: { id: "p1", name: "P1" } });
    await db.jobProfileEvaluation.create({
      data: { jobId: "job-a", evaluatedAt: T0, matches: { create: [{ profileId: "p1", rank: 0 }] } },
    });

    await db.jobPosting.delete({ where: { id: "job-a" } });
    expect(await db.jobLocation.count()).toBe(0);
    expect(await db.sourceObservation.count()).toBe(0);
    expect(await db.jobMatch.count()).toBe(0);
    expect(await db.jobProfileMatch.count()).toBe(0);
    expect(await db.searchProfile.count()).toBe(1);
  });

  it("enforces fit score and duration ranges", async () => {
    await createSourceAndJob(db);
    await expect(db.jobMatch.create({ data: { jobId: "job-a", fitScore: 101, computedAt: T0 } })).rejects.toThrow(
      /job_matches_fit_score_range/,
    );
    await expect(
      db.jobPosting.update({ where: { id: "job-a" }, data: { durationMonths: 0 } }),
    ).rejects.toThrow(/job_postings_duration_range/);
  });
});

describe("search profiles and deduplicated matches", () => {
  it("stores criteria 1:1 and deletes them with the profile", async () => {
    await db.searchProfile.create({
      data: { id: "p1", name: "Co-ops", criteria: { create: { jobTypes: ["co_op"], durations: ["months_4"] } } },
    });
    await expect(db.profileCriteria.create({ data: { profileId: "p1" } })).rejects.toMatchObject(UNIQUE);
    await db.searchProfile.delete({ where: { id: "p1" } });
    expect(await db.profileCriteria.count()).toBe(0);
  });

  it("enforces unique, non-blank names and a 0–100 minimum fit score", async () => {
    await db.searchProfile.create({ data: { id: "p1", name: "Co-ops" } });
    await expect(db.searchProfile.create({ data: { id: "p2", name: "Co-ops" } })).rejects.toMatchObject(UNIQUE);
    await expect(db.searchProfile.create({ data: { id: "p3", name: "  " } })).rejects.toThrow(
      /search_profiles_name_not_blank/,
    );
    await expect(db.searchProfile.create({ data: { id: "p4", name: "X", minFitScore: -1 } })).rejects.toThrow(
      /search_profiles_min_fit_score_range/,
    );
  });

  it("keeps one evaluation per job with several ranked profiles, each at most once", async () => {
    await createSourceAndJob(db);
    await db.searchProfile.createMany({ data: [{ id: "p1", name: "A" }, { id: "p2", name: "B" }] });
    await db.jobProfileEvaluation.create({
      data: {
        jobId: "job-a",
        evaluatedAt: T0,
        matches: { create: [{ profileId: "p1", rank: 0 }, { profileId: "p2", rank: 1 }] },
      },
    });

    await expect(db.jobProfileEvaluation.create({ data: { jobId: "job-a", evaluatedAt: T1 } })).rejects.toMatchObject(
      UNIQUE,
    );
    await expect(db.jobProfileMatch.create({ data: { jobId: "job-a", profileId: "p1", rank: 5 } })).rejects.toMatchObject(
      UNIQUE,
    );
    await expect(
      db.jobProfileMatch.create({ data: { jobId: "job-a", profileId: "p3", rank: 0 } }),
    ).rejects.toBeTruthy();

    // Deleting a profile removes only its match row, not the job's evaluation.
    await db.searchProfile.delete({ where: { id: "p1" } });
    const evaluation = await db.jobProfileEvaluation.findUniqueOrThrow({
      where: { jobId: "job-a" },
      include: { matches: true },
    });
    expect(evaluation.matches.map((m) => m.profileId)).toEqual(["p2"]);
  });
});

describe("applications", () => {
  it("allows one application per job and blocks deleting a job that has one", async () => {
    await createSourceAndJob(db);
    await db.application.create({ data: { id: "app-1", jobId: "job-a", mode: "quick_apply" } });
    await expect(
      db.application.create({ data: { id: "app-2", jobId: "job-a", mode: "full_build" } }),
    ).rejects.toMatchObject(UNIQUE);
    await expect(db.jobPosting.delete({ where: { id: "job-a" } })).rejects.toMatchObject(FOREIGN_KEY);
  });

  it("rejects an application for a job that does not exist", async () => {
    await expect(
      db.application.create({ data: { id: "app-1", jobId: "missing", mode: "quick_apply" } }),
    ).rejects.toMatchObject(FOREIGN_KEY);
  });

  it("requires a submission date exactly when the status says it was submitted", async () => {
    await createSourceAndJob(db);
    await expect(
      db.application.create({
        data: { id: "a1", jobId: "job-a", mode: "quick_apply", submissionStatus: "submitted" },
      }),
    ).rejects.toThrow(/applications_submission_consistency/);
    await expect(
      db.application.create({
        data: { id: "a2", jobId: "job-a", mode: "quick_apply", submittedAt: T0 },
      }),
    ).rejects.toThrow(/applications_submission_consistency/);

    const ok = await db.application.create({
      data: { id: "a3", jobId: "job-a", mode: "quick_apply", submissionStatus: "interviewing", submittedAt: T0 },
    });
    expect(ok.preparationStatus).toBe("not_started");
  });

  it("keeps an event history that is deleted with the application", async () => {
    await createSourceAndJob(db);
    await db.application.create({
      data: {
        id: "a1",
        jobId: "job-a",
        mode: "quick_apply",
        events: { create: [{ type: "created" }, { type: "note_updated", message: "hi" }] },
      },
    });
    expect(await db.applicationEvent.count({ where: { applicationId: "a1" } })).toBe(2);
    await db.application.delete({ where: { id: "a1" } });
    expect(await db.applicationEvent.count()).toBe(0);
  });

  it("validates workflow run timing", async () => {
    await createSourceAndJob(db);
    await db.application.create({ data: { id: "a1", jobId: "job-a", mode: "full_build" } });
    await expect(
      db.workflowRun.create({ data: { id: "r1", applicationId: "a1", kind: "resume", startedAt: T1, finishedAt: T0, status: "failed" } }),
    ).rejects.toThrow(/workflow_runs_finish_after_start/);
    await expect(
      db.workflowRun.create({ data: { id: "r2", applicationId: "a1", kind: "resume", startedAt: T0, finishedAt: T1, status: "running" } }),
    ).rejects.toThrow(/workflow_runs_active_unfinished/);
  });
});

describe("artifacts and projects", () => {
  it("links selected artifacts to an application and clears the link when an artifact is deleted", async () => {
    await createSourceAndJob(db);
    await db.application.create({ data: { id: "a1", jobId: "job-a", mode: "quick_apply" } });
    await db.resumeArtifact.create({
      data: { id: "r1", applicationId: "a1", jobId: "job-a", version: "v1", title: "R", baseTemplate: "T" },
    });
    await db.application.update({ where: { id: "a1" }, data: { resumeId: "r1" } });

    await expect(
      db.resumeArtifact.create({
        data: { id: "r2", applicationId: "a1", version: "v1", title: "R", baseTemplate: "T" },
      }),
    ).rejects.toMatchObject(UNIQUE);

    await db.resumeArtifact.delete({ where: { id: "r1" } });
    expect((await db.application.findUniqueOrThrow({ where: { id: "a1" } })).resumeId).toBeNull();
  });

  it("links projects to many jobs once each, and cannot mark one published without a URL", async () => {
    await createSourceAndJob(db, "job-a");
    await createSourceAndJob(db, "job-b");
    await db.project.create({
      data: {
        id: "proj-1",
        name: "demo",
        repoOwner: "me",
        repoName: "demo",
        jobLinks: { create: [{ jobId: "job-a" }, { jobId: "job-b", position: 1 }] },
      },
    });
    await expect(db.projectJob.create({ data: { projectId: "proj-1", jobId: "job-a" } })).rejects.toMatchObject(UNIQUE);
    await expect(
      db.project.create({ data: { id: "proj-2", name: "x", repoOwner: "me", repoName: "demo" } }),
    ).rejects.toMatchObject(UNIQUE);
    await expect(
      db.project.update({ where: { id: "proj-1" }, data: { repoPublished: true } }),
    ).rejects.toThrow(/projects_published_requires_url/);
  });
});

describe("approval requests", () => {
  it("allows only one pending request per job, but any number of answered ones", async () => {
    await createSourceAndJob(db);
    await db.approvalRequest.create({ data: { id: "ap1", jobId: "job-a", channel: "dashboard", requestedAt: T0 } });
    await expect(
      db.approvalRequest.create({ data: { id: "ap2", jobId: "job-a", channel: "telegram", requestedAt: T1 } }),
    ).rejects.toMatchObject(UNIQUE);

    await db.approvalRequest.update({ where: { id: "ap1" }, data: { decision: "skip", respondedAt: T1 } });
    await db.approvalRequest.create({ data: { id: "ap2", jobId: "job-a", channel: "telegram", requestedAt: T1 } });
    expect(await db.approvalRequest.count({ where: { jobId: "job-a" } })).toBe(2);
  });

  it("rejects a pending request that already has a response time", async () => {
    await createSourceAndJob(db);
    await expect(
      db.approvalRequest.create({
        data: { id: "ap1", jobId: "job-a", channel: "dashboard", requestedAt: T0, respondedAt: T1 },
      }),
    ).rejects.toThrow(/approval_requests_pending_unanswered/);
  });
});
