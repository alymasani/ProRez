/**
 * The data boundary for pages. Every page reads through these functions and
 * never imports fixtures or Prisma directly.
 *
 * The backing store is chosen by PROREZ_DATA_SOURCE (see lib/repositories/source.ts):
 * - "fixtures" (default): fictional demo data, fully static and deterministic.
 * - "database": PostgreSQL via Prisma. Reads are deferred to request time with
 *   `connection()`, so builds never contact the database and data is never
 *   baked into prerendered HTML.
 */
import { createFixtureRepository } from "@/lib/repositories/fixture-repository";
import type { DataRepository } from "@/lib/repositories/repository";
import { resolveDataSource } from "@/lib/repositories/source";
import type {
  BoardSyncRun,
  JobSourceRecord,
  Application,
  ApplicationEvent,
  ApplicationInterview,
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
  AppSettings,
  SearchProfile,
} from "@/lib/types";

let fixtureRepository: DataRepository | undefined;
let databaseRepository: DataRepository | undefined;

async function repository(): Promise<DataRepository> {
  if (resolveDataSource(process.env) === "fixtures") {
    fixtureRepository ??= createFixtureRepository();
    return fixtureRepository;
  }
  const { connection } = await import("next/server");
  await connection();
  if (!databaseRepository) {
    const [{ getPrisma }, { createPrismaRepository }] = await Promise.all([
      import("@/lib/db/client"),
      import("@/lib/repositories/prisma-repository"),
    ]);
    databaseRepository = createPrismaRepository(getPrisma());
  }
  return databaseRepository;
}

export async function getJobSources(): Promise<JobSource[]> {
  return (await repository()).listJobSources();
}

export async function getJobs(): Promise<JobPosting[]> {
  return (await repository()).listJobs();
}

export async function getJobsWithMatches(): Promise<JobWithMatch[]> {
  return (await repository()).listJobsWithMatches();
}

export async function getJobWithMatch(id: string): Promise<JobWithMatch | null> {
  return (await repository()).getJobWithMatch(id);
}

export async function getApplications(): Promise<Application[]> {
  return (await repository()).listApplications();
}

export async function getApplicationForJob(jobId: string): Promise<Application | null> {
  return (await repository()).getApplicationForJob(jobId);
}

export async function getApplicationRuns(): Promise<ApplicationRun[]> {
  return (await repository()).listApplicationRuns();
}

export async function getApplicationEvents(): Promise<ApplicationEvent[]> {
  if (resolveDataSource(process.env) === "fixtures") return [];
  const { connection } = await import("next/server"); await connection();
  const { getPrisma } = await import("@/lib/db/client");
  const rows = await getPrisma().applicationEvent.findMany({ orderBy: [{ occurredAt: "desc" }, { id: "desc" }] });
  return rows.map((r) => ({ id: r.id, applicationId: r.applicationId, type: r.type, fromValue: r.fromValue, toValue: r.toValue, message: r.message, occurredAt: r.occurredAt.toISOString(), isDemo: r.isDemo }));
}

export async function getApplicationInterviews(): Promise<ApplicationInterview[]> {
  if (resolveDataSource(process.env) === "fixtures") return [];
  const { connection } = await import("next/server"); await connection();
  const { getPrisma } = await import("@/lib/db/client");
  const rows = await getPrisma().applicationInterview.findMany({ orderBy: [{ occurredOn: "desc" }, { createdAt: "desc" }] });
  return rows.map((r) => ({ id: r.id, applicationId: r.applicationId, stage: r.stage, occurredOn: r.occurredOn.toISOString().slice(0, 10), notes: r.notes, createdAt: r.createdAt.toISOString(), isDemo: r.isDemo }));
}

export async function getApprovals(): Promise<ApprovalRequest[]> {
  return (await repository()).listApprovals();
}

export async function getResumes(): Promise<ResumeArtifact[]> {
  return (await repository()).listResumes();
}

export async function getCoverLetters(): Promise<CoverLetterArtifact[]> {
  return (await repository()).listCoverLetters();
}

export async function getProjects(): Promise<Project[]> {
  return (await repository()).listProjects();
}

export async function getSearchProfiles(): Promise<SearchProfile[]> {
  return (await repository()).listSearchProfiles();
}

export async function getSearchProfile(id: string): Promise<SearchProfile | null> {
  return (await repository()).getSearchProfile(id);
}

export async function getProfileMatchForJob(jobId: string): Promise<JobProfileMatch | null> {
  return (await repository()).getProfileMatchForJob(jobId);
}

export async function getArchivedSearchProfiles(): Promise<SearchProfile[]> {
  return (await repository()).listArchivedSearchProfiles();
}

/** Notified-history counts per profile id (drives delete-vs-archive messaging). */
export async function getProfileHistoryCounts(profileIds: readonly string[]): Promise<Record<string, number>> {
  const repo = await repository();
  const counts = await Promise.all(profileIds.map((id) => repo.countProfileHistory(id)));
  return Object.fromEntries(profileIds.map((id, i) => [id, counts[i]]));
}

export async function getEmployerBoards(): Promise<EmployerBoard[]> {
  return (await repository()).listEmployerBoards();
}

export async function getBoardSyncRuns(limit = 5): Promise<BoardSyncRun[]> {
  return (await repository()).listBoardSyncRuns(limit);
}

export async function getJobSightings(jobId: string): Promise<JobSourceRecord[]> {
  return (await repository()).listJobSightings(jobId);
}

export async function getDefaultPreferences(): Promise<SearchPreferences> {
  return (await repository()).getDefaultPreferences();
}

export async function getAppSettings(): Promise<AppSettings> {
  if (resolveDataSource(process.env) === "fixtures") {
    const { defaultSettings } = await import("@/lib/settings/defaults");
    return defaultSettings();
  }
  const { connection } = await import("next/server");
  await connection();
  const [{ getPrisma }, { readSettings }] = await Promise.all([
    import("@/lib/db/client"), import("@/lib/settings/service"),
  ]);
  return readSettings(getPrisma());
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

export interface JobIndex {
  get(id: string | null | undefined): JobPosting | undefined;
}

export function toJobIndex(jobs: readonly JobPosting[]): JobIndex {
  const map = new Map(jobs.map((j) => [j.id, j]));
  return { get: (id) => (id ? map.get(id) : undefined) };
}

export async function getJobIndex(): Promise<JobIndex> {
  return toJobIndex(await getJobs());
}
