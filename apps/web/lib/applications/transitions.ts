/**
 * Actual application status ("submission status") rules. Pure.
 *
 * Shown as:   not_submitted = Not applied, submitted = Applied, interviewing,
 *             offer, rejected, withdrawn.
 *
 *   Not applied  → Applied (requires the date you applied)
 *   Applied      → Interviewing | Offer | Rejected | Withdrawn
 *   Interviewing → Offer | Rejected | Withdrawn
 *   Offer        → Rejected (rescinded) | Withdrawn (declined)
 *   Rejected / Withdrawn → Applied | Interviewing (reopen after a mistake or a
 *                          recruiter coming back)
 *
 * Once an application is recorded as applied it can never return to "Not
 * applied": the date and history are kept. Preparation status (generated
 * materials) is separate and never changes the submission status.
 *
 * Database integrity (CHECK applications_submission_consistency): the date is
 * set exactly when the status is applied/interviewing/offer/rejected; a
 * withdrawal may keep it.
 */
import { addDays, calendarDateToTimestamp, isCalendarDate, timestampToCalendarDate } from "../format";
import type { ApplicationEventType, SubmissionStatus } from "../types";

export const SUBMISSION_TRANSITIONS: Record<SubmissionStatus, readonly SubmissionStatus[]> = {
  not_submitted: ["submitted"],
  submitted: ["interviewing", "offer", "rejected", "withdrawn"],
  interviewing: ["offer", "rejected", "withdrawn"],
  offer: ["rejected", "withdrawn"],
  rejected: ["submitted", "interviewing"],
  withdrawn: ["submitted", "interviewing"],
};

/** Statuses that require a recorded application date. */
export const DATED_STATUSES: readonly SubmissionStatus[] = ["submitted", "interviewing", "offer", "rejected"];

/** Earliest date accepted for an application or interview. */
export const EARLIEST_DATE = "2000-01-01";

export interface PlannedEvent {
  type: ApplicationEventType;
  fromValue: string | null;
  toValue: string | null;
  message: string | null;
}

export type SubmissionPlan =
  | { ok: true; status: SubmissionStatus; submittedAt: string | null; events: PlannedEvent[] }
  | { ok: false; field?: "status" | "submittedOn"; message: string };

export function allowedSubmissionTransitions(status: SubmissionStatus): readonly SubmissionStatus[] {
  return SUBMISSION_TRANSITIONS[status];
}

/** Validates a user-entered "date applied". `today` is the user's current date. */
export function validateApplicationDate(date: string, today: string): string | null {
  if (!isCalendarDate(date)) return "Enter a valid date.";
  if (date < EARLIEST_DATE) return "That date is too far in the past.";
  // One day of tolerance for time zones ahead of Toronto.
  if (date > addDays(today, 1)) return "The application date can't be in the future.";
  return null;
}

export function planSubmissionChange(
  current: { status: SubmissionStatus; submittedAt: string | null },
  request: { to: SubmissionStatus; submittedOn?: string | null; note?: string | null },
  today: string,
): SubmissionPlan {
  const { to } = request;
  if (to === current.status) return { ok: false, field: "status", message: "The application already has this status." };
  if (!SUBMISSION_TRANSITIONS[current.status].includes(to)) {
    return {
      ok: false,
      field: "status",
      message:
        current.status !== "not_submitted" && to === "not_submitted"
          ? "An application recorded as applied can't go back to “Not applied”. Its date and history are kept."
          : "That status change isn't allowed from the current status.",
    };
  }

  let submittedAt = current.submittedAt;
  const needsDate = DATED_STATUSES.includes(to) && submittedAt === null;
  if (needsDate) {
    const date = request.submittedOn?.trim() ?? "";
    if (!date) return { ok: false, field: "submittedOn", message: "Enter the date you applied." };
    const error = validateApplicationDate(date, today);
    if (error) return { ok: false, field: "submittedOn", message: error };
    submittedAt = calendarDateToTimestamp(date);
  }

  const note = request.note?.trim() || null;
  const recorded = current.status === "not_submitted" && to === "submitted";
  const events: PlannedEvent[] = [
    recorded
      ? {
          type: "submission_recorded",
          fromValue: current.status,
          toValue: to,
          message: note ?? `Applied on ${timestampToCalendarDate(submittedAt as string)} (recorded by you).`,
        }
      : { type: "submission_status_changed", fromValue: current.status, toValue: to, message: note },
  ];
  return { ok: true, status: to, submittedAt, events };
}

export type DateCorrectionPlan = { ok: true; submittedAt: string; event: PlannedEvent } | { ok: false; message: string };

export function planSubmissionDateCorrection(currentSubmittedAt: string | null, date: string, today: string): DateCorrectionPlan {
  if (currentSubmittedAt === null) return { ok: false, message: "Record that you applied before correcting the date." };
  const error = validateApplicationDate(date, today);
  if (error) return { ok: false, message: error };
  const before = timestampToCalendarDate(currentSubmittedAt);
  if (before === date) return { ok: false, message: "That is already the recorded date." };
  return {
    ok: true,
    submittedAt: calendarDateToTimestamp(date),
    event: { type: "submission_date_changed", fromValue: before, toValue: date, message: null },
  };
}

/**
 * Recording an interview: requires an application that was submitted; moves
 * "Applied" to "Interviewing" automatically (and says so in history).
 */
export function planInterviewStatus(
  status: SubmissionStatus,
): { ok: true; moveTo: SubmissionStatus | null } | { ok: false; message: string } {
  if (status === "not_submitted") return { ok: false, message: "Record that you applied before adding interviews." };
  return { ok: true, moveTo: status === "submitted" ? "interviewing" : null };
}

export function validateInterviewDate(date: string, today: string): string | null {
  if (!isCalendarDate(date)) return "Enter a valid date.";
  if (date < EARLIEST_DATE) return "That date is too far in the past.";
  if (date > addDays(today, 366)) return "Interviews can be scheduled at most a year ahead.";
  return null;
}
