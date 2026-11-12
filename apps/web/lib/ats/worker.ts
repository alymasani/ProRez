/**
 * Background board-sync worker (Milestone 3B). Runs in its own process
 * (scripts/sync-worker.ts, `npm run worker`) — never inside HTTP handlers.
 *
 * Durable scheduling lives in PostgreSQL, so there is no queue to lose:
 * - `employer_boards.next_sync_at` says when each board is due;
 * - a worker CLAIMS a due board with one atomic UPDATE ... FOR UPDATE SKIP
 *   LOCKED that also sets a lease (owner + expiry). Two workers (or two
 *   processes after a restart) can never claim the same board;
 * - the lease is renewed while the sync runs; if a worker crashes, the lease
 *   expires and any worker reclaims the board (crash recovery);
 * - the per-board "one running sync" unique index still guards against a
 *   manual Sync now overlapping a scheduled run;
 * - syncBoard() records the run, schedules the next one and releases the lease.
 */
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { PrismaClient } from "../generated/prisma/client";
import type { AtsProvider } from "../types";
import type { HttpTransport } from "./http";
import { DEFAULT_WORKER_CONFIG, type WorkerConfig } from "./schedule";
import { syncBoard, type SyncSummary } from "./sync";
import { runDiscoveryIfDue, type DiscoveryDeps } from "../discovery/run";
import type { AtsAdapter } from "./types";

export interface ClaimedBoard {
  id: string;
  provider: AtsProvider;
  employerName: string;
}

export type WorkerLogger = (event: string, fields?: Record<string, unknown>) => void;

/** One line per event: `2026-11-17T10:00:00.000Z [worker] event key=value …` */
export const consoleLogger: WorkerLogger = (event, fields = {}) => {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${typeof v === "string" && /\s/.test(v) ? JSON.stringify(v) : String(v)}`);
  console.log(`${new Date().toISOString()} [worker] ${event}${parts.length ? ` ${parts.join(" ")}` : ""}`);
};

export function newWorkerId(): string {
  return `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
}

/**
 * Atomically claims the most overdue due board, skipping providers already at
 * their concurrency limit. Due = enabled, not demo, `next_sync_at <= now`, and
 * not leased (or the lease expired — a crashed worker). Returns null when none.
 */
export async function claimNextBoard(
  prisma: PrismaClient,
  input: { owner: string; now: Date; leaseMs: number; excludeProviders?: readonly string[] },
): Promise<ClaimedBoard | null> {
  const expires = new Date(input.now.getTime() + input.leaseMs);
  const exclude = [...(input.excludeProviders ?? [])];
  const rows = await prisma.$queryRaw<{ id: string; provider: AtsProvider; employer_name: string }[]>`
    UPDATE "employer_boards" AS b
    SET "sync_lease_owner" = ${input.owner}, "sync_lease_expires_at" = ${expires}
    WHERE b."id" = (
      SELECT "id" FROM "employer_boards"
      WHERE "enabled" AND NOT "is_demo"
        AND "next_sync_at" IS NOT NULL AND "next_sync_at" <= ${input.now}
        AND ("sync_lease_expires_at" IS NULL OR "sync_lease_expires_at" < ${input.now})
        AND NOT ("provider"::text = ANY(${exclude}::text[]))
      ORDER BY "next_sync_at" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING b."id", b."provider", b."employer_name"`;
  const row = rows[0];
  return row ? { id: row.id, provider: row.provider, employerName: row.employer_name } : null;
}

/** Extends a lease the worker still holds. False if it was lost (expired and reclaimed). */
export async function renewLease(prisma: PrismaClient, input: { boardId: string; owner: string; now: Date; leaseMs: number }): Promise<boolean> {
  const updated = await prisma.employerBoard.updateMany({
    where: { id: input.boardId, syncLeaseOwner: input.owner },
    data: { syncLeaseExpiresAt: new Date(input.now.getTime() + input.leaseMs) },
  });
  return updated.count === 1;
}

/** Releases a lease without running (e.g. shutdown before start, or the board vanished). */
export async function releaseLease(prisma: PrismaClient, input: { boardId: string; owner: string; nextSyncAt?: Date | null }) {
  await prisma.employerBoard.updateMany({
    where: { id: input.boardId, syncLeaseOwner: input.owner },
    data: { syncLeaseOwner: null, syncLeaseExpiresAt: null, ...(input.nextSyncAt !== undefined ? { nextSyncAt: input.nextSyncAt } : {}) },
  });
}

export interface WorkerDeps {
  prisma: PrismaClient;
  transport: HttpTransport;
  config?: WorkerConfig;
  owner?: string;
  log?: WorkerLogger;
  now?: () => Date;
  /** Test hook: replace provider adapters. */
  adapterFor?: (provider: AtsProvider) => AtsAdapter | undefined;
  /**
   * Milestone 3C: automatic board discovery runs in the same process, in its
   * own lane (never blocking board syncs), when its durable schedule is due.
   */
  discovery?: () => DiscoveryDeps;
}

/**
 * Runs one claimed board to completion. Never throws: a failure here (e.g. a
 * database outage) releases the lease with a backoff so the board is retried
 * later and other boards keep going.
 */
export async function runClaimedBoard(deps: WorkerDeps, board: ClaimedBoard, signal?: AbortSignal): Promise<SyncSummary | null> {
  const config = deps.config ?? DEFAULT_WORKER_CONFIG;
  const owner = deps.owner ?? newWorkerId();
  const log = deps.log ?? consoleLogger;
  const now = deps.now ?? (() => new Date());

  // Duplicate or stale delivery: only the current lease holder may run the board.
  if (!(await renewLease(deps.prisma, { boardId: board.id, owner, now: now(), leaseMs: config.leaseMs }))) {
    log("claim_stale", { board: board.id, owner });
    return null;
  }

  const heartbeat = setInterval(() => {
    void renewLease(deps.prisma, { boardId: board.id, owner, now: now(), leaseMs: config.leaseMs })
      .then((held) => {
        if (!held) log("lease_lost", { board: board.id });
      })
      .catch(() => undefined);
  }, Math.max(1_000, Math.floor(config.leaseMs / 3)));
  heartbeat.unref?.();

  log("sync_started", { board: board.id, employer: board.employerName, provider: board.provider });
  try {
    const result = await syncBoard(deps.prisma, board.id, {
      transport: deps.transport,
      signal,
      now,
      trigger: "scheduled",
      leaseOwner: owner,
      schedule: config,
      adapter: deps.adapterFor?.(board.provider),
    });
    if (!result.ok) {
      // Disabled or removed between claim and run: stop scheduling it.
      await releaseLease(deps.prisma, { boardId: board.id, owner, nextSyncAt: null });
      log("sync_not_run", { board: board.id, reason: result.code, message: result.message });
      return null;
    }
    const v = result.value;
    const next = await deps.prisma.employerBoard.findUnique({ where: { id: board.id }, select: { nextSyncAt: true } });
    log(v.status === "failed" ? "sync_failed" : "sync_finished", {
      board: board.id,
      employer: board.employerName,
      status: v.status,
      complete: v.complete,
      fetched: v.fetched,
      eligible: v.eligible,
      new: v.created,
      updated: v.updated,
      unchanged: v.unchanged,
      reactivated: v.reactivated,
      missing: v.missing,
      inactivated: v.closed,
      duplicate: v.duplicate,
      filteredLocation: v.filteredLocation,
      filteredEmploymentType: v.filteredEmploymentType,
      invalid: v.invalid,
      enrichmentIncomplete: v.enrichmentIncomplete,
      errors: v.errorCount,
      ms: v.durationMs,
      next: next?.nextSyncAt?.toISOString() ?? "paused",
      ...(v.errorMessage ? { error: v.errorMessage } : {}),
    });
    return v;
  } catch (error) {
    const retryAt = new Date(now().getTime() + config.retryBaseMs);
    log("sync_crashed", { board: board.id, error: error instanceof Error ? error.message : String(error), retry: retryAt.toISOString() });
    await releaseLease(deps.prisma, { boardId: board.id, owner, nextSyncAt: retryAt }).catch(() => undefined);
    return null;
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * Claims and runs due boards until none are left, honouring the global and
 * per-provider concurrency limits. Used by each worker tick and by `--once`.
 */
export async function drainDueBoards(deps: WorkerDeps, signal?: AbortSignal): Promise<SyncSummary[]> {
  const config = deps.config ?? DEFAULT_WORKER_CONFIG;
  const owner = deps.owner ?? newWorkerId();
  const now = deps.now ?? (() => new Date());
  const running = new Map<string, Promise<void>>();
  const perProvider = new Map<string, number>();
  const results: SyncSummary[] = [];

  for (;;) {
    if (signal?.aborted) break;
    if (running.size >= config.concurrency) {
      await Promise.race(running.values());
      continue;
    }
    const busy = [...perProvider].filter(([, n]) => n >= config.perProviderConcurrency).map(([p]) => p);
    const board = await claimNextBoard(deps.prisma, { owner, now: now(), leaseMs: config.leaseMs, excludeProviders: busy });
    if (!board) {
      if (running.size === 0) break;
      // Wait for a slot: a finishing sync may free a provider with more due boards.
      await Promise.race(running.values());
      continue;
    }
    perProvider.set(board.provider, (perProvider.get(board.provider) ?? 0) + 1);
    const task = runClaimedBoard({ ...deps, owner }, board, signal)
      .then((r) => {
        if (r) results.push(r);
      })
      .finally(() => {
        running.delete(board.id);
        perProvider.set(board.provider, (perProvider.get(board.provider) ?? 1) - 1);
      });
    running.set(board.id, task);
  }
  await Promise.allSettled(running.values());
  return results;
}

/**
 * Long-running loop: drains due boards, then sleeps `pollIntervalMs`.
 * `stop()` stops claiming, lets running syncs finish for `graceMs`, then
 * cancels them (cancelled runs are recorded and retried after a backoff).
 */
export function startWorker(deps: WorkerDeps, options: { graceMs?: number } = {}) {
  const config = deps.config ?? DEFAULT_WORKER_CONFIG;
  const owner = deps.owner ?? newWorkerId();
  const log = deps.log ?? consoleLogger;
  const controller = new AbortController();
  let stopping = false;
  let wake: (() => void) | null = null;

  log("worker_started", {
    owner,
    concurrency: config.concurrency,
    perProvider: config.perProviderConcurrency,
    pollSeconds: config.pollIntervalMs / 1000,
    leaseMinutes: config.leaseMs / 60_000,
  });

  // Discovery lane: at most one run in flight, independent of board syncs.
  let discoveryInFlight: Promise<unknown> | null = null;
  const maybeStartDiscovery = () => {
    if (!deps.discovery || discoveryInFlight || stopping) return;
    discoveryInFlight = runDiscoveryIfDue(deps.discovery(), { owner, signal: controller.signal })
      .catch((error: unknown) => log("discovery_failed", { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        discoveryInFlight = null;
      });
  };

  const loop = (async () => {
    while (!stopping) {
      maybeStartDiscovery();
      try {
        const results = await drainDueBoards({ ...deps, owner, config, log }, controller.signal);
        if (results.length > 0) log("tick_done", { synced: results.length });
      } catch (error) {
        log("tick_failed", { error: error instanceof Error ? error.message : String(error) });
      }
      if (stopping) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, config.pollIntervalMs);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      wake = null;
    }
  })();

  return {
    owner,
    async stop() {
      if (stopping) return loop;
      stopping = true;
      log("worker_stopping", { owner });
      (wake as (() => void) | null)?.();
      const grace = setTimeout(() => controller.abort(), options.graceMs ?? 30_000);
      await loop;
      await discoveryInFlight;
      clearTimeout(grace);
      log("worker_stopped", { owner });
    },
  };
}
