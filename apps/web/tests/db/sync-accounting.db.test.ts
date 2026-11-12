/**
 * Milestone 3C corrections to 3B sync accounting, against real PostgreSQL:
 * - primary dispositions always sum to `fetched` (invariant);
 * - eligibility filters never cause expiry of still-listed postings;
 * - deferred description enrichment never blanks or churns stored data.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fakeTransport } from "@/lib/ats/__fixtures__/transport";
import { syncBoard, type SyncSummary } from "@/lib/ats/sync";
import type { AtsAdapter, FetchResult, ProviderPosting } from "@/lib/ats/types";
import { buildDedupeKey } from "@/lib/jobs/dedupe";
import { createTestPrisma, truncateAll } from "./helpers";

const db = createTestPrisma();
afterAll(() => db.$disconnect());
let clock = new Date("2030-03-01T12:00:00Z");
const now = () => new Date(clock);

const posting = (id: string, over: Partial<ProviderPosting> = {}): ProviderPosting => ({
  postingId: id,
  title: `Software Developer Co-op ${id}`,
  url: `https://jobs.smartrecruiters.com/acme/${id}`,
  descriptionText: "A 4-month co-op building backend services in Toronto. ".repeat(10),
  locationTexts: ["Toronto, ON"],
  structuredLocations: [],
  workplace: "hybrid",
  employmentType: null,
  department: null,
  publishedAt: null,
  publishedAtKind: "none",
  metadata: {},
  ...over,
});

function scripted() {
  const state = { postings: [] as ProviderPosting[], invalid: 0, deferred: 0 };
  const adapter: AtsAdapter = {
    provider: "smartrecruiters",
    documentation: "test",
    async fetchPostings(): Promise<FetchResult> {
      return { postings: structuredClone(state.postings), warnings: [], requests: 1, complete: true, incompleteReason: null, invalidItems: state.invalid, enrichmentDeferred: state.deferred };
    },
  };
  return { adapter, state };
}

let boardId: string;
beforeEach(async () => {
  await truncateAll(db);
  clock = new Date("2030-03-01T12:00:00Z");
  boardId = (await db.employerBoard.create({ data: { provider: "smartrecruiters", employerName: "Acme", boardToken: "acme", boardUrl: "https://jobs.smartrecruiters.com/acme" } })).id;
  // A job from another source with the same company/title/location → "duplicate".
  await db.jobPosting.create({
    data: {
      id: "job-known", dedupeKey: buildDedupeKey("Acme", "Software Developer Co-op dup", { city: "Toronto", province: "ON", arrangement: "hybrid" }), company: "Acme", title: "Software Developer Co-op dup", jobType: "co_op",
      disciplines: [], summary: "", responsibilities: [], qualifications: [], firstDiscoveredAt: now(), discoveryStatus: "discovered", origin: "manual", primarySourceId: "src-manual",
    },
  });
});

async function sync(adapter: AtsAdapter): Promise<SyncSummary> {
  const r = await syncBoard(db, boardId, { transport: fakeTransport({}).transport, adapter, now });
  if (!r.ok) throw new Error(r.message);
  clock = new Date(clock.getTime() + 3_600_000);
  return r.value;
}

const primary = (s: SyncSummary) =>
  s.created + s.updated + s.unchanged + s.reactivated + s.duplicate + s.filteredLocation + s.filteredEmploymentType + s.ingestErrors;

describe("sync accounting", () => {
  it("every fetched posting has exactly one primary disposition", async () => {
    const { adapter, state } = scripted();
    state.invalid = 2;
    state.postings = [
      posting("1"),
      posting("2", { descriptionText: "" }), // eligible, enrichment incomplete
      posting("3", { title: "Senior Staff Engineer" }), // employment type
      posting("4", { locationTexts: ["Austin, TX"], workplace: null }), // location
      posting("5", { locationTexts: ["Canada"], workplace: "onsite" }), // location (no province)
      posting("dup", { title: "Software Developer Co-op dup" }), // duplicate of a known job
    ];
    const s = await sync(adapter);
    expect(s).toMatchObject({ fetched: 6, created: 2, duplicate: 1, filteredLocation: 2, filteredEmploymentType: 1, eligible: 3, skipped: 3, invalid: 2, enrichmentIncomplete: 1 });
    expect(primary(s)).toBe(s.fetched);
    expect(s.eligible).toBe(s.fetched - s.filteredLocation - s.filteredEmploymentType);

    const run = await db.boardSyncRun.findFirstOrThrow({ where: { id: s.runId } });
    expect(run).toMatchObject({ eligible: 3, filteredLocation: 2, filteredEmploymentType: 1, duplicate: 1, invalid: 2, enrichmentIncomplete: 1, skipped: 3 });

    state.postings = state.postings.map((p) => (p.postingId === "1" ? { ...p, descriptionText: `${p.descriptionText} Updated.` } : p));
    const second = await sync(adapter);
    expect(second).toMatchObject({ created: 0, updated: 1, unchanged: 2, duplicate: 0 });
    expect(primary(second)).toBe(second.fetched);
  });

  it("a posting that stops being eligible but is still listed is never counted missing or expired", async () => {
    const { adapter, state } = scripted();
    state.postings = [posting("1")];
    await sync(adapter);
    // Same posting, now titled as a senior role: filtered, but still published.
    state.postings = [posting("1", { title: "Senior Software Developer" })];
    for (let i = 0; i < 3; i++) expect(await sync(adapter)).toMatchObject({ filteredEmploymentType: 1, missing: 0, closed: 0 });
    const obs = await db.sourceObservation.findFirstOrThrow({ where: { atsPostingId: "1" } });
    expect(obs).toMatchObject({ closedAt: null, missingCount: 0 });
    expect(await db.jobPosting.findFirstOrThrow({ where: { observations: { some: { id: obs.id } } } })).toMatchObject({ discoveryStatus: "discovered" });
  });
});

describe("description enrichment", () => {
  it("keeps the stored description and does not churn when a description was deferred", async () => {
    const { adapter, state } = scripted();
    state.postings = [posting("1")];
    const first = await sync(adapter);
    const job = await db.jobPosting.findFirstOrThrow({ where: { observations: { some: { atsPostingId: "1" } } } });
    const stored = job.description;
    expect(first.created).toBe(1);

    // This run hit the per-sync cap: the description was not loaded.
    state.postings = [posting("1", { descriptionText: "", descriptionFetched: false })];
    state.deferred = 1;
    for (let i = 0; i < 2; i++) {
      const s = await sync(adapter);
      expect(s).toMatchObject({ unchanged: 1, updated: 0, enrichmentIncomplete: 0 });
      const run = await db.boardSyncRun.findFirstOrThrow({ where: { id: s.runId } });
      expect(JSON.stringify(run.details)).toMatch(/deferred by the per-sync request limit/);
    }
    expect((await db.jobPosting.findUniqueOrThrow({ where: { id: job.id } })).description).toBe(stored);
    expect(await db.jobDescriptionSnapshot.count({ where: { jobId: job.id } })).toBe(1);

    // Enriched again later with the same text: still unchanged (no flip-flop).
    state.postings = [posting("1")];
    state.deferred = 0;
    expect(await sync(adapter)).toMatchObject({ unchanged: 1, updated: 0 });
  });

  it("new postings without a description are imported and flagged, then enriched later", async () => {
    const { adapter, state } = scripted();
    state.postings = [posting("1", { descriptionText: "", descriptionFetched: false })];
    expect(await sync(adapter)).toMatchObject({ created: 1, enrichmentIncomplete: 1 });
    state.postings = [posting("1")];
    expect(await sync(adapter)).toMatchObject({ updated: 1, enrichmentIncomplete: 0 });
    const job = await db.jobPosting.findFirstOrThrow({ where: { observations: { some: { atsPostingId: "1" } } } });
    expect(job.description).toMatch(/4-month co-op/);
  });
});
