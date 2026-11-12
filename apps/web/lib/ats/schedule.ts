/**
 * Scheduling policy for automatic board synchronization (Milestone 3B). Pure:
 * no database or clock access, so every rule is unit-tested.
 *
 * - Each board syncs every `pollIntervalMinutes` (per board; default 360 = 6 h,
 *   set when the board is registered).
 * - Transient failures (rate limits, 5xx, timeouts, network) retry sooner with
 *   exponential backoff + jitter, up to `maxRetries` consecutive failures;
 *   after that the board falls back to its normal interval (no hammering).
 * - A provider Retry-After is always respected as a lower bound.
 * - Permanent configuration errors (unknown board, blocked host) pause
 *   automatic syncing (`nextSyncAt = null`) until the user acts: a manual sync
 *   that succeeds, or disabling and re-enabling the board, resumes it.
 */
import { isPermanentConfigError } from "./errors";

export interface WorkerConfig {
  /** Boards synced at the same time by one worker. */
  concurrency: number;
  /** Boards of the same provider synced at the same time (politeness). */
  perProviderConcurrency: number;
  /** How often the worker looks for due boards. */
  pollIntervalMs: number;
  /** How long a claim is valid without renewal; a crashed worker's boards are reclaimed after it. */
  leaseMs: number;
  /** Consecutive failures retried with backoff before falling back to the normal interval. */
  maxRetries: number;
  /** First retry delay after a failed run; doubles each consecutive failure. */
  retryBaseMs: number;
}

export const DEFAULT_WORKER_CONFIG: WorkerConfig = {
  concurrency: 3,
  perProviderConcurrency: 1,
  pollIntervalMs: 30_000,
  leaseMs: 10 * 60_000,
  maxRetries: 3,
  retryBaseMs: 5 * 60_000,
};

function intFrom(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid worker setting "${raw}": expected a whole number between ${min} and ${max}.`);
  }
  return n;
}

/** Reads PROREZ_WORKER_* / PROREZ_SYNC_* variables; invalid values fail fast at start-up. */
export function workerConfigFromEnv(env: Readonly<Record<string, string | undefined>>): WorkerConfig {
  return {
    concurrency: intFrom(env.PROREZ_WORKER_CONCURRENCY, DEFAULT_WORKER_CONFIG.concurrency, 1, 20),
    perProviderConcurrency: intFrom(env.PROREZ_WORKER_PROVIDER_CONCURRENCY, DEFAULT_WORKER_CONFIG.perProviderConcurrency, 1, 10),
    pollIntervalMs: intFrom(env.PROREZ_WORKER_POLL_SECONDS, DEFAULT_WORKER_CONFIG.pollIntervalMs / 1000, 5, 3600) * 1000,
    leaseMs: intFrom(env.PROREZ_WORKER_LEASE_MINUTES, DEFAULT_WORKER_CONFIG.leaseMs / 60_000, 3, 120) * 60_000,
    maxRetries: intFrom(env.PROREZ_SYNC_MAX_RETRIES, DEFAULT_WORKER_CONFIG.maxRetries, 0, 10),
    retryBaseMs: intFrom(env.PROREZ_SYNC_RETRY_BASE_MINUTES, DEFAULT_WORKER_CONFIG.retryBaseMs / 60_000, 1, 1440) * 60_000,
  };
}

export type RunOutcome =
  | { status: "succeeded" | "partial" }
  | { status: "failed"; errorCode: string; retryAfterMs?: number }
  /** Another sync of the board was already running. */
  | { status: "skipped" };

/** Spread ±10% so many boards registered together do not stay in lock-step. */
function jitter(ms: number, random: () => number): number {
  return Math.round(ms * (0.9 + random() * 0.2));
}

/**
 * When the board should next be synced automatically, or null to pause.
 * `consecutiveFailures` is the count AFTER this run.
 */
export function nextSyncAfter(input: {
  outcome: RunOutcome;
  now: Date;
  intervalMinutes: number;
  consecutiveFailures: number;
  enabled: boolean;
  isDemo: boolean;
  config?: Pick<WorkerConfig, "maxRetries" | "retryBaseMs">;
  random?: () => number;
}): Date | null {
  const { outcome, now, intervalMinutes, consecutiveFailures, enabled, isDemo } = input;
  const config = input.config ?? DEFAULT_WORKER_CONFIG;
  const random = input.random ?? Math.random;
  if (!enabled || isDemo) return null;

  const intervalMs = intervalMinutes * 60_000;
  const at = (ms: number) => new Date(now.getTime() + ms);

  switch (outcome.status) {
    case "succeeded":
    case "partial":
      return at(jitter(intervalMs, random));
    case "skipped":
      // A sync is already running (usually a manual one); look again shortly.
      return at(jitter(Math.min(intervalMs, 5 * 60_000), random));
    case "failed": {
      if (isPermanentConfigError(outcome.errorCode)) return null;
      const floor = outcome.retryAfterMs ?? 0;
      if (consecutiveFailures > config.maxRetries) return at(Math.max(floor, jitter(intervalMs, random)));
      const backoff = Math.min(intervalMs, config.retryBaseMs * 2 ** Math.max(0, consecutiveFailures - 1));
      return at(Math.max(floor, jitter(backoff, random)));
    }
  }
}
