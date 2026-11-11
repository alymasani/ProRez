/**
 * Read-only data access for Milestone 1.
 *
 * Every function here returns in-memory demo fixtures. This module is the
 * single seam to replace with real persistence in a later milestone; pages and
 * components should import from here rather than from `lib/fixtures/*`.
 */
import { DEMO_APPLICATION_RUNS, DEMO_APPLICATIONS, DEMO_APPROVALS } from "@/lib/fixtures/applications";
import { DEMO_COVER_LETTERS, DEMO_PROJECTS, DEMO_RESUMES } from "@/lib/fixtures/artifacts";
import { DEMO_JOB_MATCHES, DEMO_JOB_SOURCES, DEMO_JOBS } from "@/lib/fixtures/jobs";
import { DEMO_JOB_PROFILE_MATCHES, DEMO_SEARCH_PROFILES } from "@/lib/fixtures/profiles";
import type {
  JobProfileMatch,
  SearchProfile,
  Application,
  ApplicationRun,
  ApprovalRequest,
  CoverLetterArtifact,
  JobPosting,
  JobSource,
  JobWithMatch,
  Project,
  ResumeArtifact,
  SearchPreferences,
} from "@/lib/types";

const matchesByJobId = new Map(DEMO_JOB_MATCHES.map((m) => [m.jobId, m]));

export function getJobSources(): JobSource[] {
  return DEMO_JOB_SOURCES;
}

export function getJobs(): JobPosting[] {
  return DEMO_JOBS;
}

export function getJobsWithMatches(): JobWithMatch[] {
  return DEMO_JOBS.map((job) => ({ job, match: matchesByJobId.get(job.id) ?? null }));
}

export function getJobWithMatch(id: string): JobWithMatch | null {
  const job = DEMO_JOBS.find((j) => j.id === id);
  return job ? { job, match: matchesByJobId.get(job.id) ?? null } : null;
}

export function getApplications(): Application[] {
  return DEMO_APPLICATIONS;
}

export function getApplicationForJob(jobId: string): Application | null {
  return DEMO_APPLICATIONS.find((a) => a.jobId === jobId) ?? null;
}

export function getJobSource(id: string): JobSource | null {
  return DEMO_JOB_SOURCES.find((s) => s.id === id) ?? null;
}

export function getApplicationRuns(): ApplicationRun[] {
  return DEMO_APPLICATION_RUNS;
}

export function getApprovals(): ApprovalRequest[] {
  return DEMO_APPROVALS;
}

export function getResumes(): ResumeArtifact[] {
  return DEMO_RESUMES;
}

export function getCoverLetters(): CoverLetterArtifact[] {
  return DEMO_COVER_LETTERS;
}

export function getProjects(): Project[] {
  return DEMO_PROJECTS;
}

export function getSearchProfiles(): SearchProfile[] {
  return DEMO_SEARCH_PROFILES;
}

export function getSearchProfile(id: string): SearchProfile | null {
  return DEMO_SEARCH_PROFILES.find((p) => p.id === id) ?? null;
}

export function getProfileMatchForJob(jobId: string): JobProfileMatch | null {
  return DEMO_JOB_PROFILE_MATCHES.find((m) => m.jobId === jobId) ?? null;
}

/** Demo default preferences used to pre-fill the Settings page. */
export function getDefaultPreferences(): SearchPreferences {
  return {
    provinces: ["ON", "BC", "QC", "NS"],
    arrangements: ["hybrid", "remote"],
    jobTypes: ["internship", "co_op", "new_grad"],
    durations: ["4"],
    disciplines: ["backend", "full_stack", "infrastructure"],
  };
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export interface JobIndex {
  get(id: string | null | undefined): JobPosting | undefined;
}

export function getJobIndex(): JobIndex {
  const map = new Map(DEMO_JOBS.map((j) => [j.id, j]));
  return { get: (id) => (id ? map.get(id) : undefined) };
}
