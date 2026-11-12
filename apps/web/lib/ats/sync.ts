/**
 * Synchronization of ONE employer board — triggered manually (Sync now) or by
 * the background worker (lib/ats/worker.ts). Both paths run this function, so
 * they share one pipeline and one per-board lock.
 *
 * 1. Claim the board: insert a `running` board_sync_runs row. A partial unique
 *    index allows one running sync per board, so concurrent syncs are refused.
 *    Runs left `running` longer than STALE_RUN_MS (e.g. a crashed process) are
 *    closed as failed first, so a retry is always possible.
 * 2. Fetch every published posting with the provider adapter (outside any
 *    transaction; cancellable; bounded by timeouts).
 * 3. Ingest each posting in its own transaction (idempotent):
 *    - identity = (provider, board token, posting id) on source_observations,
 *      the same identity manual URL submissions record — so a job you saved
 *      by hand is matched, not duplicated;
 *    - otherwise an existing job with the same canonical URL or the same
 *      company + title + location gets another sighting;
 *    - otherwise a new canonical job is created (origin "automatic").
 *    Unchanged postings only refresh last-seen. Changed postings update
 *    provider-derived fields of AUTOMATIC jobs; manually added jobs, notes,
 *    discovery status and applications are never overwritten. Every
 *    description version is kept as an immutable snapshot.
 * 4. Reconcile absences — ONLY when the adapter vouches the catalogue is
 *    complete and every posting was ingested: each active posting not listed
 *    gets `missing_count + 1`; at MISSING_RUNS_TO_INACTIVATE consecutive
 *    absences it becomes inactive (`closed_at`), and an automatic job whose
 *    every sighting is inactive is marked expired (with a history event).
 *    Failed, partial or truncated runs never inactivate or expire anything.
 *    A posting listed again is reactivated (counter reset, job reopened).
 * 5. New and materially changed jobs are evaluated against all enabled profiles.
 * 6. The run and the board record counts, duration, errors and the next
 *    automatic sync time (lib/ats/schedule.ts); a worker's lease is released.
 */
import { assessDescription } from "../jobs/description";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { buildDedupeKey } from "../jobs/dedupe";
import { JOB_INTAKE_LOCK_KEY, sha256 } from "../jobs/service";
import { normalizeJobUrl } from "../jobs/url";
import { reevaluateJobsInTx } from "../matching/persist";
import { fail, prismaErrorCode, type MutationResult } from "../mutations/result";
import type { AtsProvider } from "../types";
import { AtsError, type HttpTransport } from "./http";
import { normalizePosting, type ImportedJob } from "./normalize";
import { ATS_ADAPTERS } from "./registry";
import { nextSyncAfter, type RunOutcome, type WorkerConfig } from "./schedule";
import type { AtsAdapter, ProviderPosting } from "./types";

type Tx = Prisma.TransactionClient;

export const STALE_RUN_MS = 15 * 60_000;
/** Consecutive complete snapshots a posting must be absent from before it is inactivated. */
export const MISSING_RUNS_TO_INACTIVATE = 2;
export const SYNC_TIMEOUT_MS = 120_000;
const MAX_DETAIL_ENTRIES = 200;

export const SOURCE_ID_BY_PROVIDER: Record<AtsProvider, string> = {
  greenhouse: "src-greenhouse",
  lever: "src-lever",
  ashby: "src-ashby",
  smartrecruiters: "src-smartrecruiters",
};

export type SyncTriggerKind = "manual" | "scheduled";

export interface SyncSummary {
  runId: string;
  trigger: SyncTriggerKind;
  /** succeeded: complete snapshot; partial: imported but incomplete (nothing expired). */
  status: "succeeded" | "partial" | "failed" | "skipped";
  /** Whether the provider catalogue was provably complete. */
  complete: boolean;
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  reactivated: number;
  /** Active postings absent from this complete snapshot. */
  missing: number;
  /** Newly inactivated postings (absent from two consecutive complete snapshots). */
  closed: number;
  skipped: number;
  errorCount: number;
  durationMs: number;
  errorMessage: string | null;
}

export interface SyncOptions {
  transport: HttpTransport;
  signal?: AbortSignal;
  now?: () => Date;
  /** Test hook: replace the provider adapter. */
  adapter?: AtsAdapter;
  /** Defaults to "manual". */
  trigger?: SyncTriggerKind;
  /** Set by the worker: the lease it holds on this board, released when the run ends. */
  leaseOwner?: string;
  /** Retry/backoff settings for scheduling the next automatic run. */
  schedule?: Pick<WorkerConfig, "maxRetries" | "retryBaseMs">;
  random?: () => number;
}

type Outcome = "created" | "updated" | "unchanged" | "reactivated";
/** "warning": imported, but needs attention (e.g. missing or incomplete description). */
type Detail = { postingId: string; kind: "skipped" | "error" | "warning"; message: string };

export async function syncBoard(prisma: PrismaClient, boardId: string, options: SyncOptions): Promise<MutationResult<SyncSummary>> {
  const now = options.now ?? (() => new Date());
  const board = await prisma.employerBoard.findUnique({ where: { id: boardId } });
  if (!board) return fail("not_found", "This board no longer exists.");
  if (!board.enabled) return fail("invalid_transition", "This board is disabled. Enable it before syncing.");
  const trigger = options.trigger ?? "manual";
  const provider = board.provider as AtsProvider;
  const adapter = options.adapter ?? ATS_ADAPTERS[provider];
  if (!adapter) return fail("validation", "This provider is not supported for syncing.");

  // --- 1. Claim the board
  const startedAt = now();
  await prisma.boardSyncRun.updateMany({
    where: { boardId, status: "running", startedAt: { lt: new Date(startedAt.getTime() - STALE_RUN_MS) } },
    data: { status: "failed", finishedAt: startedAt, durationMs: STALE_RUN_MS, errorCode: "stale", errorMessage: "Run did not finish (process stopped)." },
  });
  let runId: string;
  try {
    runId = (await prisma.boardSyncRun.create({ data: { id: randomUUID(), boardId, startedAt, trigger }, select: { id: true } })).id;
  } catch (error) {
    if (prismaErrorCode(error) !== "P2002") throw error;
    if (trigger === "manual") return fail("sync_in_progress", "This board is already syncing. Wait for it to finish.");
    // Scheduled run collided with a running (usually manual) sync: record it as skipped and look again soon.
    return { ok: true, value: await recordSkipped(prisma, board, startedAt, options) };
  }

  const counts = { fetched: 0, created: 0, updated: 0, unchanged: 0, reactivated: 0, missing: 0, closed: 0, skipped: 0, errorCount: 0 };
  let complete = false;
  let ingestErrors = 0;
  const details: Detail[] = [];
  const toEvaluate = new Set<string>();

  const finish = async (
    status: "succeeded" | "partial" | "failed",
    error: { code: string; message: string; retryAfterMs?: number } | null,
  ): Promise<SyncSummary> => {
    const finishedAt = now();
    const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());
    const failures = status === "failed" ? board.consecutiveFailures + 1 : 0;
    const outcome: RunOutcome = status === "failed" ? { status, errorCode: error?.code ?? "unexpected", retryAfterMs: error?.retryAfterMs } : { status };
    const nextSyncAt = nextSyncAfter({
      outcome,
      now: finishedAt,
      intervalMinutes: board.pollIntervalMinutes,
      consecutiveFailures: failures,
      enabled: board.enabled,
      isDemo: board.isDemo,
      config: options.schedule,
      random: options.random,
    });
    await prisma.$transaction([
      prisma.boardSyncRun.update({
        where: { id: runId },
        data: {
          status,
          finishedAt,
          durationMs,
          ...counts,
          complete,
          errorCode: error?.code ?? null,
          errorMessage: error?.message ?? null,
          details: details.slice(0, MAX_DETAIL_ENTRIES),
        },
      }),
      ...releaseLease(prisma, boardId, options.leaseOwner),
      prisma.employerBoard.update({
        where: { id: boardId },
        data:
          status === "failed"
            ? {
                lastCheckedAt: finishedAt,
                consecutiveFailures: { increment: 1 },
                lastErrorAt: finishedAt,
                lastErrorCode: error?.code ?? "unexpected",
                lastErrorMessage: error?.message ?? "Sync failed.",
                nextSyncAt,
              }
            : {
                lastCheckedAt: finishedAt,
                lastSuccessAt: finishedAt,
                consecutiveFailures: 0,
                // A partial run is not a failure, but its reason stays visible.
                lastErrorAt: status === "partial" ? finishedAt : null,
                lastErrorCode: status === "partial" ? "incomplete" : null,
                lastErrorMessage: status === "partial" ? (error?.message ?? null) : null,
                nextSyncAt,
              },
      }),
    ]);
    return { runId, trigger, status, complete, ...counts, durationMs, errorMessage: error?.message ?? null };
  };

  try {
    // --- 2. Fetch
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(SYNC_TIMEOUT_MS)]) : AbortSignal.timeout(SYNC_TIMEOUT_MS);
    const result = await adapter.fetchPostings(board.boardToken, { transport: options.transport, signal });
    counts.fetched = result.postings.length;
    complete = result.complete;
    for (const w of result.warnings) {
      counts.errorCount++;
      details.push({ postingId: "", kind: "error", message: w });
    }

    // --- 3. Ingest
    const seen = new Set<string>();
    for (const posting of result.postings) {
      if (signal.aborted) throw new AtsError("cancelled", "The sync was cancelled.");
      seen.add(posting.postingId);
      const normalized = normalizePosting(posting, board.employerName);
      try {
        if (!normalized.ok) {
          counts.skipped++;
          details.push({ postingId: posting.postingId, kind: "skipped", message: normalized.reason });
          await touchIfKnown(prisma, provider, board.boardToken, posting.postingId, now());
          continue;
        }
        const outcome = await ingestPosting(prisma, { boardId, provider, boardToken: board.boardToken, posting, job: normalized.job, now: now() });
        counts[outcome.outcome]++;
        // Imported, but not silently treated as complete: later tailoring depends on the full text.
        const description = assessDescription(normalized.job.description);
        if (description.status !== "complete" && outcome.outcome !== "unchanged") {
          details.push({ postingId: posting.postingId, kind: "warning", message: `${normalized.job.title}: ${description.message}` });
        }
        if (outcome.evaluate) toEvaluate.add(outcome.jobId);
      } catch (error) {
        counts.errorCount++;
        ingestErrors++;
        details.push({ postingId: posting.postingId, kind: "error", message: error instanceof Error ? error.message.slice(0, 300) : "Unknown error" });
      }
    }

    // --- 4. Reconcile absences — only for a complete snapshot that was fully ingested.
    const reliable = complete && ingestErrors === 0;
    if (reliable) {
      const missing = await reconcileMissing(prisma, { provider, boardToken: board.boardToken, seen, now: now() });
      counts.missing = missing.missing;
      counts.closed = missing.inactivated;
      missing.expiredJobIds.forEach((id) => toEvaluate.add(id));
    }

    // --- 5. Evaluate new and changed jobs
    if (toEvaluate.size > 0) {
      await prisma.$transaction((tx) => reevaluateJobsInTx(tx, { jobIds: [...toEvaluate] }), { timeout: 60_000 });
    }
    if (reliable) return { ok: true, value: await finish("succeeded", null) };
    const why = !complete
      ? (result.incompleteReason ?? "The provider catalogue could not be confirmed complete.")
      : `${ingestErrors} posting${ingestErrors === 1 ? "" : "s"} could not be saved.`;
    return { ok: true, value: await finish("partial", { code: "incomplete", message: `${why} No postings were marked missing or inactive.` }) };
  } catch (error) {
    const code = error instanceof AtsError ? error.code : "unexpected";
    const message = error instanceof AtsError ? error.message : "The sync failed unexpectedly. Already-imported postings are kept; it is safe to retry.";
    if (!(error instanceof AtsError)) console.error("[ats] sync failed", error);
    counts.errorCount++;
    // Jobs ingested before the failure still deserve evaluation.
    if (toEvaluate.size > 0) {
      await prisma.$transaction((tx) => reevaluateJobsInTx(tx, { jobIds: [...toEvaluate] }), { timeout: 60_000 }).catch(() => undefined);
    }
    return { ok: true, value: await finish("failed", { code, message, retryAfterMs: error instanceof AtsError ? error.retryAfterMs : undefined }) };
  }
}

/** Releases the caller's worker lease — never another worker's. */
function releaseLease(prisma: PrismaClient, boardId: string, owner: string | undefined) {
  return owner
    ? [prisma.employerBoard.updateMany({ where: { id: boardId, syncLeaseOwner: owner }, data: { syncLeaseOwner: null, syncLeaseExpiresAt: null } })]
    : [];
}

/** A scheduled run that found the board already syncing: recorded, not run. */
async function recordSkipped(
  prisma: PrismaClient,
  board: { id: string; pollIntervalMinutes: number; consecutiveFailures: number; enabled: boolean; isDemo: boolean },
  at: Date,
  options: SyncOptions,
): Promise<SyncSummary> {
  const message = "Skipped: another sync of this board was already running.";
  const nextSyncAt = nextSyncAfter({
    outcome: { status: "skipped" },
    now: at,
    intervalMinutes: board.pollIntervalMinutes,
    consecutiveFailures: board.consecutiveFailures,
    enabled: board.enabled,
    isDemo: board.isDemo,
    config: options.schedule,
    random: options.random,
  });
  const [run] = await prisma.$transaction([
    prisma.boardSyncRun.create({
      data: { boardId: board.id, trigger: "scheduled", status: "skipped", startedAt: at, finishedAt: at, durationMs: 0, errorCode: "sync_in_progress", errorMessage: message },
      select: { id: true },
    }),
    prisma.employerBoard.update({ where: { id: board.id }, data: { nextSyncAt } }),
    ...releaseLease(prisma, board.id, options.leaseOwner),
  ]);
  return {
    runId: run.id, trigger: "scheduled", status: "skipped", complete: false,
    fetched: 0, created: 0, updated: 0, unchanged: 0, reactivated: 0, missing: 0, closed: 0, skipped: 0, errorCount: 0,
    durationMs: 0, errorMessage: message,
  };
}

const identity = (provider: AtsProvider, boardToken: string, postingId: string) => ({
  atsProvider: provider,
  atsBoardToken: boardToken,
  atsPostingId: postingId.toLowerCase(),
});

async function touchIfKnown(prisma: PrismaClient, provider: AtsProvider, boardToken: string, postingId: string, at: Date) {
  await prisma.sourceObservation.updateMany({ where: identity(provider, boardToken, postingId), data: { lastSeenAt: at, closedAt: null, missingCount: 0 } });
}

interface IngestInput {
  boardId: string;
  provider: AtsProvider;
  boardToken: string;
  posting: ProviderPosting;
  job: ImportedJob;
  now: Date;
}

export async function ingestPosting(
  prisma: PrismaClient,
  input: IngestInput,
): Promise<{ outcome: Outcome; jobId: string; evaluate: boolean }> {
  const { provider, boardToken, posting, job, now } = input;
  const id = identity(provider, boardToken, posting.postingId);
  const canonicalUrl = job.url ? safeCanonical(job.url) : null;
  const observationFields = {
    boardId: input.boardId,
    sourceUrl: job.url,
    rawTitle: posting.title.slice(0, 300),
    payload: { provider, metadata: posting.metadata, employmentType: posting.employmentType, department: posting.department, normalization: job.notes } as Prisma.InputJsonObject,
    providerPublishedAt: posting.publishedAt ? new Date(posting.publishedAt) : null,
    publishedAtKind: posting.publishedAt ? posting.publishedAtKind : "none",
    contentHash: job.contentHash,
    // Listed now: active, absence counter reset.
    closedAt: null,
    missingCount: 0,
    lastSeenAt: now,
  } as const;

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${JOB_INTAKE_LOCK_KEY})`;
      const existing = await tx.sourceObservation.findUnique({
        where: { atsProvider_atsBoardToken_atsPostingId: id },
        include: { job: { select: { id: true, origin: true, description: true, dedupeKey: true, discoveryStatus: true } } },
      });

      // --- Known posting
      if (existing) {
        const changed = existing.contentHash !== job.contentHash;
        await tx.sourceObservation.update({
          where: { id: existing.id },
          data: {
            ...observationFields,
            sourceId: existing.sourceId === "src-manual" ? existing.sourceId : SOURCE_ID_BY_PROVIDER[provider],
            // Keep the first publication time we saw.
            providerPublishedAt: existing.providerPublishedAt ?? observationFields.providerPublishedAt,
            publishedAtKind: existing.providerPublishedAt ? existing.publishedAtKind : observationFields.publishedAtKind,
          },
        });
        const reopened = await reopenIfExpiredBySync(tx, existing.jobId, existing.job.discoveryStatus, provider, now);
        // Same identity as before; it was inactive and is listed again.
        const wasInactive = existing.closedAt !== null;
        if (!changed) return { outcome: wasInactive ? ("reactivated" as const) : ("unchanged" as const), jobId: existing.jobId, evaluate: reopened };
        if (existing.job.origin === "automatic") {
          await applyProviderDetails(tx, existing.jobId, existing.job, job, provider, now);
          return { outcome: wasInactive ? ("reactivated" as const) : ("updated" as const), jobId: existing.jobId, evaluate: true };
        }
        // Manually added: keep the user's details; record that the source changed.
        await tx.jobEvent.create({
          data: {
            jobId: existing.jobId,
            type: "sighting_added",
            toValue: provider,
            message: `The ${provider} posting changed. Your manually entered details were kept.`,
            occurredAt: now,
          },
        });
        return { outcome: wasInactive ? ("reactivated" as const) : ("updated" as const), jobId: existing.jobId, evaluate: reopened };
      }

      // --- Same job seen elsewhere (canonical URL or company + title + location)
      const dedupeKey = buildDedupeKey(job.company, job.title, job.locations[0] ?? null);
      const urlOwner = canonicalUrl
        ? await tx.sourceObservation.findUnique({ where: { canonicalUrl }, select: { jobId: true } })
        : null;
      const sameIdentity = urlOwner ? null : await tx.jobPosting.findUnique({ where: { dedupeKey }, select: { id: true } });
      const matchJobId = urlOwner?.jobId ?? sameIdentity?.id ?? null;

      const observationCreate = {
        ...observationFields,
        sourceId: SOURCE_ID_BY_PROVIDER[provider],
        externalId: `${boardToken}:${posting.postingId}`,
        ...id,
        canonicalUrl: urlOwner ? null : canonicalUrl,
        firstSeenAt: now,
      };

      if (matchJobId) {
        await tx.sourceObservation.create({ data: { ...observationCreate, jobId: matchJobId } });
        await tx.jobEvent.create({
          data: {
            jobId: matchJobId,
            type: "sighting_added",
            toValue: provider,
            message: urlOwner
              ? `Also listed on the ${provider} board (same URL).`
              : `Also listed on the ${provider} board (same company, title and location).`,
            occurredAt: now,
          },
        });
        return { outcome: "updated" as const, jobId: matchJobId, evaluate: false };
      }

      // --- New canonical job
      const jobId = `job-${randomUUID()}`;
      await tx.jobPosting.create({
        data: {
          id: jobId,
          dedupeKey,
          company: job.company,
          title: job.title,
          jobType: job.jobType,
          durationMonths: job.durationMonths,
          term: job.term,
          disciplines: job.disciplines,
          summary: job.summary,
          description: job.description,
          responsibilities: [],
          qualifications: [],
          postingUrl: job.url,
          postedAt: posting.publishedAtKind === "first_published" && posting.publishedAt ? new Date(posting.publishedAt) : null,
          firstDiscoveredAt: now,
          discoveryStatus: "discovered",
          origin: "automatic",
          primarySourceId: SOURCE_ID_BY_PROVIDER[provider],
          createdAt: now,
          locations: { create: job.locations.map((l, position) => ({ position, ...l })) },
          observations: { create: observationCreate },
          descriptionSnapshots: job.description
            ? { create: { content: job.description, contentHash: sha256(job.description), source: "source_import", capturedAt: now } }
            : undefined,
          events: {
            create: {
              type: "created",
              toValue: "discovered",
              message: `Discovered on the ${provider} board. ${job.notes.classification}.${job.notes.arrangementInferred ? " Work arrangement not stated; matching treats it as unknown." : ""}`,
              occurredAt: now,
            },
          },
        },
      });
      return { outcome: "created" as const, jobId, evaluate: true };
    },
    { timeout: 30_000 },
  );
}

async function applyProviderDetails(
  tx: Tx,
  jobId: string,
  current: { description: string | null; dedupeKey: string },
  job: ImportedJob,
  provider: AtsProvider,
  now: Date,
) {
  const dedupeKey = buildDedupeKey(job.company, job.title, job.locations[0] ?? null);
  const keyFree = dedupeKey === current.dedupeKey || !(await tx.jobPosting.findUnique({ where: { dedupeKey }, select: { id: true } }));
  await tx.jobPosting.update({
    where: { id: jobId },
    // Provider-derived fields only. Notes, status, salary and applications are never touched.
    data: {
      ...(keyFree ? { dedupeKey } : {}),
      company: job.company,
      title: job.title,
      jobType: job.jobType,
      durationMonths: job.durationMonths,
      term: job.term,
      disciplines: job.disciplines,
      summary: job.summary,
      description: job.description ?? current.description,
      postingUrl: job.url,
      version: { increment: 1 },
    },
  });
  await tx.jobLocation.deleteMany({ where: { jobId } });
  await tx.jobLocation.createMany({ data: job.locations.map((l, position) => ({ jobId, position, ...l })) });
  if (job.description && job.description !== current.description) {
    await tx.jobDescriptionSnapshot.createMany({
      data: [{ jobId, content: job.description, contentHash: sha256(job.description), source: "source_import", capturedAt: now }],
      skipDuplicates: true,
    });
  }
  await tx.jobEvent.create({
    data: { jobId, type: "details_updated", message: `Updated from the ${provider} posting; earlier descriptions are kept.`, occurredAt: now },
  });
}

/**
 * After a COMPLETE snapshot: every active posting of this board that was not
 * listed is one absence closer to inactive. At MISSING_RUNS_TO_INACTIVATE
 * consecutive absences it is inactivated (`closed_at`); an automatic job whose
 * every sighting is then inactive is expired. Nothing is ever deleted.
 */
async function reconcileMissing(
  prisma: PrismaClient,
  input: { provider: AtsProvider; boardToken: string; seen: Set<string>; now: Date },
): Promise<{ missing: number; inactivated: number; expiredJobIds: string[] }> {
  const active = await prisma.sourceObservation.findMany({
    where: { atsProvider: input.provider, atsBoardToken: input.boardToken, closedAt: null },
    select: { id: true, atsPostingId: true },
  });
  const seenLower = new Set([...input.seen].map((s) => s.toLowerCase()));
  const absentIds = active.filter((o) => o.atsPostingId && !seenLower.has(o.atsPostingId)).map((o) => o.id);
  if (absentIds.length === 0) return { missing: 0, inactivated: 0, expiredJobIds: [] };

  return prisma.$transaction(async (tx) => {
    await tx.sourceObservation.updateMany({ where: { id: { in: absentIds } }, data: { missingCount: { increment: 1 } } });
    const toInactivate = await tx.sourceObservation.findMany({
      where: { id: { in: absentIds }, closedAt: null, missingCount: { gte: MISSING_RUNS_TO_INACTIVATE } },
      select: { id: true, jobId: true },
    });
    if (toInactivate.length > 0) {
      await tx.sourceObservation.updateMany({ where: { id: { in: toInactivate.map((o) => o.id) } }, data: { closedAt: input.now } });
    }
    const expired: string[] = [];
    for (const jobId of new Set(toInactivate.map((m) => m.jobId))) {
      const job = await tx.jobPosting.findUnique({
        where: { id: jobId },
        select: { origin: true, discoveryStatus: true, observations: { where: { closedAt: null }, select: { id: true } } },
      });
      if (!job || job.origin !== "automatic" || job.observations.length > 0) continue;
      if (job.discoveryStatus !== "discovered" && job.discoveryStatus !== "saved") continue;
      await tx.jobPosting.update({ where: { id: jobId }, data: { discoveryStatus: "expired" } });
      await tx.jobEvent.create({
        data: {
          jobId,
          type: "discovery_status_changed",
          fromValue: job.discoveryStatus,
          toValue: "expired",
          message: `No longer listed on the ${input.provider} board.`,
          occurredAt: input.now,
        },
      });
      expired.push(jobId);
    }
    return { missing: absentIds.length, inactivated: toInactivate.length, expiredJobIds: expired };
  });
}

/** A posting that reappears after the sync expired its job is reopened (only if the sync expired it). */
async function reopenIfExpiredBySync(tx: Tx, jobId: string, status: string, provider: AtsProvider, now: Date): Promise<boolean> {
  if (status !== "expired") return false;
  const last = await tx.jobEvent.findFirst({
    where: { jobId, type: "discovery_status_changed", toValue: "expired" },
    orderBy: { occurredAt: "desc" },
    select: { fromValue: true, message: true },
  });
  if (!last?.message?.startsWith("No longer listed on the")) return false;
  const to = last.fromValue === "saved" ? "saved" : "discovered";
  await tx.jobPosting.update({ where: { id: jobId }, data: { discoveryStatus: to } });
  await tx.jobEvent.create({
    data: { jobId, type: "discovery_status_changed", fromValue: "expired", toValue: to, message: `Listed again on the ${provider} board.`, occurredAt: now },
  });
  return true;
}

function safeCanonical(url: string): string | null {
  try {
    return normalizeJobUrl(url);
  } catch {
    return null;
  }
}
