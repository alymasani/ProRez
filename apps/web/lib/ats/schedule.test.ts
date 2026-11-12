import { describe, expect, it } from "vitest";
import { boardSyncState } from "../boards/health";
import { DEFAULT_WORKER_CONFIG, nextSyncAfter, workerConfigFromEnv } from "./schedule";

const now = new Date("2026-11-17T12:00:00Z");
const mid = () => 0.5; // jitter factor exactly 1.0
const base = { now, intervalMinutes: 360, consecutiveFailures: 0, enabled: true, isDemo: false, random: mid };
const minutesFromNow = (d: Date | null) => (d ? (d.getTime() - now.getTime()) / 60_000 : null);

describe("nextSyncAfter", () => {
  it("schedules successful and partial runs one interval later (default 6 h)", () => {
    expect(minutesFromNow(nextSyncAfter({ ...base, outcome: { status: "succeeded" } }))).toBe(360);
    expect(minutesFromNow(nextSyncAfter({ ...base, outcome: { status: "partial" } }))).toBe(360);
  });

  it("applies ±10% jitter so boards do not run in lock-step", () => {
    expect(minutesFromNow(nextSyncAfter({ ...base, outcome: { status: "succeeded" }, random: () => 0 }))).toBe(324);
    expect(minutesFromNow(nextSyncAfter({ ...base, outcome: { status: "succeeded" }, random: () => 1 }))).toBe(396);
  });

  it("retries transient failures with exponential backoff, then falls back to the interval", () => {
    const failed = (n: number) => minutesFromNow(nextSyncAfter({ ...base, consecutiveFailures: n, outcome: { status: "failed", errorCode: "http_error" } }));
    expect([failed(1), failed(2), failed(3)]).toEqual([5, 10, 20]);
    expect(failed(4)).toBe(360); // beyond maxRetries (3): normal interval, no hammering
  });

  it("never schedules a retry sooner than the provider's Retry-After", () => {
    const at = nextSyncAfter({ ...base, consecutiveFailures: 1, outcome: { status: "failed", errorCode: "rate_limited", retryAfterMs: 45 * 60_000 } });
    expect(minutesFromNow(at)).toBe(45);
  });

  it("pauses (null) on permanent configuration errors instead of retrying forever", () => {
    for (const errorCode of ["not_found", "invalid_board", "blocked_host"]) {
      expect(nextSyncAfter({ ...base, consecutiveFailures: 1, outcome: { status: "failed", errorCode } })).toBeNull();
    }
  });

  it("never schedules disabled or demo boards", () => {
    expect(nextSyncAfter({ ...base, enabled: false, outcome: { status: "succeeded" } })).toBeNull();
    expect(nextSyncAfter({ ...base, isDemo: true, outcome: { status: "succeeded" } })).toBeNull();
  });

  it("looks again soon after a skipped run (another sync was running)", () => {
    expect(minutesFromNow(nextSyncAfter({ ...base, outcome: { status: "skipped" } }))).toBe(5);
  });
});

describe("workerConfigFromEnv", () => {
  it("defaults to concurrency 3, 3 retries and a 10-minute lease", () => {
    expect(workerConfigFromEnv({})).toEqual(DEFAULT_WORKER_CONFIG);
    expect(DEFAULT_WORKER_CONFIG).toMatchObject({ concurrency: 3, maxRetries: 3, perProviderConcurrency: 1 });
  });

  it("reads overrides and rejects invalid values at start-up", () => {
    expect(workerConfigFromEnv({ PROREZ_WORKER_CONCURRENCY: "5", PROREZ_WORKER_POLL_SECONDS: "60" })).toMatchObject({ concurrency: 5, pollIntervalMs: 60_000 });
    expect(() => workerConfigFromEnv({ PROREZ_WORKER_CONCURRENCY: "0" })).toThrow(/between 1 and 20/);
    expect(() => workerConfigFromEnv({ PROREZ_SYNC_MAX_RETRIES: "lots" })).toThrow();
  });
});

describe("boardSyncState", () => {
  const b = { enabled: true, isDemo: false, nextSyncAt: "2026-11-17T18:00:00Z", running: false, consecutiveFailures: 0 };
  it("maps board state for the boards page", () => {
    expect(boardSyncState(b)).toBe("scheduled");
    expect(boardSyncState({ ...b, consecutiveFailures: 2 })).toBe("retrying");
    expect(boardSyncState({ ...b, nextSyncAt: null })).toBe("paused");
    expect(boardSyncState({ ...b, running: true })).toBe("running");
    expect(boardSyncState({ ...b, enabled: false })).toBe("disabled");
    expect(boardSyncState({ ...b, isDemo: true, nextSyncAt: null })).toBe("demo");
  });
});
