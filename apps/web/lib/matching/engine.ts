/**
 * Deterministic job ↔ search-profile eligibility engine. No LLM, no I/O.
 *
 * For each (job, profile) pair, every criterion produces a check:
 *   pass | fail | unknown | not_applicable
 *
 * HARD constraints decide eligibility:
 *   any fail            → ineligible
 *   else any unknown    → needs_review (data missing or ambiguous; never silently passed)
 *   else                → eligible
 *
 * SOFT signals (preferred keywords, discipline overlap) only produce a 0–100
 * relevance used for ranking. Candidate-fit scores are NOT used here; the fit
 * threshold is applied separately when deciding notifications (notifications.ts).
 *
 * Bump MATCHING_ENGINE_VERSION whenever a rule changes so stored results can be
 * traced to the rules that produced them.
 */
import { DISCIPLINE_LABELS, EXPERIENCE_LEVEL_LABELS, JOB_TYPE_LABELS } from "../labels";
import type {
  ExperienceLevel,
  IsoDateTime,
  JobPosting,
  JobProfileMatch,
  JobType,
  ProfileMatchEntry,
  SearchProfile,
} from "../types";
import { checkDuration } from "./duration";
import { extractExperienceRequirement } from "./experience";
import { checkLocation } from "./location";
import { findPhrases, normalizeText } from "./text";

/** 2c.1: explicit duration requirements; description and stated experience are read. */
export const MATCHING_ENGINE_VERSION = "2c.1";

export type CheckResult = "pass" | "fail" | "unknown" | "not_applicable";
export type Outcome = "eligible" | "needs_review" | "ineligible";

export type CriterionId =
  | "job_type"
  | "duration"
  | "location"
  | "title_keywords"
  | "excluded_title_keywords"
  | "exclude_keywords"
  | "disciplines"
  | "experience_level"
  | "years_experience"
  | "include_keywords"
  | "discipline_overlap";

export interface CriterionCheck {
  criterion: CriterionId;
  kind: "hard" | "soft";
  result: CheckResult;
  detail: string;
  /** Soft signals only: 0–1 strength. */
  score?: number;
}

export interface ProfileEvaluation {
  profileId: string;
  profileVersion: number;
  outcome: Outcome;
  checks: CriterionCheck[];
  relevance: number | null;
  reasons: string[];
}

export interface JobEvaluation {
  jobId: string;
  dedupeKey: string;
  engineVersion: string;
  evaluatedAt: IsoDateTime;
  /** Set when the job was not evaluated at all (e.g. dismissed or expired). */
  skipped: "inactive" | null;
  /** Every evaluated profile, including ineligible ones (for explanations and tests). */
  profiles: ProfileEvaluation[];
  /** Eligible and needs-review profiles, ranked. This is what gets stored. */
  matches: ProfileMatchEntry[];
}

/** Experience level implied by a posting's job type. */
const LEVEL_FOR_JOB_TYPE: Record<JobType, ExperienceLevel> = {
  internship: "student",
  co_op: "student",
  new_grad: "new_grad",
  junior: "junior",
};

const ENTRY_LEVEL_TYPES: readonly JobType[] = ["internship", "co_op", "new_grad"];
const TERM_TYPES: readonly JobType[] = ["internship", "co_op"];

const SOFT_WEIGHTS: Partial<Record<CriterionId, number>> = { include_keywords: 2, discipline_overlap: 1 };

const check = (
  criterion: CriterionId,
  kind: "hard" | "soft",
  result: CheckResult,
  detail: string,
  score?: number,
): CriterionCheck => ({ criterion, kind, result, detail, ...(score === undefined ? {} : { score }) });

export function evaluateJobForProfile(job: JobPosting, profile: SearchProfile): ProfileEvaluation {
  const c = profile.criteria;
  const title = normalizeText(job.title);
  const fullText = normalizeText(
    [
      job.title,
      job.summary,
      job.description ?? "",
      job.experienceRequirement ?? "",
      ...job.responsibilities,
      ...job.qualifications,
    ].join(" \n "),
  );
  const checks: CriterionCheck[] = [];

  // --- Hard: employment type
  checks.push(
    c.jobTypes.length === 0
      ? check("job_type", "hard", "not_applicable", "Any employment type")
      : c.jobTypes.includes(job.jobType)
        ? check("job_type", "hard", "pass", JOB_TYPE_LABELS[job.jobType])
        : check("job_type", "hard", "fail", `${JOB_TYPE_LABELS[job.jobType]} is not a selected employment type`),
  );

  // --- Hard: internship / co-op duration
  if (!TERM_TYPES.includes(job.jobType) || c.durations.length === 0) {
    checks.push(check("duration", "hard", "not_applicable", "Duration not constrained for this role"));
  } else {
    const duration = checkDuration(job.durationMonths, c.durations);
    checks.push(check("duration", "hard", duration.result, duration.detail));
  }

  // --- Hard: location and work arrangement
  const location = checkLocation(job.locations, c);
  checks.push(check("location", "hard", location.result, location.detail));

  // --- Hard: target titles
  if (c.titleKeywords.length === 0) {
    checks.push(check("title_keywords", "hard", "not_applicable", "Any title"));
  } else {
    const found = findPhrases(title, c.titleKeywords);
    checks.push(
      found.length > 0
        ? check("title_keywords", "hard", "pass", `Title matches “${found[0]}”`)
        : check("title_keywords", "hard", "fail", "Title does not match any target title"),
    );
  }

  // --- Hard: excluded title words
  const excludedInTitle = findPhrases(title, c.excludedTitleKeywords);
  checks.push(
    c.excludedTitleKeywords.length === 0
      ? check("excluded_title_keywords", "hard", "not_applicable", "No excluded titles")
      : excludedInTitle.length > 0
        ? check("excluded_title_keywords", "hard", "fail", `Title contains excluded “${excludedInTitle[0]}”`)
        : check("excluded_title_keywords", "hard", "pass", "No excluded title words"),
  );

  // --- Hard: excluded keywords anywhere in the posting
  const excludedAnywhere = findPhrases(fullText, c.excludeKeywords);
  checks.push(
    c.excludeKeywords.length === 0
      ? check("exclude_keywords", "hard", "not_applicable", "No excluded keywords")
      : excludedAnywhere.length > 0
        ? check("exclude_keywords", "hard", "fail", `Posting mentions excluded “${excludedAnywhere[0]}”`)
        : check("exclude_keywords", "hard", "pass", "No excluded keywords found"),
  );

  // --- Hard: disciplines
  if (c.disciplines.length === 0) {
    checks.push(check("disciplines", "hard", "not_applicable", "Any discipline"));
  } else if (job.disciplines.length === 0) {
    checks.push(check("disciplines", "hard", "unknown", "Posting discipline unknown — needs review"));
  } else {
    const shared = job.disciplines.filter((d) => c.disciplines.includes(d));
    checks.push(
      shared.length > 0
        ? check("disciplines", "hard", "pass", shared.map((d) => DISCIPLINE_LABELS[d]).join(", "))
        : check("disciplines", "hard", "fail", "No selected discipline"),
    );
  }

  // --- Hard: experience level implied by job type
  const level = LEVEL_FOR_JOB_TYPE[job.jobType];
  checks.push(
    c.experienceLevels.length === 0
      ? check("experience_level", "hard", "not_applicable", "Any experience level")
      : c.experienceLevels.includes(level)
        ? check("experience_level", "hard", "pass", EXPERIENCE_LEVEL_LABELS[level])
        : check("experience_level", "hard", "fail", `${EXPERIENCE_LEVEL_LABELS[level]} role not selected`),
  );

  // --- Hard: years of experience (explicit about missing/ambiguous text)
  if (c.maxYearsExperience === null) {
    checks.push(check("years_experience", "hard", "not_applicable", "No experience limit"));
  } else {
    const max = c.maxYearsExperience;
    // The user-stated requirement comes first; the description is scanned too.
    const req = extractExperienceRequirement([
      job.experienceRequirement ?? "",
      job.summary,
      job.description ?? "",
      ...job.qualifications,
    ]);
    if (req.minYears === null) {
      checks.push(
        ENTRY_LEVEL_TYPES.includes(job.jobType)
          ? check("years_experience", "hard", "pass", "Not stated; entry-level role type")
          : check("years_experience", "hard", "unknown", "Experience requirement not stated — needs review"),
      );
    } else if (req.minYears > max) {
      checks.push(check("years_experience", "hard", "fail", `Requires ${req.minYears}+ years (limit ${max})`));
    } else if (req.ambiguous && (req.maxYearsMentioned ?? 0) > max) {
      checks.push(
        check(
          "years_experience",
          "hard",
          "unknown",
          `Mentions ${req.minYears}–${req.maxYearsMentioned} years — ambiguous, needs review`,
        ),
      );
    } else {
      checks.push(
        check(
          "years_experience",
          "hard",
          "pass",
          req.source === "stated" ? `Requires ${req.minYears} years (limit ${max})` : "Entry-level language",
        ),
      );
    }
  }

  // --- Soft: preferred keywords
  if (c.includeKeywords.length > 0) {
    const found = findPhrases(fullText, c.includeKeywords);
    checks.push(
      check(
        "include_keywords",
        "soft",
        found.length > 0 ? "pass" : "fail",
        found.length > 0 ? `Mentions ${found.join(", ")}` : "No preferred keywords",
        found.length / c.includeKeywords.length,
      ),
    );
  }

  // --- Soft: how much of the job's discipline mix the profile wants
  if (c.disciplines.length > 0 && job.disciplines.length > 0) {
    const shared = job.disciplines.filter((d) => c.disciplines.includes(d)).length;
    checks.push(
      check(
        "discipline_overlap",
        "soft",
        shared > 0 ? "pass" : "fail",
        `${shared} of ${job.disciplines.length} job disciplines selected`,
        shared / job.disciplines.length,
      ),
    );
  }

  const hard = checks.filter((x) => x.kind === "hard");
  const outcome: Outcome = hard.some((x) => x.result === "fail")
    ? "ineligible"
    : hard.some((x) => x.result === "unknown")
      ? "needs_review"
      : "eligible";

  const soft = checks.filter((x) => x.kind === "soft" && x.score !== undefined);
  const totalWeight = soft.reduce((sum, x) => sum + (SOFT_WEIGHTS[x.criterion] ?? 1), 0);
  const relevance =
    totalWeight === 0
      ? null
      : Math.round((100 * soft.reduce((sum, x) => sum + (SOFT_WEIGHTS[x.criterion] ?? 1) * (x.score ?? 0), 0)) / totalWeight);

  const reasons =
    outcome === "ineligible"
      ? hard.filter((x) => x.result === "fail").map((x) => x.detail)
      : [
          ...hard.filter((x) => x.result === "unknown").map((x) => x.detail),
          ...(outcome === "eligible" ? ["All required criteria met"] : []),
          ...soft.filter((x) => x.result === "pass").map((x) => x.detail),
        ];

  return { profileId: profile.id, profileVersion: profile.version, outcome, checks, relevance, reasons };
}

/** Profiles that take part in evaluation. */
export function isActiveProfile(profile: SearchProfile): boolean {
  return profile.enabled && profile.archivedAt === null;
}

/**
 * Evaluates one job against every active profile and returns ONE canonical
 * result. `profiles` order is the final tie-breaker (pass them sorted by
 * creation time for stable ranks).
 */
export function evaluateJob(
  job: JobPosting,
  dedupeKey: string,
  profiles: readonly SearchProfile[],
  evaluatedAt: IsoDateTime,
): JobEvaluation {
  const base = { jobId: job.id, dedupeKey, engineVersion: MATCHING_ENGINE_VERSION, evaluatedAt };
  if (job.discoveryStatus === "dismissed" || job.discoveryStatus === "expired") {
    return { ...base, skipped: "inactive", profiles: [], matches: [] };
  }

  const active = profiles.filter(isActiveProfile);
  const evaluations = active.map((p) => evaluateJobForProfile(job, p));
  const order = new Map(active.map((p, i) => [p.id, i]));

  const ranked = evaluations
    .filter((e) => e.outcome !== "ineligible")
    .sort(
      (a, b) =>
        Number(b.outcome === "eligible") - Number(a.outcome === "eligible") ||
        (b.relevance ?? -1) - (a.relevance ?? -1) ||
        (order.get(a.profileId) ?? 0) - (order.get(b.profileId) ?? 0),
    );

  return {
    ...base,
    skipped: null,
    profiles: evaluations,
    matches: ranked.map((e, rank) => ({
      profileId: e.profileId,
      profileVersion: e.profileVersion,
      rank,
      status: e.outcome === "eligible" ? "eligible" : "needs_review",
      relevance: e.relevance,
      reasons: e.reasons,
    })),
  };
}

/** Converts an evaluation into the stored/displayed shape. Null when nothing matched. */
export function toJobProfileMatch(
  evaluation: JobEvaluation,
  options: { notifiedAt?: IsoDateTime | null; isDemo: boolean },
): JobProfileMatch | null {
  const [primary] = evaluation.matches;
  if (!primary) return null;
  return {
    jobId: evaluation.jobId,
    dedupeKey: evaluation.dedupeKey,
    matchedProfileIds: evaluation.matches.map((m) => m.profileId),
    primaryProfileId: primary.profileId,
    entries: evaluation.matches,
    engineVersion: evaluation.engineVersion,
    evaluatedAt: evaluation.evaluatedAt,
    notifiedAt: options.notifiedAt ?? null,
    isDemo: options.isDemo,
  };
}
