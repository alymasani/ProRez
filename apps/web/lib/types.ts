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
 * A job can be "saved" (discovery) with materials "ready_for_review"
 * (preparation) and still be "not_submitted" (submission). Generating
 * materials NEVER marks anything as applied.
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

/** `junior` covers entry-level roles that are not new-grad programs (Milestone 2B). */
export const JOB_TYPES = ["new_grad", "junior", "internship", "co_op"] as const;
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
 * Categories for FILTERING the job list by a posting's stated length
 * (≤ 4 months, 5–8, more than 8, not stated); see `durationBucket()`.
 * Postings store an exact month count, or null when unknown / permanent.
 */
export const DURATION_BUCKETS = ["4", "8", "12_plus", "unspecified"] as const;
export type DurationBucket = (typeof DURATION_BUCKETS)[number];

/**
 * Duration REQUIREMENTS for search profiles and default settings (Milestone 2C).
 * A posting passes if it satisfies ANY selected requirement; no selection means
 * duration is not considered. See lib/matching/duration.ts.
 * - exactly_4:   stated length is exactly 4 months
 * - up_to_4:     1–4 months
 * - 4_to_8:      4–8 months inclusive
 * - any:         any stated length
 * - unspecified: also accept postings that do not state a length (otherwise
 *                they are flagged "needs review")
 * - legacy_*:    only on profiles converted from the 2A/2B buckets; behave
 *                exactly as before and cannot be newly selected.
 */
export const DURATION_REQUIREMENTS = [
  "exactly_4",
  "up_to_4",
  "4_to_8",
  "any",
  "unspecified",
  "legacy_5_to_8",
  "legacy_over_8",
] as const;
export type DurationRequirement = (typeof DURATION_REQUIREMENTS)[number] | DurationBucket;
export const SELECTABLE_DURATION_REQUIREMENTS = ["exactly_4", "up_to_4", "4_to_8", "any", "unspecified"] as const;
export const LEGACY_DURATION_REQUIREMENTS = ["legacy_5_to_8", "legacy_over_8"] as const;

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
  "workday",
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
  /** Null only for remote roles open anywhere in Canada. */
  province: Province | null;
  arrangement: WorkArrangement;
  /**
   * False when the source did not state the work arrangement and `arrangement`
   * is only a display default. Matching treats it as unknown (needs review),
   * never as a confirmed on-site role. Absent = stated.
   */
  arrangementStated?: false;
}

/** Discovery lifecycle — independent of preparation and submission. */
export const DISCOVERY_STATUSES = ["discovered", "saved", "dismissed", "expired"] as const;
export type DiscoveryStatus = (typeof DISCOVERY_STATUSES)[number];

/** How a job entered ProRez. */
export type JobOrigin = "manual" | "automatic";

export const SALARY_CURRENCIES = ["CAD", "USD"] as const;
export type SalaryCurrency = (typeof SALARY_CURRENCIES)[number];
export const SALARY_PERIODS = ["hour", "month", "year"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

export interface JobSalary {
  min: number | null;
  max: number | null;
  currency: SalaryCurrency;
  period: SalaryPeriod;
}

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
  origin: JobOrigin;
  /** Details version; bumped on every edit to job details (optimistic concurrency). */
  version: number;
  /** Full description as plain text (untrusted input; never rendered as HTML). */
  description: string | null;
  /** Experience requirement as stated, e.g. "0–2 years of professional experience". */
  experienceRequirement: string | null;
  salary: JobSalary | null;
  /** The user's own notes about this job. */
  notes: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** True for development fixtures. Every fixture must set this. */
  isDemo: boolean;
}

/** One place a job was seen (a source observation). */
export interface JobSighting {
  id: string;
  sourceId: string;
  provider: SourceProvider;
  externalId: string | null;
  /** URL exactly as submitted or reported. */
  sourceUrl: string | null;
  /** Normalized URL used for duplicate detection. */
  canonicalUrl: string | null;
  /** ATS posting identity recognised from the URL. */
  atsPosting: { provider: AtsProvider; boardToken: string; postingId: string } | null;
  firstSeenAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
}

export type DescriptionSource = "manual_submission" | "manual_edit" | "source_import";

/** Immutable copy of a description as captured. The earliest one is the original. */
export interface JobDescriptionSnapshot {
  id: string;
  jobId: string;
  content: string;
  /** SHA-256 hex of `content`. */
  contentHash: string;
  source: DescriptionSource;
  capturedAt: IsoDateTime;
}

export const JOB_EVENT_TYPES = [
  "created",
  "sighting_added",
  "discovery_status_changed",
  "details_updated",
  "notes_updated",
  "description_added",
  "evaluation_changed",
] as const;
export type JobEventType = (typeof JOB_EVENT_TYPES)[number];

/** Append-only job history entry. */
export interface JobEvent {
  id: string;
  jobId: string;
  type: JobEventType;
  fromValue: string | null;
  toValue: string | null;
  message: string | null;
  occurredAt: IsoDateTime;
  isDemo: boolean;
}

/** Everything shown on the job page beyond the posting itself. */
export interface JobRecord {
  sightings: JobSighting[];
  /** Oldest first; the first is the original description. */
  snapshots: JobDescriptionSnapshot[];
  /** Newest first. */
  events: JobEvent[];
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

/**
 * Preparation lifecycle — generating tailored materials. Driven by generation
 * workflows (a later milestone); never implies anything was submitted.
 */
export const PREPARATION_STATUSES = [
  "not_started",
  "awaiting_approval",
  "queued",
  "generating",
  "ready_for_review",
  "failed",
] as const;
export type PreparationStatus = (typeof PREPARATION_STATUSES)[number];

/**
 * Actual application status — what has happened with the employer, as recorded
 * by the user. Shown as Not applied / Applied / Interviewing / Offer / Rejected /
 * Withdrawn. Allowed transitions: lib/applications/transitions.ts.
 */
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

export const APPLICATION_EVENT_TYPES = [
  "created",
  "mode_changed",
  "preparation_status_changed",
  "submission_status_changed",
  "submission_recorded",
  "artifact_linked",
  "note_updated",
  "interview_recorded",
  "submission_date_changed",
] as const;
export type ApplicationEventType = (typeof APPLICATION_EVENT_TYPES)[number];

/** Append-only application history entry. */
export interface ApplicationEvent {
  id: string;
  applicationId: string;
  type: ApplicationEventType;
  fromValue: string | null;
  toValue: string | null;
  message: string | null;
  occurredAt: IsoDateTime;
  isDemo: boolean;
}

export const INTERVIEW_STAGES = ["recruiter_screen", "technical", "take_home", "onsite", "final", "other"] as const;
export type InterviewStage = (typeof INTERVIEW_STAGES)[number];

/** Calendar date without time zone, "YYYY-MM-DD". */
export type CalendarDate = string;

export interface ApplicationInterview {
  id: string;
  applicationId: string;
  stage: InterviewStage;
  occurredOn: CalendarDate;
  notes: string;
  createdAt: IsoDateTime;
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
  /** Planned owner/name. */
  owner: string;
  name: string;
  visibility: "private" | "public";
  /** False until GitHub publishing exists. */
  published: boolean;
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

/**
 * Criteria a posting must satisfy. Empty arrays mean "no constraint".
 * See lib/matching/engine.ts for which criteria are hard constraints and which
 * are soft relevance signals.
 */
export interface ProfileCriteria {
  /** Target job titles: case-insensitive phrases; the title must contain at least one. (hard) */
  titleKeywords: string[];
  /** Postings whose titles contain any of these are excluded. (hard) */
  excludedTitleKeywords: string[];
  /** Preferred terms anywhere in the posting; raise relevance only. (soft) */
  includeKeywords: string[];
  /** Postings mentioning any of these anywhere are excluded, e.g. "security clearance". (hard) */
  excludeKeywords: string[];
  disciplines: Discipline[];
  jobTypes: JobType[];
  /** Applies only to internship / co-op postings. See DURATION_REQUIREMENTS. */
  durations: DurationRequirement[];
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
  /** Increments on every saved change to criteria or settings; used for optimistic concurrency. */
  version: number;
  /** Set when a profile with match history is deleted; archived profiles are hidden and never evaluated. */
  archivedAt: IsoDateTime | null;
  name: string;
  description: string;
  /** Multiple profiles may be enabled at once. */
  enabled: boolean;
  criteria: ProfileCriteria;
  /** 0–100; postings scoring below this are not surfaced for this profile. */
  minFitScore: number;
  notifications: ProfileNotificationSettings;
  automationMode: AutomationMode;
  /** True when the 2C migration converted old duration buckets; cleared on the next save. */
  durationReviewRequired?: boolean;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  isDemo: boolean;
}

/** Editable subset of a profile used by the configuration form. */
export type SearchProfileDraft = Omit<
  SearchProfile,
  "id" | "version" | "archivedAt" | "durationReviewRequired" | "createdAt" | "updatedAt" | "isDemo"
>;

/** How one profile relates to a job in a stored evaluation. */
export type ProfileMatchStatus = "eligible" | "needs_review";

/** One profile's entry in a job's canonical evaluation. */
export interface ProfileMatchEntry {
  profileId: string;
  /** Profile version (criteria snapshot) the job was evaluated against. */
  profileVersion: number;
  rank: number;
  status: ProfileMatchStatus;
  /** 0–100 soft relevance; null when the profile has no soft signals. Not the candidate-fit score. */
  relevance: number | null;
  /** Human-readable explanations, including anything that needs review. */
  reasons: string[];
}

/**
 * Result of evaluating ONE job against ALL enabled profiles.
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
  /** Per-profile detail, in rank order. */
  entries: ProfileMatchEntry[];
  /** Matching-rules version that produced this result (lib/matching/engine.ts). */
  engineVersion: string;
  evaluatedAt: IsoDateTime;
  /** Null until a notification is actually sent. Always null until Telegram exists. */
  notifiedAt: IsoDateTime | null;
  isDemo: boolean;
}

// ---------------------------------------------------------------------------
// Employer boards (ATS registry; polling arrives in a later milestone)
// ---------------------------------------------------------------------------

/** Providers addressed by a plain board token (Milestone 3A). */
export const TOKEN_ATS_PROVIDERS = ["greenhouse", "lever", "ashby", "smartrecruiters"] as const;
/**
 * Every kind of career source a board row can be (Milestone 3D): the four
 * token-based ATS APIs, Workday career sites and generic company career pages.
 * (The name is kept for compatibility; "board" means any career source.)
 */
export const ATS_PROVIDERS = [...TOKEN_ATS_PROVIDERS, "workday", "company_site"] as const;
export type AtsProvider = (typeof ATS_PROVIDERS)[number];
export type ExtractionStrategy = "ats_api" | "workday_cxs" | "json_ld" | "sitemap" | "static_html" | "rendered";

/** What a provider's publication timestamp means (only first_published supports latency). */
export type PublishedAtKind = "none" | "first_published" | "last_published" | "updated";

/** One synchronization of one employer board (Milestone 3A). */
export interface BoardSyncRun {
  id: string;
  boardId: string;
  /** partial: imported but the catalogue was incomplete (nothing expired); skipped: another sync was running. */
  status: "running" | "succeeded" | "partial" | "failed" | "skipped";
  trigger: "manual" | "scheduled";
  /** Whether the provider catalogue was provably complete (null while running). */
  complete: boolean | null;
  startedAt: IsoDateTime;
  finishedAt: IsoDateTime | null;
  durationMs: number | null;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  reactivated: number;
  /** Active postings absent from this complete snapshot (not yet inactive). */
  missing: number;
  /** Newly inactivated postings (absent from two consecutive complete snapshots). */
  closed: number;
  skipped: number;
  errorCount: number;
  errorCode: string | null;
  errorMessage: string | null;
  /** Skip reasons and per-posting errors (bounded). */
  details: { postingId: string; kind: "skipped" | "error" | "warning"; message: string }[];
  /** Milestone 3C accounting (docs/ats-sync.md): primary dispositions sum to `fetched`. */
  eligible: number;
  filteredLocation: number;
  filteredEmploymentType: number;
  duplicate: number;
  invalid: number;
  ingestErrors: number;
  enrichmentIncomplete: number;
}

/** Where and when a job was seen, with provider timing (job page). */
export interface JobSourceRecord {
  id: string;
  provider: SourceProvider;
  /** Employer board name, when the sighting came from a registered board. */
  boardName: string | null;
  postingId: string | null;
  sourceUrl: string | null;
  providerPublishedAt: IsoDateTime | null;
  publishedAtKind: PublishedAtKind;
  firstSeenAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  closedAt: IsoDateTime | null;
  /** Publication → first detection, only when the provider reports a first-publication time. */
  discoveryLatencyMs: number | null;
}

export interface EmployerBoard {
  id: string;
  provider: AtsProvider;
  employerName: string;
  /** Provider-specific board identifier, e.g. the Greenhouse board token. */
  boardToken: string;
  /** Canonical public board URL derived from provider + token. */
  boardUrl: string;
  enabled: boolean;
  /** Minutes between automatic syncs (default 360 = 6 hours). */
  pollIntervalMinutes: number;
  /** Next automatic sync; null when not scheduled (disabled, demo, or paused after a configuration error). */
  nextSyncAt: IsoDateTime | null;
  /** A sync is running now (worker lease held or a run in progress). */
  syncing: boolean;
  /** Postings from this board currently listed (active sightings). */
  activeJobCount: number;
  /** Lever "eu" boards use the EU API; null = default region. */
  region: "eu" | null;
  /** Added by the user, or registered by automatic discovery (Milestone 3C). */
  origin: "manual" | "discovered";
  /** Verified company website domain, when the board belongs to a known company. */
  companyDomain: string | null;
  /** How jobs are extracted (Milestone 3D); null for boards synced before 3D (ATS API). */
  extractionStrategy: ExtractionStrategy | null;
  /** Locale from the source URL (Workday), informational. */
  locale: string | null;
  /** Last sync whose listing snapshot was provably complete. */
  lastCompleteSnapshotAt: IsoDateTime | null;
  lastErrorCode: string | null;
  lastCheckedAt: IsoDateTime | null;
  lastSuccessAt: IsoDateTime | null;
  consecutiveFailures: number;
  lastErrorAt: IsoDateTime | null;
  lastErrorMessage: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  isDemo: boolean;
}

// ---------------------------------------------------------------------------
// Preferences (Settings page)
// ---------------------------------------------------------------------------

/** Defaults used to pre-fill NEW search profiles. Profiles stay the source of truth for matching. */
export interface SearchPreferences {
  provinces: Province[];
  arrangements: WorkArrangement[];
  jobTypes: JobType[];
  durations: DurationRequirement[];
  disciplines: Discipline[];
  includeRemoteCanadaWide: boolean;
}

export interface AppSettings {
  search: SearchPreferences;
  notifications: {
    /** Global pause: no notifications for any profile while true. */
    paused: boolean;
    /** Default cadence for new profiles. */
    defaultCadence: NotificationCadence;
  };
  workflow: {
    /** Pre-selected mode when you start tracking an application. */
    defaultApplicationMode: ApplicationMode;
    /** Default automation mode for new profiles. */
    defaultAutomationMode: AutomationMode;
  };
  /** 0 until settings are first saved (defaults in use). */
  version: number;
  updatedAt: IsoDateTime | null;
}
