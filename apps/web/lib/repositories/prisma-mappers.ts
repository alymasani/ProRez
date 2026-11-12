/**
 * Conversions between Prisma rows and the domain types in lib/types.ts.
 * Kept separate from queries so the shapes are easy to review and test.
 */
import type { Prisma } from "../generated/prisma/client";
import type { DurationBucket as DbDurationBucket } from "../generated/prisma/enums";
import type {
  Application,
  ApplicationRun,
  ApprovalRequest,
  CoverLetterArtifact,
  DurationBucket,
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

// --- Duration buckets: the only enum whose values differ between TS and Prisma.

const DURATION_TO_DB: Record<DurationBucket, DbDurationBucket> = {
  "4": "months_4",
  "8": "months_8",
  "12_plus": "months_12_plus",
  unspecified: "unspecified",
};
const DURATION_FROM_DB = Object.fromEntries(
  Object.entries(DURATION_TO_DB).map(([k, v]) => [v, k]),
) as Record<DbDurationBucket, DurationBucket>;

export const durationToDb = (d: DurationBucket): DbDurationBucket => DURATION_TO_DB[d];
export const durationFromDb = (d: DbDurationBucket): DurationBucket => DURATION_FROM_DB[d];

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
    locations: row.locations.map((l) => ({ city: l.city, province: l.province, arrangement: l.arrangement })),
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
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    criteria: {
      titleKeywords: c?.titleKeywords ?? [],
      excludedTitleKeywords: c?.excludedTitleKeywords ?? [],
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
    evaluatedAt: iso(row.evaluatedAt),
    notifiedAt: isoOrNull(row.notifiedAt),
    isDemo: row.isDemo,
  };
}
