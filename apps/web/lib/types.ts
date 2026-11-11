/**
 * Core domain models for ProRez.
 *
 * Three lifecycles are deliberately modelled as independent fields and must
 * never be collapsed into one status:
 *
 *  1. Discovery   — what ProRez knows about a posting   (`JobPosting.discoveryStatus`)
 *  2. Preparation — progress generating materials       (`Application.preparationStatus`)
 *  3. Submission  — what actually happened with the employer (`Application.submissionStatus`)
 *
 * A job can be "shortlisted" (discovery) with materials "prepared"
 * (preparation) and still be "not_submitted" (submission).
 */

/** ISO-8601 timestamp string, e.g. "2026-11-08T14:30:00Z". */
export type IsoDateTime = string;

// ---------------------------------------------------------------------------
// Shared vocabularies
// ---------------------------------------------------------------------------

export const PROVINCES = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
] as const;
export type Province = (typeof PROVINCES)[number];

export const WORK_ARRANGEMENTS = ["onsite", "hybrid", "remote"] as const;
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];

export const JOB_TYPES = ["new_grad", "internship", "co_op"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const DISCIPLINES = [
  "backend",
  "frontend",
  "full_stack",
  "mobile",
  "infrastructure",
  "data",
  "machine_learning",
  "embedded",
  "security",
  "qa_automation",
] as const;
export type Discipline = (typeof DISCIPLINES)[number];

/**
 * Duration buckets used for filtering and preferences. Postings store an exact
 * month count (or null when unknown / permanent); see `durationBucket()`.
 */
export const DURATION_BUCKETS = ["4", "8", "12_plus", "unspecified"] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

export const APPLICATION_MODES = ["quick_apply", "full_build"] as const;
export type ApplicationMode = (typeof APPLICATION_MODES)[number];

// ---------------------------------------------------------------------------
// Job sources
// ---------------------------------------------------------------------------

export const SOURCE_PROVIDERS = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "company_site",
  "manual",
] as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[number];

/** Whether a connector exists yet. Nothing is connected in Milestone 1. */
export type SourceIntegrationStatus = "planned" | "not_configured" | "connected" | "error";

export interface JobSource {
  id: string;
  provider: SourceProvider;
  /** Human-readable label, e.g. "Greenhouse public job boards". */
  label: string;
  description: string;
  /** User preference: should this source be monitored once supported. */
  enabled: boolean;
  integrationStatus: SourceIntegrationStatus;
  lastCheckedAt: IsoDateTime | null;
}

// ---------------------------------------------------------------------------
// Job postings & matches
// ---------------------------------------------------------------------------

export interface JobLocation {
  city: string;
  province: Province;
  arrangement: WorkArrangement;
}

/** Discovery lifecycle — independent of preparation and submission. */
export const DISCOVERY_STATUSES = [
  "new",
  "reviewed",
  "shortlisted",
  "dismissed",
  "expired",
] as const;
export type DiscoveryStatus = (typeof DISCOVERY_STATUSES)[number];

export interface JobPosting {
  id: string;
  sourceId: string;
  /** Identifier on the originating board, when known. */
  externalId: string | null;
  company: string;
  title: string;
  locations: JobLocation[];
  jobType: JobType;
  /** Exact length in months for internships/co-ops; null when unknown or permanent. */
  durationMonths: number | null;
  /** Free-text term, e.g. "Summer 2027". */
  term: string | null;
  disciplines: Discipline[];
  summary: string;
  responsibilities: string[];
  qualifications: string[];
  /** Always a reserved `.example` URL in fixtures. */
  postingUrl: string | null;
  postedAt: IsoDateTime | null;
  discoveredAt: IsoDateTime;
  discoveryStatus: DiscoveryStatus;
  /** True for development fixtures. Every fixture must set this. */
  isDemo: boolean;
}

export interface JobMatch {
  id: string;
  jobId: string;
  /** 0–100. Fixture values are fictional and not computed by any model. */
  fitScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string[];
  computedAt: IsoDateTime;
  isDemo: boolean;
}

/** A posting joined with its (optional) match, as displayed in the UI. */
export interface JobWithMatch {
  job: JobPosting;
  match: JobMatch | null;
}

// ---------------------------------------------------------------------------
// Approvals (future Telegram / dashboard decision on a discovered job)
// ---------------------------------------------------------------------------

export type ApprovalChannel = "telegram" | "dashboard";
export type ApprovalDecision = "pending" | "full_build" | "quick_apply" | "skip" | "expired";

export interface ApprovalRequest {
  id: string;
  jobId: string;
  channel: ApprovalChannel;
  decision: ApprovalDecision;
  requestedAt: IsoDateTime;
  respondedAt: IsoDateTime | null;
  isDemo: boolean;
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

/** Preparation lifecycle — generating tailored materials. */
export const PREPARATION_STATUSES = [
  "not_started",
  "queued",
  "generating",
  "needs_review",
  "prepared",
  "failed",
] as const;
export type PreparationStatus = (typeof PREPARATION_STATUSES)[number];

/** Submission lifecycle — what has actually happened with the employer. */
export const SUBMISSION_STATUSES = [
  "not_submitted",
  "submitted",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export interface Application {
  id: string;
  jobId: string;
  mode: ApplicationMode;
  preparationStatus: PreparationStatus;
  submissionStatus: SubmissionStatus;
  /** Set only when the user records that they submitted. Null otherwise. */
  submittedAt: IsoDateTime | null;
  resumeId: string | null;
  coverLetterId: string | null;
  projectId: string | null;
  notes: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  isDemo: boolean;
}

export type RunKind = "resume" | "cover_letter" | "project" | "full_build";
export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

/** One execution of a generation workflow for an application. */
export interface ApplicationRun {
  id: string;
  applicationId: string;
  kind: RunKind;
  status: RunStatus;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  summary: string;
  isDemo: boolean;
}

// ---------------------------------------------------------------------------
// Generated artifacts
// ---------------------------------------------------------------------------

export type GenerationStatus = "draft" | "generating" | "ready" | "failed";

interface DocumentArtifactBase {
  id: string;
  applicationId: string | null;
  jobId: string | null;
  /** Semantic label, e.g. "v3". */
  version: string;
  title: string;
  createdAt: IsoDateTime;
  generationStatus: GenerationStatus;
  /** Name of the template / base document used. */
  baseTemplate: string;
  isDemo: boolean;
}

export interface ResumeArtifact extends DocumentArtifactBase {
  kind: "resume";
  highlightedSkills: string[];
  pageCount: number | null;
}

export interface CoverLetterArtifact extends DocumentArtifactBase {
  kind: "cover_letter";
  tone: "formal" | "conversational" | "concise";
  wordCount: number | null;
}

export type DocumentArtifact = ResumeArtifact | CoverLetterArtifact;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export type CheckStatus = "not_run" | "pending" | "passing" | "failing";

export interface RepositoryReference {
  /** Planned owner/name. Nothing is published in Milestone 1. */
  owner: string;
  name: string;
  visibility: "private" | "public";
  published: false;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  technologies: string[];
  jobIds: string[];
  repository: RepositoryReference;
  buildStatus: CheckStatus;
  testStatus: CheckStatus;
  createdAt: IsoDateTime;
  isDemo: boolean;
}

// ---------------------------------------------------------------------------
// Search profiles
// ---------------------------------------------------------------------------

/**
 * What ProRez should do when a job matches a profile (future milestones).
 * - approval_required: notify and wait for Full Build / Quick Apply / Skip
 * - quick_generate:    automatically prepare Quick Apply materials, then notify
 * - notify_only:       notify without preparing anything
 * None of these ever submit an application on the user's behalf.
 */
export const AUTOMATION_MODES = ["approval_required", "quick_generate", "notify_only"] as const;
export type AutomationMode = (typeof AUTOMATION_MODES)[number];

export const EXPERIENCE_LEVELS = ["student", "new_grad", "junior"] as const;
export type ExperienceLevel = (typeof EXPERIENCE_LEVELS)[number];

export const NOTIFICATION_CADENCES = ["immediate", "daily_digest"] as const;
export type NotificationCadence = (typeof NOTIFICATION_CADENCES)[number];

/** Criteria a posting must satisfy. Empty arrays mean "no constraint". */
export interface ProfileCriteria {
  /** Case-insensitive title phrases; any one may match. */
  titleKeywords: string[];
  /** Postings whose titles contain any of these are excluded. */
  excludedTitleKeywords: string[];
  disciplines: Discipline[];
  jobTypes: JobType[];
  /** Applies only to internship / co-op postings. */
  durations: DurationBucket[];
  provinces: Province[];
  arrangements: WorkArrangement[];
  /** When true, remote roles anywhere in Canada match regardless of `provinces`. */
  includeRemoteCanadaWide: boolean;
  experienceLevels: ExperienceLevel[];
  /** Exclude postings asking for more than this many years. Null = no limit. */
  maxYearsExperience: number | null;
}

export interface ProfileNotificationSettings {
  enabled: boolean;
  /** Only Telegram is planned; no channel is connected in Milestone 1. */
  channel: "telegram";
  cadence: NotificationCadence;
}

export interface SearchProfile {
  id: string;
  name: string;
  description: string;
  /** Multiple profiles may be enabled at once. */
  enabled: boolean;
  criteria: ProfileCriteria;
  /** 0–100; postings scoring below this are not surfaced for this profile. */
  minFitScore: number;
  notifications: ProfileNotificationSettings;
  automationMode: AutomationMode;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  isDemo: boolean;
}

/** Editable subset of a profile used by the configuration form. */
export type SearchProfileDraft = Omit<SearchProfile, "id" | "createdAt" | "updatedAt" | "isDemo">;

/**
 * Result of evaluating ONE job against ALL enabled profiles (future milestone).
 *
 * Deduplication contract: there is at most one record per job, regardless of
 * how many profiles match. `dedupeKey` identifies the underlying posting across
 * sources (e.g. normalized company + title + location), so the same role
 * syndicated on two boards also collapses into one record. Notifications are
 * sent per record — never per profile — so a job normally produces one message.
 */
export interface JobProfileMatch {
  jobId: string;
  dedupeKey: string;
  /** Every enabled profile the job satisfied, in priority order. */
  matchedProfileIds: string[];
  /** Profile whose automation mode governs this job (first in priority order). */
  primaryProfileId: string;
  evaluatedAt: IsoDateTime;
  /** Null until a notification is actually sent. Always null in Milestone 1. */
  notifiedAt: IsoDateTime | null;
  isDemo: boolean;
}

// ---------------------------------------------------------------------------
// Preferences (Settings page)
// ---------------------------------------------------------------------------

export interface SearchPreferences {
  provinces: Province[];
  arrangements: WorkArrangement[];
  jobTypes: JobType[];
  durations: DurationBucket[];
  disciplines: Discipline[];
}
