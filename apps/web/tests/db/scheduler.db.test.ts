/**
 * Milestone 3B: automatic board synchronization against real PostgreSQL —
 * scheduling, atomic claiming, leases and crash recovery, the worker loop,
 * failure handling, and the two-snapshot missing/inactive rules.
 * Provider responses are synthetic (scripted adapters / in-memory transport).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fakeTransport } from "@/lib/ats/__fixtures__/transport";
import { AtsError } from "@/lib/ats/http";
import { syncBoard } from "@/lib/ats/sync";
import type { AtsAdapter, FetchResult, ProviderPosting } from "@/lib/ats/types";
import { claimNextBoard, drainDueBoards, releaseLease, runClaimedBoard, type WorkerDeps } from "@/lib/ats/worker";
import { DEFAULT_WORKER_CONFIG } from "@/lib/ats/schedule";
import { createBoard, setBoardEnabled } from "@/lib/boards/service";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { AtsProvider } from "@/lib/types";
import { createTestPrisma, truncateAll } from "./helpers";

const db = createTestPrisma();
afterAll(() => db.$disconnect());

let clock = new Date("2030-01-01T12:00:00Z"); // after any real-clock row creation
const now = () => new Date(clock);
const advance = (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000));
const silent = () => undefined;
const config = { ...DEFAULT_WORKER_CONFIG, leaseMs: 10 * 60_000, retryBaseMs: 5 * 60_000 };

const posting = (id: string, over: Partial<ProviderPosting> = {}): ProviderPosting => ({
  postingId: id,
  title: `Software Developer Co-op ${id}`,
  url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
  descriptionText: "A 4-month co-op building backend services in Toronto.",
  locationTexts: ["Toronto, ON"],
  structuredLocations: [],
  workplace: "hybrid",
  employmentType: null,
  department: "Engineering",
  publishedAt: null,
  publishedAtKind: "none",
  metadata: {},
  ...over,
});

/** Adapter the test scripts between runs; records concurrency. */
function scripted(provider: AtsProvider = "greenhouse") {
  const state = {
    postings: [] as ProviderPosting[],
    error: null as AtsError | Error | null,
    incomplete: null as string | null,
    calls: 0,
    active: 0,
    maxActive: 0,
    delayMs: 0,
  };
  const adapter: AtsAdapter = {
    provider,
    documentation: "test",
    async fetchPostings(): Promise<FetchResult> {
      state.calls++;
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      try {
        if (state.delayMs) await new Promise((r) => setTimeout(r, state.delayMs));
        if (state.error) throw state.error;
        return { postings: structuredClone(state.postings), warnings: [], requests: 1, complete: state.incomplete === null, incompleteReason: state.incomplete };
      } finally {
        state.active--;
      }
    },
  };
  return { adapter, state };
}

const deps = (adapterFor: WorkerDeps["adapterFor"], over: Partial<WorkerDeps> = {}): WorkerDeps => ({
  prisma: db,
  transport: fakeTransport({}).transport,
  config,
  owner: "worker-a",
  log: silent,
  now,
  adapterFor,
  ...over,
});

let seq = 0;
async function addBoard(over: { provider?: AtsProvider; enabled?: boolean; isDemo?: boolean; token?: string } = {}) {
  const provider = over.provider ?? "greenhouse";
  const token = over.token ?? `acme${++seq}`;
  const r = await createBoard(
    db,
    { provider, employerName: `Acme ${token}`, boardToken: token, pollIntervalMinutes: 360, enabled: over.enabled ?? true, boardUrl: `https://example.com/${provider}/${token}` },
    { isDemo: over.isDemo },
  );
  if (!r.ok) throw new Error(r.message);
  // createBoard schedules at the real "now"; align with the test clock.
  if (r.value.nextSyncAt) await db.employerBoard.update({ where: { id: r.value.id }, data: { nextSyncAt: now() } });
  return r.value.id;
}
const boardRow = (id: string) => db.employerBoard.findUniqueOrThrow({ where: { id } });
const minutesUntil = (d: Date | null) => (d ? Math.round((d.getTime() - clock.getTime()) / 60_000) : null);
const observation = (postingId: string) => db.sourceObservation.findFirstOrThrow({ where: { atsPostingId: postingId } });

beforeEach(async () => {
  await truncateAll(db);
  clock = new Date("2030-01-01T12:00:00Z");
});

describe("scheduling", () => {
  it("schedules newly registered enabled boards immediately and skips disabled and demo boards", async () => {
    const enabled = await createBoard(db, { provider: "greenhouse", employerName: "A", boardToken: "a1", pollIntervalMinutes: 360, enabled: true, boardUrl: "https://example.com/a1" });
    const disabled = await createBoard(db, { provider: "greenhouse", employerName: "B", boardToken: "b1", pollIntervalMinutes: 360, enabled: false, boardUrl: "https://example.com/b1" });
    const demo = await createBoard(db, { provider: "greenhouse", employerName: "C", boardToken: "c1", pollIntervalMinutes: 360, enabled: true, boardUrl: "https://example.com/c1" }, { isDemo: true });
    expect(enabled.ok && enabled.value.nextSyncAt).toBeTruthy();
    expect(disabled.ok && disabled.value.nextSyncAt).toBeNull();
    expect(demo.ok && demo.value.nextSyncAt).toBeNull();
  });

  it("only claims due, enabled, non-demo boards", async () => {
    const due = await addBoard();
    const later = await addBoard();
    await db.employerBoard.update({ where: { id: later }, data: { nextSyncAt: new Date(clock.getTime() + 60_000) } });
    await addBoard({ enabled: false });
    await addBoard({ isDemo: true });
    const first = await claimNextBoard(db, { owner: "w", now: now(), leaseMs: config.leaseMs });
    expect(first?.id).toBe(due);
    expect(await claimNextBoard(db, { owner: "w", now: now(), leaseMs: config.leaseMs })).toBeNull();
  });

  it("disabling unschedules a board; enabling reschedules it now", async () => {
    const id = await addBoard();
    await setBoardEnabled(db, id, false);
    expect((await boardRow(id)).nextSyncAt).toBeNull();
    expect(await claimNextBoard(db, { owner: "w", now: now(), leaseMs: config.leaseMs })).toBeNull();
    await setBoardEnabled(db, id, true);
    expect((await boardRow(id)).nextSyncAt).not.toBeNull();
  });
});

describe("claiming, leases and recovery", () => {
  it("two workers claiming at the same moment never get the same board", async () => {
    const id = await addBoard();
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => claimNextBoard(db, { owner: `w${i}`, now: now(), leaseMs: config.leaseMs })));
    const winners = claims.filter((c) => c !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]?.id).toBe(id);
  });

  it("a restarted worker does not re-claim a leased board (no duplicate sync jobs)", async () => {
    await addBoard();
    expect(await claimNextBoard(db, { owner: "before-restart", now: now(), leaseMs: config.leaseMs })).not.toBeNull();
    // New process, new identity, same database: the lease is still valid.
    expect(await claimNextBoard(db, { owner: "after-restart", now: now(), leaseMs: config.leaseMs })).toBeNull();
  });

  it("recovers a board whose worker crashed once the lease expires, including its stale running run", async () => {
    const id = await addBoard();
    const { adapter, state } = scripted();
    state.postings = [posting("1")];
    expect(await claimNextBoard(db, { owner: "crashed", now: now(), leaseMs: config.leaseMs })).not.toBeNull();
    // The crashed worker had started a run and never finished it.
    await db.boardSyncRun.create({ data: { boardId: id, trigger: "scheduled", startedAt: now() } });

    advance(5);
    expect(await claimNextBoard(db, { owner: "rescuer", now: now(), leaseMs: config.leaseMs })).toBeNull();
    advance(15); // lease (10 min) and stale-run window (15 min) have passed
    const claim = await claimNextBoard(db, { owner: "rescuer", now: now(), leaseMs: config.leaseMs });
    expect(claim?.id).toBe(id);
    const result = await runClaimedBoard(deps(() => adapter, { owner: "rescuer" }), claim!);
    expect(result).toMatchObject({ status: "succeeded", created: 1, trigger: "scheduled" });
    const runs = await db.boardSyncRun.findMany({ where: { boardId: id }, orderBy: { startedAt: "asc" } });
    expect(runs.map((r) => [r.status, r.errorCode])).toEqual([["failed", "stale"], ["succeeded", null]]);
    expect(await boardRow(id)).toMatchObject({ syncLeaseOwner: null, syncLeaseExpiresAt: null });
  });

  it("duplicate delivery of a claim runs the sync once", async () => {
    const id = await addBoard();
    const { adapter, state } = scripted();
    state.postings = [posting("1")];
    const claim = (await claimNextBoard(db, { owner: "worker-a", now: now(), leaseMs: config.leaseMs }))!;
    const first = await runClaimedBoard(deps(() => adapter), claim);
    const second = await runClaimedBoard(deps(() => adapter), claim); // same message delivered again
    expect(first).toMatchObject({ status: "succeeded" });
    expect(second).toBeNull();
    expect(state.calls).toBe(1);
    expect(await db.boardSyncRun.count({ where: { boardId: id } })).toBe(1);
    expect(await claimNextBoard(db, { owner: "worker-b", now: now(), leaseMs: config.leaseMs })).toBeNull(); // next run is 6 h away
  });

  it("a release never clears another worker's lease", async () => {
    const id = await addBoard();
    await claimNextBoard(db, { owner: "owner", now: now(), leaseMs: config.leaseMs });
    await releaseLease(db, { boardId: id, owner: "someone-else", nextSyncAt: null });
    expect(await boardRow(id)).toMatchObject({ syncLeaseOwner: "owner" });
  });

  it("a scheduled run that finds a manual sync running is recorded as skipped and retried soon", async () => {
    const id = await addBoard();
    await db.boardSyncRun.create({ data: { boardId: id, trigger: "manual", startedAt: now() } });
    const claim = (await claimNextBoard(db, { owner: "worker-a", now: now(), leaseMs: config.leaseMs }))!;
    const { adapter } = scripted();
    expect(await runClaimedBoard(deps(() => adapter), claim)).toMatchObject({ status: "skipped" });
    const board = await boardRow(id);
    expect(board.syncLeaseOwner).toBeNull();
    expect(minutesUntil(board.nextSyncAt)).toBeGreaterThanOrEqual(4);
    expect(minutesUntil(board.nextSyncAt)).toBeLessThanOrEqual(6);
  });
});

describe("worker loop", () => {
  it("syncs every due board, honouring global and per-provider concurrency", async () => {
    const adapters = { greenhouse: scripted("greenhouse"), lever: scripted("lever"), ashby: scripted("ashby") };
    for (const a of Object.values(adapters)) {
      a.state.postings = [];
      a.state.delayMs = 30;
    }
    for (let i = 0; i < 3; i++) {
      await addBoard({ provider: "greenhouse" });
      await addBoard({ provider: "lever" });
      await addBoard({ provider: "ashby" });
    }
    const results = await drainDueBoards(deps((p) => adapters[p as keyof typeof adapters]?.adapter, { config: { ...config, concurrency: 3, perProviderConcurrency: 1 } }));
    expect(results).toHaveLength(9);
    expect(results.every((r) => r.status === "succeeded" && r.trigger === "scheduled")).toBe(true);
    for (const a of Object.values(adapters)) expect(a.state.maxActive).toBe(1);
    expect(await db.employerBoard.count({ where: { nextSyncAt: { lte: now() } } })).toBe(0);
  });

  it("one failing board does not block the others, and is retried with backoff", async () => {
    const good = scripted("lever");
    good.state.postings = [posting("g1", { url: "https://jobs.lever.co/acme/g1" })];
    const bad = scripted("greenhouse");
    bad.state.error = new AtsError("http_error", "The provider returned HTTP 500.", 500);
    const badId = await addBoard({ provider: "greenhouse" });
    const goodId = await addBoard({ provider: "lever" });
    const results = await drainDueBoards(deps((p) => (p === "greenhouse" ? bad.adapter : good.adapter)));
    expect(results.map((r) => r.status).sort()).toEqual(["failed", "succeeded"]);
    const badRow = await boardRow(badId);
    expect(badRow).toMatchObject({ consecutiveFailures: 1, lastErrorCode: "http_error", syncLeaseOwner: null });
    expect(minutesUntil(badRow.nextSyncAt)).toBeGreaterThanOrEqual(4);
    expect(minutesUntil(badRow.nextSyncAt)).toBeLessThanOrEqual(6);
    expect(minutesUntil((await boardRow(goodId)).nextSyncAt)).toBeGreaterThan(300);
  });

  it("respects a provider Retry-After when rescheduling a rate-limited board", async () => {
    const id = await addBoard();
    const { adapter, state } = scripted();
    state.error = new AtsError("rate_limited", "The provider is rate-limiting requests. Try again later.", 429, 90 * 60_000);
    await drainDueBoards(deps(() => adapter));
    expect(minutesUntil((await boardRow(id)).nextSyncAt)).toBe(90);
  });

  it("pauses a board with a permanent configuration error instead of retrying forever", async () => {
    const id = await addBoard();
    const { adapter, state } = scripted();
    state.error = new AtsError("not_found", "The provider has no public board with this identifier.", 404);
    await drainDueBoards(deps(() => adapter));
    expect(await boardRow(id)).toMatchObject({ nextSyncAt: null, lastErrorCode: "not_found", consecutiveFailures: 1 });
    advance(24 * 60);
    await drainDueBoards(deps(() => adapter));
    expect(state.calls).toBe(1); // not retried automatically
    await setBoardEnabled(db, id, false);
    await setBoardEnabled(db, id, true); // the user's way to resume
    expect((await boardRow(id)).nextSyncAt).not.toBeNull();
  });

  it("a timeout is recorded as a failure and keeps existing jobs", async () => {
    const id = await addBoard();
    const { adapter, state } = scripted();
    state.postings = [posting("1")];
    await drainDueBoards(deps(() => adapter));
    advance(7 * 60);
    state.error = new AtsError("timeout", "The provider did not respond within 20 s.");
    const [r] = await drainDueBoards(deps(() => adapter));
    expect(r).toMatchObject({ status: "failed", errorMessage: expect.stringMatching(/did not respond/) });
    expect(await db.sourceObservation.count({ where: { boardId: id, closedAt: null } })).toBe(1);
    expect((await observation("1")).missingCount).toBe(0);
  });

  it("a database error mid-sync is contained: lease released, board retried later, others unaffected", async () => {
    const broken = await addBoard({ provider: "greenhouse" });
    const fine = await addBoard({ provider: "lever" });
    const ok = scripted("lever");
    // A client whose sync-run writes fail, as during a database outage.
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === "boardSyncRun") {
          return new Proxy(target.boardSyncRun, {
            get(t, p, r) {
              if (p === "create") return async () => Promise.reject(new Error("connection terminated unexpectedly"));
              return Reflect.get(t, p, r);
            },
          });
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as PrismaClient;
    const claim = (await claimNextBoard(db, { owner: "worker-a", now: now(), leaseMs: config.leaseMs }))!;
    expect(claim.id).toBe(broken);
    expect(await runClaimedBoard(deps(() => scripted().adapter, { prisma: failing }), claim)).toBeNull();
    const row = await boardRow(broken);
    expect(row.syncLeaseOwner).toBeNull();
    expect(minutesUntil(row.nextSyncAt)).toBe(5);
    const results = await drainDueBoards(deps(() => ok.adapter));
    expect(results.map((r) => r.status)).toEqual(["succeeded"]);
    expect((await boardRow(fine)).lastSuccessAt).not.toBeNull();
  });
});

describe("reconciliation (scheduled and manual share it)", () => {
  async function run(boardId: string, adapter: AtsAdapter) {
    const r = await syncBoard(db, boardId, { transport: fakeTransport({}).transport, adapter, now, trigger: "scheduled" });
    if (!r.ok) throw new Error(r.message);
    advance(60);
    return r.value;
  }

  it("classifies NEW, UNCHANGED, UPDATED and REACTIVATED without duplicating", async () => {
    const id = await addBoard();
    const { adapter, state } = scripted();
    state.postings = [posting("1"), posting("2")];
    expect(await run(id, adapter)).toMatchObject({ created: 2, unchanged: 0 });
    expect(await run(id, adapter)).toMatchObject({ created: 0, unchanged: 2, updated: 0 });
    state.postings = [posting("1", { descriptionText: "Now an 8-month co-op." }), posting("2")];
    expect(await run(id, adapter)).toMatchObject({ updated: 1, unchanged: 1 });
    expect(await db.jobPosting.count()).toBe(2);

    state.postings = [posting("1")];
    await run(id, adapter);
    await run(id, adapter); // posting 2 absent twice -> inactive
    expect((await observation("2")).closedAt).not.toBeNull();
    state.postings = [posting("1"), posting("2")];
    expect(await run(id, adapter)).toMatchObject({ reactivated: 1, created: 0 });
    expect(await observation("2")).toMatchObject({ closedAt: null, missingCount: 0 });
    expect(await db.jobPosting.count()).toBe(2);
  });

  it("requires two consecutive complete snapshots before inactivation, and resets on reappearance", async () => {
    const id = await addBoard();
    const { adapter, state } = scripted();
    state.postings = [posting("1"), posting("2")];
    await run(id, adapter);
    const firstSeen = (await observation("2")).firstSeenAt;

    state.postings = [posting("1")];
    expect(await run(id, adapter)).toMatchObject({ missing: 1, closed: 0 });
    expect(await observation("2")).toMatchObject({ missingCount: 1, closedAt: null });

    state.postings = [posting("1"), posting("2")]; // back after one absence: counter resets
    expect(await run(id, adapter)).toMatchObject({ missing: 0, reactivated: 0, unchanged: 2 });
    expect(await observation("2")).toMatchObject({ missingCount: 0, closedAt: null });

    state.postings = [posting("1")];
    await run(id, adapter);
    const second = await run(id, adapter);
    expect(second).toMatchObject({ missing: 1, closed: 1 });
    const obs = await observation("2");
    expect(obs.closedAt).not.toBeNull();
    expect(obs.firstSeenAt).toEqual(firstSeen); // history preserved, nothing deleted
    expect(await db.jobPosting.count()).toBe(2);
  });

  it("a failed sync never counts or expires anything", async () => {
    const id = await addBoard();
    const { adapter, state } = scripted();
    state.postings = [posting("1")];
    await run(id, adapter);
    state.error = new AtsError("http_error", "The provider returned HTTP 500.", 500);
    for (let i = 0; i < 3; i++) expect(await run(id, adapter)).toMatchObject({ status: "failed", missing: 0, closed: 0 });
    expect(await observation("1")).toMatchObject({ missingCount: 0, closedAt: null });
  });

  it("a partial (incomplete or truncated) sync never counts or expires anything", async () => {
    const id = await addBoard();
    const { adapter, state } = scripted();
    state.postings = [posting("1"), posting("2")];
    await run(id, adapter);
    state.postings = [posting("1")];
    state.incomplete = "Stopped after 20 pages; later pages were not read.";
    for (let i = 0; i < 3; i++) {
      expect(await run(id, adapter)).toMatchObject({ status: "partial", complete: false, missing: 0, closed: 0, unchanged: 1 });
    }
    expect(await observation("2")).toMatchObject({ missingCount: 0, closedAt: null });
    const run3 = await db.boardSyncRun.findFirstOrThrow({ where: { boardId: id }, orderBy: { startedAt: "desc" } });
    expect(run3).toMatchObject({ status: "partial", complete: false, errorCode: "incomplete" });
    expect(await boardRow(id)).toMatchObject({ consecutiveFailures: 0, lastErrorCode: "incomplete" });
  });

  it("an empty but valid (complete) board counts its postings missing, safely, over two runs", async () => {
    const id = await addBoard();
    const { adapter, state } = scripted();
    state.postings = [posting("1")];
    await run(id, adapter);
    state.postings = [];
    expect(await run(id, adapter)).toMatchObject({ status: "succeeded", fetched: 0, missing: 1, closed: 0 });
    expect(await run(id, adapter)).toMatchObject({ status: "succeeded", missing: 1, closed: 1 });
  });

  it("re-processing the same snapshot is idempotent", async () => {
    const id = await addBoard();
    const { adapter, state } = scripted();
    state.postings = [posting("1"), posting("2"), posting("3")];
    await run(id, adapter);
    const snapshot = async () => ({
      jobs: await db.jobPosting.count(),
      observations: await db.sourceObservation.count(),
      snapshots: await db.jobDescriptionSnapshot.count(),
      events: await db.jobEvent.count(),
    });
    const before = await snapshot();
    for (let i = 0; i < 3; i++) expect(await run(id, adapter)).toMatchObject({ created: 0, updated: 0, unchanged: 3, missing: 0 });
    expect(await snapshot()).toEqual(before);
  });

  it("manual and scheduled runs are recorded with their trigger", async () => {
    const id = await addBoard();
    const { adapter } = scripted();
    await syncBoard(db, id, { transport: fakeTransport({}).transport, adapter, now });
    advance(1);
    await run(id, adapter);
    const runs = await db.boardSyncRun.findMany({ where: { boardId: id }, orderBy: { startedAt: "asc" } });
    expect(runs.map((r) => r.trigger)).toEqual(["manual", "scheduled"]);
  });
});
