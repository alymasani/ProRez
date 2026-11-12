/**
 * Discovery-status actions for a job. Pure; the service applies them with a
 * compare-and-swap on the current status and records a job event.
 *
 *   save     discovered → saved
 *   unsave   saved → discovered
 *   dismiss  discovered | saved → dismissed
 *   expire   discovered | saved → expired      (the posting closed)
 *   restore  dismissed → the status before dismissal
 *   reopen   expired → the status before it expired
 *
 * Nothing here touches applications: dismissing a job never deletes or
 * changes its application history.
 */
import type { DiscoveryStatus } from "../types";
import type { DiscoveryAction } from "./schema";

const RULES: Record<DiscoveryAction, { from: readonly DiscoveryStatus[]; to: DiscoveryStatus | "previous" }> = {
  save: { from: ["discovered"], to: "saved" },
  unsave: { from: ["saved"], to: "discovered" },
  dismiss: { from: ["discovered", "saved"], to: "dismissed" },
  expire: { from: ["discovered", "saved"], to: "expired" },
  restore: { from: ["dismissed"], to: "previous" },
  reopen: { from: ["expired"], to: "previous" },
};

export const DISCOVERY_ACTION_LABELS: Record<DiscoveryAction, string> = {
  save: "Save job",
  unsave: "Unsave",
  dismiss: "Dismiss",
  expire: "Mark expired",
  restore: "Restore",
  reopen: "Mark as open again",
};

export function availableDiscoveryActions(status: DiscoveryStatus): DiscoveryAction[] {
  return (Object.keys(RULES) as DiscoveryAction[]).filter((a) => RULES[a].from.includes(status));
}

export type DiscoveryPlan = { ok: true; to: DiscoveryStatus } | { ok: false; message: string };

/**
 * @param previous the status before the job became dismissed/expired (from its
 *   history); anything other than discovered/saved falls back to discovered.
 */
export function planDiscoveryAction(
  current: DiscoveryStatus,
  action: DiscoveryAction,
  previous: string | null = null,
): DiscoveryPlan {
  const rule = RULES[action];
  if (!rule.from.includes(current)) {
    return { ok: false, message: `“${DISCOVERY_ACTION_LABELS[action]}” isn't available for a ${current} job.` };
  }
  if (rule.to !== "previous") return { ok: true, to: rule.to };
  return { ok: true, to: previous === "saved" ? "saved" : "discovered" };
}

/** Status changes that alter whether matching runs for the job. */
export function affectsEvaluation(from: DiscoveryStatus, to: DiscoveryStatus): boolean {
  const inactive = (s: DiscoveryStatus) => s === "dismissed" || s === "expired";
  return inactive(from) !== inactive(to);
}
