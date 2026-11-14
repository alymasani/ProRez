import type {
  ApplicationMode,
  ApprovalDecision,
  AutomationMode,
  ExperienceLevel,
  NotificationCadence,
  CheckStatus,
  Discipline,
  DiscoveryStatus,
  DurationBucket,
  DurationRequirement,
  GenerationStatus,
  InterviewStage,
  ApplicationEventType,
  JobEventType,
  SalaryPeriod,
  JobType,
  PreparationStatus,
  Province,
  RunKind,
  RunStatus,
  SourceIntegrationStatus,
  SourceProvider,
  SubmissionStatus,
  WorkArrangement,
} from "@/lib/types";

/** Visual tone used by `StatusBadge`. Keep tones semantic, not colour names. */
export type Tone = "neutral" | "info" | "progress" | "success" | "warning" | "danger" | "muted";

export interface StatusMeta {
  label: string;
  tone: Tone;
}

export const PROVINCE_LABELS: Record<Province, string> = {
  AB: "Alberta",
  BC: "British Columbia",
  MB: "Manitoba",
  NB: "New Brunswick",
  NL: "Newfoundland and Labrador",
  NS: "Nova Scotia",
  NT: "Northwest Territories",
  NU: "Nunavut",
  ON: "Ontario",
  PE: "Prince Edward Island",
  QC: "Quebec",
  SK: "Saskatchewan",
  YT: "Yukon",
};

export const ARRANGEMENT_LABELS: Record<WorkArrangement, string> = {
  onsite: "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  new_grad: "New grad",
  junior: "Junior",
  internship: "Internship",
  co_op: "Co-op",
};

/** Job-list filter categories (a posting's stated length). */
export const DURATION_LABELS: Record<DurationBucket, string> = {
  "4": "Up to 4 months",
  "8": "5–8 months",
  "12_plus": "More than 8 months",
  unspecified: "Not specified",
};

/** Profile / settings duration requirements. */
export const DURATION_REQUIREMENT_LABELS: Record<DurationRequirement, { label: string; hint: string }> = {
  "4": { label: "Up to 4 months (legacy)", hint: "Preserves the previous 1–4 month behaviour." },
  "8": { label: "5–8 months (legacy)", hint: "Preserves the previous duration behaviour." },
  "12_plus": { label: "More than 8 months (legacy)", hint: "Preserves the previous duration behaviour." },
  exactly_4: { label: "Exactly 4 months", hint: "Only postings stating 4 months." },
  up_to_4: { label: "Up to 4 months", hint: "1–4 months, so 3-month terms also match." },
  "4_to_8": { label: "4 to 8 months", hint: "Anything from 4 to 8 months, inclusive." },
  any: { label: "Any stated duration", hint: "Any length, as long as the posting states one." },
  unspecified: {
    label: "Duration not stated",
    hint: "Accept postings without a stated length. Otherwise they are flagged “needs review”.",
  },
  legacy_5_to_8: { label: "5–8 months (old “8 months” setting)", hint: "Converted from the previous version." },
  legacy_over_8: { label: "More than 8 months (old “12+ months” setting)", hint: "Converted from the previous version." },
};

export const DISCIPLINE_LABELS: Record<Discipline, string> = {
  backend: "Backend",
  frontend: "Frontend",
  full_stack: "Full stack",
  mobile: "Mobile",
  infrastructure: "Infrastructure / DevOps",
  data: "Data engineering",
  machine_learning: "Machine learning",
  embedded: "Embedded / Firmware",
  security: "Security",
  qa_automation: "QA / Test automation",
};

export const MODE_LABELS: Record<ApplicationMode, string> = {
  quick_apply: "Quick Apply",
  full_build: "Full Build",
};

export const SOURCE_PROVIDER_LABELS: Record<SourceProvider, string> = {
  greenhouse: "Greenhouse",
  lever: "Lever",
  ashby: "Ashby",
  smartrecruiters: "SmartRecruiters",
  company_site: "Company career site",
  manual: "Manual submission",
  workday: "Workday",
};

export const DISCOVERY_STATUS: Record<DiscoveryStatus, StatusMeta> = {
  discovered: { label: "Discovered", tone: "info" },
  saved: { label: "Saved", tone: "success" },
  dismissed: { label: "Dismissed", tone: "muted" },
  expired: { label: "Expired", tone: "muted" },
};

export const PREPARATION_STATUS: Record<PreparationStatus, StatusMeta> = {
  not_started: { label: "Not started", tone: "muted" },
  awaiting_approval: { label: "Awaiting approval", tone: "warning" },
  queued: { label: "Queued", tone: "neutral" },
  generating: { label: "Generating", tone: "progress" },
  ready_for_review: { label: "Ready for review", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

/** Actual application status (stored values predate the "applied" wording). */
export const SUBMISSION_STATUS: Record<SubmissionStatus, StatusMeta> = {
  not_submitted: { label: "Not applied", tone: "muted" },
  submitted: { label: "Applied", tone: "info" },
  interviewing: { label: "Interviewing", tone: "progress" },
  offer: { label: "Offer", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  withdrawn: { label: "Withdrawn", tone: "muted" },
};

export const GENERATION_STATUS: Record<GenerationStatus, StatusMeta> = {
  draft: { label: "Draft", tone: "neutral" },
  generating: { label: "Generating", tone: "progress" },
  ready: { label: "Ready", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export const CHECK_STATUS: Record<CheckStatus, StatusMeta> = {
  not_run: { label: "Not run", tone: "muted" },
  pending: { label: "Pending", tone: "progress" },
  passing: { label: "Passing", tone: "success" },
  failing: { label: "Failing", tone: "danger" },
};

export const RUN_STATUS: Record<RunStatus, StatusMeta> = {
  queued: { label: "Queued", tone: "neutral" },
  running: { label: "Running", tone: "progress" },
  succeeded: { label: "Succeeded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export const RUN_KIND_LABELS: Record<RunKind, string> = {
  resume: "Resume generation",
  cover_letter: "Cover letter generation",
  project: "Project generation",
  full_build: "Full Build",
};

export const APPROVAL_DECISION: Record<ApprovalDecision, StatusMeta> = {
  pending: { label: "Awaiting decision", tone: "warning" },
  full_build: { label: "Full Build", tone: "success" },
  quick_apply: { label: "Quick Apply", tone: "info" },
  skip: { label: "Skipped", tone: "muted" },
  expired: { label: "Expired", tone: "muted" },
};

export const AUTOMATION_MODE_LABELS: Record<AutomationMode, { label: string; description: string }> = {
  approval_required: {
    label: "Approval required",
    description: "Notify me and wait for a Full Build, Quick Apply, or Skip decision.",
  },
  quick_generate: {
    label: "Quick application generation",
    description: "Prepare Quick Apply materials automatically, then notify me to review.",
  },
  notify_only: {
    label: "Notification only",
    description: "Just tell me about matching jobs. Nothing is prepared.",
  },
};

export const EXPERIENCE_LEVEL_LABELS: Record<ExperienceLevel, string> = {
  student: "Current student",
  new_grad: "New graduate",
  junior: "Junior (0–2 years)",
};

export const NOTIFICATION_CADENCE_LABELS: Record<NotificationCadence, string> = {
  immediate: "As soon as found",
  daily_digest: "Daily digest",
};

export const INTEGRATION_STATUS:Record<SourceIntegrationStatus, StatusMeta> = {
  planned: { label: "Planned", tone: "neutral" },
  not_configured: { label: "Not configured", tone: "muted" },
  connected: { label: "Connected", tone: "success" },
  error: { label: "Error", tone: "danger" },
};

export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = {
  hour: "per hour",
  month: "per month",
  year: "per year",
};

export const INTERVIEW_STAGE_LABELS: Record<InterviewStage, string> = {
  recruiter_screen: "Recruiter screen",
  technical: "Technical interview",
  take_home: "Take-home assignment",
  onsite: "On-site / virtual on-site",
  final: "Final round",
  other: "Other",
};

export const JOB_EVENT_LABELS: Record<JobEventType, string> = {
  created: "Job saved",
  sighting_added: "Seen again",
  discovery_status_changed: "Status changed",
  details_updated: "Details edited",
  notes_updated: "Notes updated",
  description_added: "Description captured",
  evaluation_changed: "Profile matches changed",
};

export const APPLICATION_EVENT_LABELS: Record<ApplicationEventType, string> = {
  created: "Tracking started",
  mode_changed: "Mode changed",
  preparation_status_changed: "Preparation status changed",
  submission_status_changed: "Status changed",
  submission_recorded: "Application recorded",
  artifact_linked: "Material linked",
  note_updated: "Notes updated",
  interview_recorded: "Interview recorded",
  submission_date_changed: "Application date corrected",
};

/**
 * Label for a status value stored in history. History is append-only, so it can
 * contain values from older versions (e.g. "prepared"); show those verbatim.
 */
export function historyValueLabel(value: string | null): string {
  if (value === null) return "—";
  const all: Record<string, StatusMeta> = { ...DISCOVERY_STATUS, ...PREPARATION_STATUS, ...SUBMISSION_STATUS };
  return Object.hasOwn(all, value) ? all[value].label : value.replaceAll("_", " ");
}
