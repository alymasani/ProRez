/**
 * Conversions between Prisma rows and the domain types in lib/types.ts.
 * Kept separate from queries so the shapes are easy to review and test.
 */
import type { Prisma } from "../generated/prisma/client";
import { mapJobLocation } from "@/lib/repositories/job-location";
import type { DurationRequirement as DbDurationRequirement } from "../generated/prisma/enums";
import { discoveryLatencyMs } from "../ats/metrics";
import type {
  BoardSyncRun,
  JobSourceRecord,
  AtsProvider,
  EmployerBoard,
  Application,
  ApplicationRun,
  ApplicationEvent,
  ApplicationInterview,
  ApprovalRequest,
  CoverLetterArtifact,
  DurationRequirement,
  JobDescriptionSnapshot,
  JobEvent,
  JobSighting,
  JobMatch,
  JobPosting,
  JobProfileMatch,
  JobSource,
  Project,
  ResumeArtifact,
  SearchProfile,
} from "../types";

const iso = (d: Date) => d.toISOString();
const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

// --- Duration requirements: the only enum whose values differ between TS and Prisma.

const DURATION_TO_DB: Record<DurationRequirement, DbDurationRequirement> = {
  "4": "up_to_4",
  "8": "legacy_5_to_8",
  "12_plus": "legacy_over_8",
  exactly_4: "exactly_4",
  up_to_4: "up_to_4",
  "4_to_8": "months_4_to_8",
  any: "any",
  unspecified: "unspecified",
  legacy_5_to_8: "legacy_5_to_8",
  legacy_over_8: "legacy_over_8",
};
const DURATION_FROM_DB = Object.fromEntries(
  Object.entries(DURATION_TO_DB).map(([k, v]) => [v, k]),
) as Record<DbDurationRequirement, DurationRequirement>;

export const durationToDb = (d: DurationRequirement): DbDurationRequirement => DURATION_TO_DB[d];
export const durationFromDb = (d: DbDurationRequirement): DurationRequirement => DURATION_FROM_DB[d];
const calendar = (d: Date) => d.toISOString().slice(0, 10);

// --- Query shapes (include clauses live next to their mappers).

export const jobInclude = {
  locations: { orderBy: { position: "asc" } },
  observations: { orderBy: { firstSeenAt: "asc" } },
  match: true,
} satisfies Prisma.JobPostingInclude;
type JobRow = Prisma.JobPostingGetPayload<{ include: typeof jobInclude }>;

export const profileInclude = { criteria: true } satisfies Prisma.SearchProfileInclude;
type ProfileRow = Prisma.SearchProfileGetPayload<{ include: typeof profileInclude }>;

export const projectInclude = {
  jobLinks: { orderBy: [{ position: "asc" }, { jobId: "asc" }] },
} satisfies Prisma.ProjectInclude;
type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

export const evaluationInclude = {
  job: { select: { dedupeKey: true } },
  matches: { orderBy: { rank: "asc" } },
} satisfies Prisma.JobProfileEvaluationInclude;
type EvaluationRow = Prisma.JobProfileEvaluationGetPayload<{ include: typeof evaluationInclude }>;

// --- Mappers

export function toJobSource(row: Prisma.JobSourceGetPayload<object>): JobSource {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    description: row.description,
    enabled: row.enabled,
    integrationStatus: row.integrationStatus,
    lastCheckedAt: isoOrNull(row.lastCheckedAt),
  };
}

export function toJobPosting(row: JobRow): JobPosting {
  // The primary source's observation supplies the external id; otherwise the earliest sighting.
  const primary =
    row.observations.find((o) => o.sourceId === row.primarySourceId) ?? row.observations[0] ?? null;
  return {
    id: row.id,
    sourceId: primary?.sourceId ?? row.primarySourceId ?? "",
    externalId: primary?.externalId ?? null,
    company: row.company,
    title: row.title,
    locations: row.locations.map(mapJobLocation),
    jobType: row.jobType,
    durationMonths: row.durationMonths,
    term: row.term,
    disciplines: row.disciplines,
    summary: row.summary,
    responsibilities: row.responsibilities,
    qualifications: row.qualifications,
    postingUrl: row.postingUrl,
    postedAt: isoOrNull(row.postedAt),
    discoveredAt: iso(row.firstDiscoveredAt),
    discoveryStatus: row.discoveryStatus,
    origin: row.origin,
    version: row.version,
    description: row.description,
    experienceRequirement: row.experienceRequirement,
    // Completeness is guaranteed by the job_postings_salary_complete CHECK constraint.
    salary:
      row.salaryCurrency && row.salaryPeriod
        ? { min: row.salaryMin, max: row.salaryMax, currency: row.salaryCurrency, period: row.salaryPeriod }
        : null,
    notes: row.notes,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    isDemo: row.isDemo,
  };
}

export function toJobSighting(
  row: Prisma.SourceObservationGetPayload<{ include: { source: { select: { provider: true } } } }>,
): JobSighting {
  return {
    id: row.id,
    sourceId: row.sourceId,
    provider: row.source.provider,
    externalId: row.externalId,
    sourceUrl: row.sourceUrl,
    canonicalUrl: row.canonicalUrl,
    atsPosting:
      row.atsProvider && row.atsBoardToken && row.atsPostingId
        ? { provider: row.atsProvider as AtsProvider, boardToken: row.atsBoardToken, postingId: row.atsPostingId }
        : null,
    firstSeenAt: iso(row.firstSeenAt),
    lastSeenAt: iso(row.lastSeenAt),
  };
}

export function toDescriptionSnapshot(row: Prisma.JobDescriptionSnapshotGetPayload<object>): JobDescriptionSnapshot {
  return {
    id: row.id,
    jobId: row.jobId,
    content: row.content,
    contentHash: row.contentHash,
    source: row.source,
    capturedAt: iso(row.capturedAt),
  };
}

export function toJobEvent(row: Prisma.JobEventGetPayload<object>): JobEvent {
  return {
    id: row.id,
    jobId: row.jobId,
    type: row.type,
    fromValue: row.fromValue,
    toValue: row.toValue,
    message: row.message,
    occurredAt: iso(row.occurredAt),
    isDemo: row.isDemo,
  };
}

export function toApplicationEvent(row: Prisma.ApplicationEventGetPayload<object>): ApplicationEvent {
  return {
    id: row.id,
    applicationId: row.applicationId,
    type: row.type,
    fromValue: row.fromValue,
    toValue: row.toValue,
    message: row.message,
    occurredAt: iso(row.occurredAt),
    isDemo: row.isDemo,
  };
}

export function toApplicationInterview(row: Prisma.ApplicationInterviewGetPayload<object>): ApplicationInterview {
  return {
    id: row.id,
    applicationId: row.applicationId,
    stage: row.stage,
    occurredOn: calendar(row.occurredOn),
    notes: row.notes,
    createdAt: iso(row.createdAt),
    isDemo: row.isDemo,
  };
}

export function toJobMatch(row: NonNullable<JobRow["match"]>): JobMatch {
  return {
    id: `match-${row.jobId}`,
    jobId: row.jobId,
    fitScore: row.fitScore,
    matchedSkills: row.matchedSkills,
    missingSkills: row.missingSkills,
    reasons: row.reasons,
    computedAt: iso(row.computedAt),
    isDemo: row.isDemo,
  };
}

export function toApplication(row: Prisma.ApplicationGetPayload<object>): Application {
  return {
    id: row.id,
    jobId: row.jobId,
    mode: row.mode,
    preparationStatus: row.preparationStatus,
    submissionStatus: row.submissionStatus,
    submittedAt: isoOrNull(row.submittedAt),
    resumeId: row.resumeId,
    coverLetterId: row.coverLetterId,
    projectId: row.projectId,
    notes: row.notes,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    isDemo: row.isDemo,
  };
}

export function toApplicationRun(row: Prisma.WorkflowRunGetPayload<object>): ApplicationRun {
  return {
    id: row.id,
    applicationId: row.applicationId,
    kind: row.kind,
    status: row.status,
    startedAt: iso(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    summary: row.summary,
    isDemo: row.isDemo,
  };
}

export function toApprovalRequest(row: Prisma.ApprovalRequestGetPayload<object>): ApprovalRequest {
  return {
    id: row.id,
    jobId: row.jobId,
    channel: row.channel,
    decision: row.decision,
    requestedAt: iso(row.requestedAt),
    respondedAt: isoOrNull(row.respondedAt),
    isDemo: row.isDemo,
  };
}

export function toResume(row: Prisma.ResumeArtifactGetPayload<object>): ResumeArtifact {
  return {
    kind: "resume",
    id: row.id,
    applicationId: row.applicationId,
    jobId: row.jobId,
    version: row.version,
    title: row.title,
    createdAt: iso(row.createdAt),
    generationStatus: row.generationStatus,
    baseTemplate: row.baseTemplate,
    highlightedSkills: row.highlightedSkills,
    pageCount: row.pageCount,
    isDemo: row.isDemo,
  };
}

export function toCoverLetter(row: Prisma.CoverLetterArtifactGetPayload<object>): CoverLetterArtifact {
  return {
    kind: "cover_letter",
    id: row.id,
    applicationId: row.applicationId,
    jobId: row.jobId,
    version: row.version,
    title: row.title,
    createdAt: iso(row.createdAt),
    generationStatus: row.generationStatus,
    baseTemplate: row.baseTemplate,
    tone: row.tone,
    wordCount: row.wordCount,
    isDemo: row.isDemo,
  };
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    technologies: row.technologies,
    jobIds: row.jobLinks.map((l) => l.jobId),
    repository: {
      owner: row.repoOwner,
      name: row.repoName,
      visibility: row.repoVisibility,
      published: row.repoPublished,
    },
    buildStatus: row.buildStatus,
    testStatus: row.testStatus,
    createdAt: iso(row.createdAt),
    isDemo: row.isDemo,
  };
}

export function toSearchProfile(row: ProfileRow): SearchProfile {
  const c = row.criteria;
  return {
    id: row.id,
    version: row.version,
    archivedAt: isoOrNull(row.archivedAt),
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    criteria: {
      titleKeywords: c?.titleKeywords ?? [],
      excludedTitleKeywords: c?.excludedTitleKeywords ?? [],
      includeKeywords: c?.includeKeywords ?? [],
      excludeKeywords: c?.excludeKeywords ?? [],
      disciplines: c?.disciplines ?? [],
      jobTypes: c?.jobTypes ?? [],
      durations: (c?.durations ?? []).map(durationFromDb),
      provinces: c?.provinces ?? [],
      arrangements: c?.arrangements ?? [],
      includeRemoteCanadaWide: c?.includeRemoteCanadaWide ?? true,
      experienceLevels: c?.experienceLevels ?? [],
      maxYearsExperience: c?.maxYearsExperience ?? null,
    },
    minFitScore: row.minFitScore,
    notifications: {
      enabled: row.notificationsEnabled,
      channel: row.notificationChannel,
      cadence: row.notificationCadence,
    },
    automationMode: row.automationMode,
    durationReviewRequired: row.durationReviewRequired,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    isDemo: row.isDemo,
  };
}

/** Returns null for an evaluation with no matching profiles (nothing to report). */
export function toJobProfileMatch(row: EvaluationRow): JobProfileMatch | null {
  const [primary] = row.matches;
  if (!primary) return null;
  return {
    jobId: row.jobId,
    dedupeKey: row.job.dedupeKey,
    matchedProfileIds: row.matches.map((m) => m.profileId),
    primaryProfileId: primary.profileId,
    entries: row.matches.map((m) => ({
      profileId: m.profileId,
      profileVersion: m.profileVersion,
      rank: m.rank,
      status: m.status,
      relevance: m.relevance,
      reasons: m.reasons,
    })),
    engineVersion: row.engineVersion,
    evaluatedAt: iso(row.evaluatedAt),
    notifiedAt: isoOrNull(row.notifiedAt),
    isDemo: row.isDemo,
  };
}

export function toBoardSyncRun(row: Prisma.BoardSyncRunGetPayload<object>): BoardSyncRun {
  return {
    id: row.id,
    boardId: row.boardId,
    status: row.status,
    trigger: row.trigger,
    complete: row.complete,
    startedAt: iso(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    durationMs: row.durationMs,
    fetched: row.fetched,
    created: row.created,
    updated: row.updated,
    unchanged: row.unchanged,
    reactivated: row.reactivated,
    missing: row.missing,
    closed: row.closed,
    skipped: row.skipped,
    errorCount: row.errorCount,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    details: Array.isArray(row.details) ? (row.details as BoardSyncRun["details"]) : [],
    eligible: row.eligible,
    filteredLocation: row.filteredLocation,
    filteredEmploymentType: row.filteredEmploymentType,
    duplicate: row.duplicate,
    invalid: row.invalid,
    ingestErrors: row.ingestErrors,
    enrichmentIncomplete: row.enrichmentIncomplete,
  };
}

export function toJobSourceRecord(
  row: Prisma.SourceObservationGetPayload<{ include: { source: { select: { provider: true } }; board: { select: { employerName: true } } } }>,
): JobSourceRecord {
  return {
    id: row.id,
    provider: row.atsProvider ?? row.source.provider,
    boardName: row.board?.employerName ?? null,
    postingId: row.atsPostingId ?? row.externalId,
    sourceUrl: row.sourceUrl,
    providerPublishedAt: isoOrNull(row.providerPublishedAt),
    publishedAtKind: row.publishedAtKind,
    firstSeenAt: iso(row.firstSeenAt),
    lastSeenAt: iso(row.lastSeenAt),
    closedAt: isoOrNull(row.closedAt),
    discoveryLatencyMs: discoveryLatencyMs(row.providerPublishedAt, row.publishedAtKind, row.firstSeenAt),
  };
}

export function toEmployerBoard(
  row: Prisma.EmployerBoardGetPayload<object>,
  live: { syncing?: boolean; activeJobCount?: number; now?: Date; companyDomain?: string | null } = {},
): EmployerBoard {
  const now = live.now ?? new Date();
  const leased = row.syncLeaseExpiresAt !== null && row.syncLeaseExpiresAt > now;
  return {
    id: row.id,
    // Guaranteed by the employer_boards_ats_provider CHECK constraint.
    provider: row.provider as AtsProvider,
    employerName: row.employerName,
    boardToken: row.boardToken,
    boardUrl: row.boardUrl,
    enabled: row.enabled,
    pollIntervalMinutes: row.pollIntervalMinutes,
    nextSyncAt: isoOrNull(row.nextSyncAt),
    syncing: (live.syncing ?? false) || leased,
    activeJobCount: live.activeJobCount ?? 0,
    lastErrorCode: row.lastErrorCode,
    region: row.region === "eu" ? "eu" : null,
    origin: row.origin,
    companyDomain: live.companyDomain ?? null,
    lastCheckedAt: isoOrNull(row.lastCheckedAt),
    lastSuccessAt: isoOrNull(row.lastSuccessAt),
    consecutiveFailures: row.consecutiveFailures,
    lastErrorAt: isoOrNull(row.lastErrorAt),
    lastErrorMessage: row.lastErrorMessage,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    isDemo: row.isDemo,
  };
}
