/** In-memory repository backed by the fictional demo fixtures. Deterministic; no I/O. */
import { DEMO_APPLICATION_RUNS, DEMO_APPLICATIONS, DEMO_APPROVALS } from "../fixtures/applications";
import { DEMO_COVER_LETTERS, DEMO_PROJECTS, DEMO_RESUMES } from "../fixtures/artifacts";
import { DEMO_JOB_MATCHES, DEMO_JOB_SOURCES, DEMO_JOBS } from "../fixtures/jobs";
import { DEMO_JOB_PROFILE_MATCHES, DEMO_SEARCH_PROFILES } from "../fixtures/profiles";
import { DEFAULT_PREFERENCES, type DataRepository } from "./repository";

const byId = <T extends { id: string }>(items: readonly T[]) =>
  [...items].sort((a, b) => a.id.localeCompare(b.id));

export function createFixtureRepository(): DataRepository {
  const matchesByJobId = new Map(DEMO_JOB_MATCHES.map((m) => [m.jobId, m]));
  const withMatch = (job: (typeof DEMO_JOBS)[number]) => ({ job, match: matchesByJobId.get(job.id) ?? null });

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
    listSearchProfiles: async () => [...DEMO_SEARCH_PROFILES],
    getSearchProfile: async (id) => DEMO_SEARCH_PROFILES.find((p) => p.id === id) ?? null,
    getProfileMatchForJob: async (jobId) => DEMO_JOB_PROFILE_MATCHES.find((m) => m.jobId === jobId) ?? null,
    getDefaultPreferences: async () => structuredClone(DEFAULT_PREFERENCES),
  };
}
