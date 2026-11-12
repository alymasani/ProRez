import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteDemoData, seedDemoData } from "@/lib/db/seed-demo";
import { createFixtureRepository } from "@/lib/repositories/fixture-repository";
import { createPrismaRepository } from "@/lib/repositories/prisma-repository";
import type { DataRepository } from "@/lib/repositories/repository";
import { createSourceAndJob, createTestPrisma, normalizeDates, truncateAll } from "./helpers";

const db = createTestPrisma();
const fixtures = createFixtureRepository();
const database = createPrismaRepository(db);

beforeAll(async () => {
  await truncateAll(db);
  await seedDemoData(db);
});
afterAll(() => db.$disconnect());

/**
 * Parity: after seeding, the PostgreSQL repository must return exactly what
 * the fixture repository returns, so pages behave identically in both modes.
 */
describe("PostgreSQL repository matches the fixture repository", () => {
  const listMethods = [
    "listJobSources",
    "listJobs",
    "listJobsWithMatches",
    "listApplications",
    "listApplicationRuns",
    "listApprovals",
    "listResumes",
    "listCoverLetters",
    "listProjects",
    "listSearchProfiles",
    "getDefaultPreferences",
  ] as const satisfies readonly (keyof DataRepository)[];

  for (const method of listMethods) {
    it(method, async () => {
      expect(normalizeDates(await database[method]())).toEqual(normalizeDates(await fixtures[method]()));
    });
  }

  it("lookups by id, including misses", async () => {
    for (const id of ["job-001", "job-010", "job-017", "missing"]) {
      expect(normalizeDates(await database.getJobWithMatch(id))).toEqual(normalizeDates(await fixtures.getJobWithMatch(id)));
      expect(normalizeDates(await database.getApplicationForJob(id))).toEqual(
        normalizeDates(await fixtures.getApplicationForJob(id)),
      );
      expect(normalizeDates(await database.getProfileMatchForJob(id))).toEqual(
        normalizeDates(await fixtures.getProfileMatchForJob(id)),
      );
    }
    for (const id of ["profile-coop-4mo", "profile-embedded", "missing"]) {
      expect(normalizeDates(await database.getSearchProfile(id))).toEqual(normalizeDates(await fixtures.getSearchProfile(id)));
    }
  });
});

describe("demo seed", () => {
  it("flags every seeded record as demo data", async () => {
    expect(await db.jobPosting.count({ where: { isDemo: false } })).toBe(0);
    expect(await db.application.count({ where: { isDemo: false } })).toBe(0);
    expect(await db.searchProfile.count({ where: { isDemo: false } })).toBe(0);
  });

  it("stores a syndicated job once with two source observations", async () => {
    const job = await db.jobPosting.findUniqueOrThrow({ where: { id: "job-010" }, include: { observations: true } });
    expect(job.observations.map((o) => o.sourceId).sort()).toEqual(["src-ashby", "src-lever"]);
    expect(await db.jobPosting.count({ where: { company: "Quillstone Software" } })).toBe(1);
  });

  it("is idempotent", async () => {
    const before = await countAll();
    await seedDemoData(db);
    expect(await countAll()).toEqual(before);
  });

  it("removing demo data leaves real records untouched", async () => {
    await createSourceAndJob(db, "real-job");
    await deleteDemoData(db);
    expect(await db.jobPosting.findMany({ select: { id: true } })).toEqual([{ id: "real-job" }]);
    expect(await db.application.count()).toBe(0);
    expect(await db.searchProfile.count()).toBe(0);
    // Restore for any later tests.
    await seedDemoData(db);
  });
});

async function countAll() {
  const [jobs, observations, locations, profiles, evaluations, apps, events, runs, approvals, resumes, letters, projects] =
    await Promise.all([
      db.jobPosting.count(),
      db.sourceObservation.count(),
      db.jobLocation.count(),
      db.searchProfile.count(),
      db.jobProfileEvaluation.count(),
      db.application.count(),
      db.applicationEvent.count(),
      db.workflowRun.count(),
      db.approvalRequest.count(),
      db.resumeArtifact.count(),
      db.coverLetterArtifact.count(),
      db.project.count(),
    ]);
  return { jobs, observations, locations, profiles, evaluations, apps, events, runs, approvals, resumes, letters, projects };
}
