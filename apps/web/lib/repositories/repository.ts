import type {
  Application,
  ApplicationRun,
  ApprovalRequest,
  CoverLetterArtifact,
  EmployerBoard,
  JobPosting,
  JobProfileMatch,
  JobSource,
  JobWithMatch,
  Project,
  ResumeArtifact,
  SearchPreferences,
  SearchProfile,
} from "../types";

/**
 * Read contract shared by the fixture and PostgreSQL implementations.
 * Pages never see which one is active; they go through `lib/data.ts`.
 *
 * Ordering: list methods return a stable order (documented per method) but
 * pages should not rely on it for presentation — they sort explicitly.
 */
export interface DataRepository {
  /** Ordered by provider (Greenhouse, Lever, Ashby, SmartRecruiters, company site, manual). */
  listJobSources(): Promise<JobSource[]>;
  /** Ordered by id. */
  listJobs(): Promise<JobPosting[]>;
  /** Ordered by job id. */
  listJobsWithMatches(): Promise<JobWithMatch[]>;
  getJobWithMatch(id: string): Promise<JobWithMatch | null>;

  listApplications(): Promise<Application[]>;
  getApplicationForJob(jobId: string): Promise<Application | null>;
  listApplicationRuns(): Promise<ApplicationRun[]>;
  listApprovals(): Promise<ApprovalRequest[]>;

  listResumes(): Promise<ResumeArtifact[]>;
  listCoverLetters(): Promise<CoverLetterArtifact[]>;
  listProjects(): Promise<Project[]>;

  /** Non-archived profiles, ordered by creation time, then name. */
  listSearchProfiles(): Promise<SearchProfile[]>;
  /** Archived profiles (kept for match history), most recently archived first. */
  listArchivedSearchProfiles(): Promise<SearchProfile[]>;
  /** Includes archived profiles so history can always be displayed. */
  getSearchProfile(id: string): Promise<SearchProfile | null>;
  /** Matches on notified (frozen) evaluations — what forces archiving instead of deletion. */
  countProfileHistory(profileId: string): Promise<number>;
  getProfileMatchForJob(jobId: string): Promise<JobProfileMatch | null>;

  /** Ordered by employer name, then provider. */
  listEmployerBoards(): Promise<EmployerBoard[]>;

  getDefaultPreferences(): Promise<SearchPreferences>;
}

/** Defaults shown on the Settings page until preferences are persisted. */
export const DEFAULT_PREFERENCES: SearchPreferences = {
  provinces: ["ON", "BC", "QC", "NS"],
  arrangements: ["hybrid", "remote"],
  jobTypes: ["internship", "co_op", "new_grad"],
  durations: ["4"],
  disciplines: ["backend", "full_stack", "infrastructure"],
  includeRemoteCanadaWide: true,
};
