/**
 * In-memory repository backed by the fictional demo fixtures. Deterministic; no I/O.
 * Read-only: profile and board mutations require database mode.
 */
import { DEMO_APPLICATION_RUNS, DEMO_APPLICATIONS, DEMO_APPROVALS } from "../fixtures/applications";
import { DEMO_COVER_LETTERS, DEMO_PROJECTS, DEMO_RESUMES } from "../fixtures/artifacts";
import { DEMO_EMPLOYER_BOARDS } from "../fixtures/boards";
import { DEMO_JOB_MATCHES, DEMO_JOB_SOURCES, DEMO_JOBS } from "../fixtures/jobs";
import { DEMO_EVALUATED_AT, DEMO_SEARCH_PROFILES } from "../fixtures/profiles";
import { buildDedupeKey } from "../jobs/dedupe";
import { toJobProfileMatch } from "../matching/engine";
import { evaluateJobs } from "../matching/evaluate";
import type { JobProfileMatch } from "../types";
import { DEFAULT_PREFERENCES, type DataRepository } from "./repository";

const byId = <T extends { id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));

/** Engine output for the demo jobs and profiles, computed once. */
let demoProfileMatches: Map<string, JobProfileMatch | null> | undefined;
function profileMatches(): Map<string, JobProfileMatch | null> {
  demoProfileMatches ??= new Map(
    evaluateJobs(
      DEMO_JOBS.map((job) => ({ job, dedupeKey: buildDedupeKey(job.company, job.title, job.locations[0] ?? null) })),
      DEMO_SEARCH_PROFILES,
      DEMO_EVALUATED_AT,
    ).map((evaluation) => [evaluation.jobId, toJobProfileMatch(evaluation, { isDemo: true })]),
  );
  return demoProfileMatches;
}

export function createFixtureRepository(): DataRepository {
  const matchesByJobId = new Map(DEMO_JOB_MATCHES.map((m) => [m.jobId, m]));
  const withMatch = (job: (typeof DEMO_JOBS)[number]) => ({ job, match: matchesByJobId.get(job.id) ?? null });
  const activeProfiles = () => DEMO_SEARCH_PROFILES.filter((p) => p.archivedAt === null);

  return {
    listJobSources: async () => [...DEMO_JOB_SOURCES],
    listJobs: async () => byId(DEMO_JOBS),
    listJobsWithMatches: async () => byId(DEMO_JOBS).map(withMatch),
    getJobWithMatch: async (id) => {
      const job = DEMO_JOBS.find((j) => j.id === id);
      return job ? withMatch(job) : null;
    },
    listApplications: async () => [...DEMO_APPLICATIONS],
    getApplicationForJob: async (jobId) => DEMO_APPLICATIONS.find((a) => a.jobId === jobId) ?? null,
    listApplicationRuns: async () => [...DEMO_APPLICATION_RUNS],
    listApprovals: async () => [...DEMO_APPROVALS],
    listResumes: async () => [...DEMO_RESUMES],
    listCoverLetters: async () => [...DEMO_COVER_LETTERS],
    listProjects: async () => [...DEMO_PROJECTS],
    listSearchProfiles: async () => activeProfiles(),
    listArchivedSearchProfiles: async () => DEMO_SEARCH_PROFILES.filter((p) => p.archivedAt !== null),
    getSearchProfile: async (id) => DEMO_SEARCH_PROFILES.find((p) => p.id === id) ?? null,
    // Fixtures never contain notified evaluations, so no profile has history.
    countProfileHistory: async () => 0,
    getProfileMatchForJob: async (jobId) => profileMatches().get(jobId) ?? null,
    listEmployerBoards: async () =>
      [...DEMO_EMPLOYER_BOARDS].sort(
        (a, b) => a.employerName.localeCompare(b.employerName) || a.provider.localeCompare(b.provider),
      ),
    getDefaultPreferences: async () => structuredClone(DEFAULT_PREFERENCES),
  };
}
