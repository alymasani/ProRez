/**
 * Discovery runs (Milestone 3C): collect candidates from sources, verify a
 * bounded batch, register verified boards. Scheduling mirrors Milestone 3B:
 * a single `discovery_schedule` row holds `next_run_at` plus a lease, claimed
 * atomically, so runs never overlap (also enforced by a unique index on
 * running runs) and a crashed worker's run is recovered after the lease.
 *
 * Sources per run:
 *  - existing_jobs: ATS boards referenced by jobs you saved but not registered (free);
 *  - search: the configured SearchProvider, within the per-run and rolling
 *    24-hour request budgets (skipped gracefully without credentials);
 *  - common_crawl: imported separately (lib/discovery/import.ts); its
 *    candidates are verified by these runs like any other.
 */
import type { PrismaClient } from "../generated/prisma/client";
import { recognizeAtsUrl, canonicalBoardUrl } from "../boards/board-url";
import type { HttpTransport } from "../ats/http";
import { AtsError } from "../ats/http";
import type { AtsAdapter } from "../ats/types";
import type { AtsProvider } from "../types";
import { prismaErrorCode } from "../mutations/result";
import { ingestUrls } from "./candidates";
import { searchUnavailableReason, type DiscoveryConfig } from "./config";
import type { SiteFetcher } from "./net";
import { generateQueries, selectQueries } from "./queries";
import { registerCandidate } from "./register";
import type { SearchProvider } from "./search";
import { claimCandidates, verifyCandidate } from "./verify";

export const SCHEDULE_ID = "default";

export type DiscoveryLogger = (event: string, fields?: Record<string, unknown>) => void;

export interface DiscoveryDeps {
  prisma: PrismaClient;
  config: DiscoveryConfig;
  atsTransport: HttpTransport;
  siteFetcher: SiteFetcher;
  search: SearchProvider | null;
  now?: () => Date;
  log?: DiscoveryLogger;
  adapterFor?: (provider: AtsProvider) => AtsAdapter | undefined;
  random?: () => number;
}

export interface DiscoveryRunSummary {
  runId: string;
  status: "succeeded" | "partial" | "failed";
  source: string;
  trigger: "manual" | "scheduled";
  searchRequests: number;
  searchCredits: number;
  candidateUrls: number;
  uniqueCandidates: number;
  newCandidates: number;
  validated: number;
  registered: number;
  pendingReview: number;
  rejected: number;
  apiErrors: number;
  atsRequests: number;
  siteRequests: number;
  errorMessage: string | null;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Schedule (durable, leased)
// ---------------------------------------------------------------------------

/** The schedule row is created by the migration; recreate it idempotently if it was removed. */
export async function ensureDiscoverySchedule(prisma: PrismaClient, now = new Date()): Promise<void> {
  await prisma.discoverySchedule.createMany({ data: [{ id: SCHEDULE_ID, nextRunAt: now }], skipDuplicates: true });
}

/** Claims the discovery schedule when due (enabled + next_run_at passed) or when a run was requested. */
export async function claimDiscovery(
  prisma: PrismaClient,
  input: { owner: string; now: Date; leaseMs: number; scheduledEnabled: boolean },
): Promise<{ trigger: "manual" | "scheduled" } | null> {
  const expires = new Date(input.now.getTime() + input.leaseMs);
  const rows = await prisma.$queryRaw<{ requested_at: Date | null }[]>`
    UPDATE "discovery_schedule" SET "lease_owner" = ${input.owner}, "lease_expires_at" = ${expires}, "updated_at" = ${input.now}
    WHERE "id" = ${SCHEDULE_ID}
      AND ("lease_expires_at" IS NULL OR "lease_expires_at" < ${input.now})
      AND ("requested_at" IS NOT NULL OR (${input.scheduledEnabled} AND "next_run_at" IS NOT NULL AND "next_run_at" <= ${input.now}))
    RETURNING "requested_at"`;
  if (rows.length === 0) return null;
  return { trigger: rows[0].requested_at ? "manual" : "scheduled" };
}

/** "Run discovery now": only records the request; the worker performs the run. */
export async function requestDiscoveryRun(prisma: PrismaClient, now = new Date()): Promise<void> {
  await prisma.discoverySchedule.upsert({
    where: { id: SCHEDULE_ID },
    create: { id: SCHEDULE_ID, nextRunAt: now, requestedAt: now },
    update: { requestedAt: now },
  });
}

async function releaseDiscovery(prisma: PrismaClient, owner: string, data: { nextRunAt: Date; lastRunId: string | null }) {
  await prisma.discoverySchedule.updateMany({
    where: { id: SCHEDULE_ID, leaseOwner: owner },
    data: { leaseOwner: null, leaseExpiresAt: null, requestedAt: null, nextRunAt: data.nextRunAt, ...(data.lastRunId ? { lastRunId: data.lastRunId } : {}) },
  });
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

/** Search requests used in the rolling 24 hours before `now`. */
export async function searchRequestsLast24h(prisma: PrismaClient, now: Date): Promise<number> {
  const agg = await prisma.discoveryRun.aggregate({ _sum: { searchRequests: true }, where: { startedAt: { gte: new Date(now.getTime() - 86_400_000) } } });
  return agg._sum.searchRequests ?? 0;
}

/** Conservative search-credit usage in the current UTC calendar month. */
export async function tavilyCreditsThisMonth(prisma: PrismaClient, now: Date): Promise<number> {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const agg = await prisma.discoveryRun.aggregate({
    _sum: { searchCredits: true },
    where: { searchProvider: "tavily", startedAt: { gte: monthStart } },
  });
  return agg._sum.searchCredits ?? 0;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const MAX_NOTES = 50;

export async function runDiscovery(
  deps: DiscoveryDeps,
  options: { trigger: "manual" | "scheduled"; signal?: AbortSignal; sources?: ("existing_jobs" | "search")[] },
): Promise<DiscoveryRunSummary | null> {
  const { prisma, config } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const sources = options.sources ?? ["existing_jobs", "search"];
  const searchOff = searchUnavailableReason(config) ?? (deps.search ? null : "No search provider configured.");
  const activeSources = sources.filter((s) => s !== "search" || !searchOff);
  const source = activeSources.join(",") || "verify_only";

  // Close runs left running by a crashed process.
  await prisma.discoveryRun.updateMany({
    where: { status: "running", startedAt: { lt: new Date(now().getTime() - config.leaseMs) } },
    data: { status: "failed", finishedAt: now(), errorMessage: "Run did not finish (process stopped)." },
  });
  let runId: string;
  try {
    runId = (await prisma.discoveryRun.create({
      data: { source, trigger: options.trigger, startedAt: now(), searchProvider: activeSources.includes("search") ? deps.search?.name : null },
      select: { id: true },
    })).id;
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") {
      log("discovery_skipped", { reason: "another discovery run is in progress" });
      return null;
    }
    throw error;
  }

  const timeout = AbortSignal.timeout(config.runTimeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const s: DiscoveryRunSummary = {
    runId, status: "succeeded", source, trigger: options.trigger,
    searchRequests: 0, searchCredits: 0, candidateUrls: 0, uniqueCandidates: 0, newCandidates: 0, validated: 0, registered: 0,
    pendingReview: 0, rejected: 0, apiErrors: 0, atsRequests: 0, siteRequests: 0, errorMessage: null, notes: [],
  };
  const note = (msg: string) => {
    if (s.notes.length < MAX_NOTES) s.notes.push(msg);
  };
  if (sources.includes("search") && searchOff) note(searchOff);
  log("discovery_started", { run: runId, trigger: options.trigger, sources: source });

  try {
    // --- 1. Collect: boards referenced by saved jobs but not registered
    if (activeSources.includes("existing_jobs")) {
      const refs = await prisma.$queryRaw<{ provider: AtsProvider; token: string; url: string | null }[]>`
        SELECT DISTINCT ON (o."ats_provider", o."ats_board_token") o."ats_provider" AS provider, o."ats_board_token" AS token, o."source_url" AS url
        FROM "source_observations" o
        WHERE o."ats_provider" IS NOT NULL AND o."ats_board_token" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "employer_boards" b WHERE b."provider" = o."ats_provider" AND b."board_token" = o."ats_board_token")
        ORDER BY o."ats_provider", o."ats_board_token", o."first_seen_at" ASC
        LIMIT 500`;
      const urls = refs.map((r) => (r.url && recognizeAtsUrl(r.url) ? r.url : canonicalBoardUrl(r.provider, r.token)));
      const res = await ingestUrls(prisma, urls, {
        source: "existing_jobs",
        now: now(),
        keepObservedUrl: true,
        evidence: (_r, url) => ({ type: "existing_job_url", status: "unvalidated", sourceUrl: url }),
      });
      s.candidateUrls += res.recognized;
      s.uniqueCandidates += res.unique;
      s.newCandidates += res.newCandidates;
    }

    // --- 2. Collect: search API, within budgets
    if (activeSources.includes("search") && deps.search) {
      await collectFromSearch(deps, s, note, now, signal);
    }

    // --- 3. Verify a bounded batch (new, retry-due and recovered candidates)
    const claimed = await claimCandidates(prisma, { limit: config.maxCandidatesPerRun, now: now(), leaseMs: config.leaseMs });
    const queue = [...claimed];
    const verifiedIds: string[] = [];
    const workers = Array.from({ length: Math.max(1, config.verifyConcurrency) }, async () => {
      for (let id = queue.shift(); id; id = queue.shift()) {
        if (signal.aborted) break;
        const outcome = await verifyCandidate(
          { prisma, atsTransport: deps.atsTransport, siteFetcher: deps.siteFetcher, now, signal, adapterFor: deps.adapterFor, maxAttempts: config.maxVerifyAttempts, random: deps.random },
          id,
        ).catch((error: unknown) => {
          note(`Verification error: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        });
        if (!outcome) continue;
        s.atsRequests += outcome.atsRequests;
        s.siteRequests += outcome.siteRequests;
        if (outcome.temporary) s.apiErrors++;
        if (outcome.status === "verified") {
          s.validated++;
          verifiedIds.push(id);
          if (config.autoRegister) {
            const reg = await registerCandidate(prisma, { candidateId: id, mode: "automatic", now: now() });
            if (reg.ok && reg.value.created) s.registered++;
            else if (!reg.ok) note(`Registration refused: ${reg.message}`);
          }
        } else if (outcome.status === "pending_review") {
          s.validated++;
          s.pendingReview++;
        } else if (outcome.status === "rejected") {
          s.rejected++;
        }
      }
    });
    await Promise.all(workers);
    // Candidates claimed but not processed (timeout/cancel) are recovered by lease expiry.
    if (queue.length > 0 || signal.aborted) {
      s.status = "partial";
      note(timeout.aborted ? `Stopped at the ${Math.round(config.runTimeoutMs / 60_000)}-minute run limit; remaining candidates continue next run.` : "Stopped early; remaining candidates continue next run.");
    }

    // Credit the queries that surfaced newly verified boards.
    if (verifiedIds.length > 0) {
      const evidence = await prisma.discoveryEvidence.findMany({ where: { candidateId: { in: verifiedIds }, type: "search_result" }, select: { metadata: true } });
      const counts = new Map<string, number>();
      for (const e of evidence) {
        const qid = (e.metadata as { queryId?: string } | null)?.queryId;
        if (qid) counts.set(qid, (counts.get(qid) ?? 0) + 1);
      }
      for (const [id, n] of counts) await prisma.discoveryQuery.updateMany({ where: { id }, data: { verified: { increment: n } } });
    }
    if (s.apiErrors > 0 && s.status === "succeeded") s.status = "partial";
  } catch (error) {
    s.status = "failed";
    s.errorMessage = error instanceof Error ? error.message.slice(0, 500) : "Discovery failed unexpectedly.";
    log("discovery_error", { run: runId, error: s.errorMessage });
  }

  await prisma.discoveryRun.update({
    where: { id: runId },
    data: {
      status: s.status,
      finishedAt: now(),
      searchRequests: s.searchRequests,
      searchCredits: s.searchCredits,
      candidateUrls: s.candidateUrls,
      uniqueCandidates: s.uniqueCandidates,
      newCandidates: s.newCandidates,
      validated: s.validated,
      registered: s.registered,
      pendingReview: s.pendingReview,
      rejected: s.rejected,
      apiErrors: s.apiErrors,
      atsRequests: s.atsRequests,
      siteRequests: s.siteRequests,
      errorMessage: s.errorMessage ?? (s.notes.length ? s.notes.slice(0, 3).join(" ") : null),
      details: { notes: s.notes },
    },
  });
  log("discovery_finished", {
    run: runId, status: s.status, sources: source, searchRequests: s.searchRequests, searchCredits: s.searchCredits, urls: s.candidateUrls, unique: s.uniqueCandidates,
    new: s.newCandidates, validated: s.validated, registered: s.registered, pending: s.pendingReview, rejected: s.rejected,
    apiErrors: s.apiErrors, atsRequests: s.atsRequests, siteRequests: s.siteRequests,
  });
  return s;
}

async function collectFromSearch(
  deps: DiscoveryDeps,
  s: DiscoveryRunSummary,
  note: (m: string) => void,
  now: () => Date,
  signal: AbortSignal,
) {
  const { prisma, config } = deps;
  const search = deps.search!;
  const used = await searchRequestsLast24h(prisma, now());
  const monthlyUsed = await tavilyCreditsThisMonth(prisma, now());
  const monthlyRemaining = search.name === "tavily" ? Math.max(0, config.maxCreditsPerMonth - monthlyUsed) : config.maxQueriesPerRun;
  const budget = Math.min(config.maxQueriesPerRun, Math.max(0, config.maxRequestsPerDay - used), monthlyRemaining);
  if (budget === 0) {
    note(monthlyRemaining === 0
      ? `Monthly Tavily credit budget used (${monthlyUsed} of ${config.maxCreditsPerMonth} credits).`
      : `Daily search budget used (${used} of ${config.maxRequestsPerDay} requests in the last 24 hours).`);
    return;
  }
  // Seed the registry (idempotent).
  await prisma.discoveryQuery.createMany({ data: generateQueries(), skipDuplicates: true });
  const all = await prisma.discoveryQuery.findMany();
  const picked = selectQueries(
    all.map((q) => ({ ...q, provider: q.provider as AtsProvider })),
    budget,
    now(),
  );
  const startRequests = search.requests;
  const startCredits = search.credits;
  for (const q of picked) {
    if (signal.aborted || search.requests - startRequests >= budget) break;
    const before = search.requests;
    try {
      const page = await search.search(q.text, q.nextOffset, signal, budget - (search.requests - startRequests));
      // Result URLs are used transiently here and never stored (provider terms).
      const res = await ingestUrls(prisma, page.urls, {
        source: "search",
        now: now(),
        keepObservedUrl: false,
        evidence: () => ({ type: "search_result", status: "unvalidated", dedupeKey: `search_result|${q.id}`, metadata: { queryId: q.id, query: q.text } }),
      });
      s.candidateUrls += res.recognized;
      s.uniqueCandidates += res.unique;
      s.newCandidates += res.newCandidates;
      await prisma.discoveryQuery.update({
        where: { id: q.id },
        data: {
          runs: { increment: 1 },
          requests: { increment: search.requests - before },
          results: { increment: page.urls.length },
          newCandidates: { increment: res.newCandidates },
          nextOffset: page.moreAvailable ? Math.min(9, q.nextOffset + 1) : 0,
          lastRunAt: now(),
        },
      });
    } catch (error) {
      s.apiErrors++;
      await prisma.discoveryQuery.update({ where: { id: q.id }, data: { requests: { increment: search.requests - before }, lastRunAt: now() } });
      const message = error instanceof Error ? error.message : String(error);
      note(`Search failed for one query: ${message}`);
      // Quota, key or cancellation problems end the search phase; others try the next query.
      if (error instanceof AtsError && (error.code === "rate_limited" || error.code === "quota_exhausted" || error.code === "invalid_board" || error.code === "cancelled")) break;
    } finally {
      s.searchRequests = search.requests - startRequests;
      s.searchCredits = search.credits - startCredits;
    }
  }
}

/** Claims the schedule and runs discovery if due; always releases the lease. */
export async function runDiscoveryIfDue(deps: DiscoveryDeps, input: { owner: string; signal?: AbortSignal }): Promise<DiscoveryRunSummary | null> {
  const now = deps.now ?? (() => new Date());
  await ensureDiscoverySchedule(deps.prisma, now());
  const claim = await claimDiscovery(deps.prisma, { owner: input.owner, now: now(), leaseMs: deps.config.leaseMs, scheduledEnabled: deps.config.enabled });
  if (!claim) return null;
  let summary: DiscoveryRunSummary | null = null;
  try {
    summary = await runDiscovery(deps, { trigger: claim.trigger, signal: input.signal });
    return summary;
  } finally {
    const jitter = 0.9 + (deps.random ?? Math.random)() * 0.2;
    const next = new Date(now().getTime() + Math.round(deps.config.intervalHours * 3_600_000 * jitter));
    await releaseDiscovery(deps.prisma, input.owner, { nextRunAt: next, lastRunId: summary?.runId ?? null }).catch(() => undefined);
  }
}
