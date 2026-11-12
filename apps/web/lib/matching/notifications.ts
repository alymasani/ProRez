/**
 * Decides which jobs would trigger a notification. Pure; nothing is sent.
 *
 * Guarantees (unit tested):
 * - At most ONE decision to send per job, however many profiles match.
 * - At most ONE per dedupe key, so the same posting stored twice is reported once.
 * - Never re-sends a job that already has `notifiedAt`.
 * - Candidate-fit gating happens here, separately from eligibility.
 */
import type { JobProfileMatch, SearchProfile } from "../types";

export type SuppressionReason =
  | "no_matching_profile"
  | "only_needs_review"
  | "notifications_disabled"
  | "awaiting_fit_score"
  | "below_fit_threshold"
  | "already_notified"
  | "duplicate_posting";

export type NotificationDecision =
  | { jobId: string; send: true; profileId: string; dedupeKey: string }
  | { jobId: string; send: false; reason: SuppressionReason };

export interface NotificationCandidate {
  jobId: string;
  match: JobProfileMatch | null;
  /** Candidate-fit score (0–100), or null if not scored yet. */
  fitScore: number | null;
}

export function planNotifications(
  candidates: readonly NotificationCandidate[],
  profiles: readonly SearchProfile[],
): NotificationDecision[] {
  const byId = new Map(profiles.map((p) => [p.id, p]));
  const sentKeys = new Set<string>();

  return candidates.map(({ jobId, match, fitScore }): NotificationDecision => {
    if (!match || match.entries.length === 0) return { jobId, send: false, reason: "no_matching_profile" };
    if (match.notifiedAt) {
      sentKeys.add(match.dedupeKey);
      return { jobId, send: false, reason: "already_notified" };
    }
    if (sentKeys.has(match.dedupeKey)) return { jobId, send: false, reason: "duplicate_posting" };

    const eligible = match.entries.filter((e) => e.status === "eligible");
    if (eligible.length === 0) return { jobId, send: false, reason: "only_needs_review" };

    const notifying = eligible.filter((e) => byId.get(e.profileId)?.notifications.enabled);
    if (notifying.length === 0) return { jobId, send: false, reason: "notifications_disabled" };
    if (fitScore === null) return { jobId, send: false, reason: "awaiting_fit_score" };

    // Highest-ranked notifying profile whose fit threshold is met governs the single notification.
    const chosen = notifying.find((e) => fitScore >= (byId.get(e.profileId)?.minFitScore ?? 101));
    if (!chosen) return { jobId, send: false, reason: "below_fit_threshold" };

    sentKeys.add(match.dedupeKey);
    return { jobId, send: true, profileId: chosen.profileId, dedupeKey: match.dedupeKey };
  });
}
