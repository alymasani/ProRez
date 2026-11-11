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
  GenerationStatus,
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
  internship: "Internship",
  co_op: "Co-op",
};

export const DURATION_LABELS: Record<DurationBucket, string> = {
  "4": "4 months",
  "8": "8 months",
  "12_plus": "12+ months",
  unspecified: "Not specified",
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
};

export const DISCOVERY_STATUS: Record<DiscoveryStatus, StatusMeta> = {
  new: { label: "New", tone: "info" },
  reviewed: { label: "Reviewed", tone: "neutral" },
  shortlisted: { label: "Shortlisted", tone: "success" },
  dismissed: { label: "Dismissed", tone: "muted" },
  expired: { label: "Expired", tone: "muted" },
};

export const PREPARATION_STATUS: Record<PreparationStatus, StatusMeta> = {
  not_started: { label: "Not started", tone: "muted" },
  queued: { label: "Queued", tone: "neutral" },
  generating: { label: "Generating", tone: "progress" },
  needs_review: { label: "Needs review", tone: "warning" },
  prepared: { label: "Prepared", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

export const SUBMISSION_STATUS: Record<SubmissionStatus, StatusMeta> = {
  not_submitted: { label: "Not submitted", tone: "muted" },
  submitted: { label: "Submitted", tone: "info" },
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
