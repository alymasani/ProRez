import type { StatusMeta } from "../labels";
import type { EmployerBoard } from "../types";

/** Failures in a row before a board is shown as failing (polling will use the same rule). */
export const FAILING_AFTER = 3;

export type BoardHealth = "disabled" | "never_checked" | "healthy" | "degraded" | "failing";

export function boardHealth(board: Pick<EmployerBoard, "enabled" | "lastCheckedAt" | "consecutiveFailures">): BoardHealth {
  if (!board.enabled) return "disabled";
  if (board.consecutiveFailures >= FAILING_AFTER) return "failing";
  if (board.consecutiveFailures > 0) return "degraded";
  if (!board.lastCheckedAt) return "never_checked";
  return "healthy";
}

export const BOARD_HEALTH: Record<BoardHealth, StatusMeta> = {
  disabled: { label: "Disabled", tone: "muted" },
  never_checked: { label: "Not checked yet", tone: "neutral" },
  healthy: { label: "Healthy", tone: "success" },
  degraded: { label: "Recent failure", tone: "warning" },
  failing: { label: "Failing", tone: "danger" },
};

export function formatPollInterval(minutes: number): string {
  if (minutes % 1440 === 0) return `every ${minutes / 1440} day${minutes === 1440 ? "" : "s"}`;
  if (minutes % 60 === 0) return `every ${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `every ${minutes} minutes`;
}

/** Display state for the boards page. */
export type BoardSyncState = "disabled" | "demo" | "running" | "scheduled" | "retrying" | "paused";

export function boardSyncState(board: {
  enabled: boolean;
  isDemo: boolean;
  nextSyncAt: string | null;
  running: boolean;
  consecutiveFailures: number;
}): BoardSyncState {
  if (!board.enabled) return "disabled";
  if (board.running) return "running";
  if (board.isDemo) return "demo";
  if (!board.nextSyncAt) return "paused";
  return board.consecutiveFailures > 0 ? "retrying" : "scheduled";
}
