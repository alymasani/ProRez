/**
 * Milestone 3C: automatic board discovery against real PostgreSQL —
 * search → candidate → verification → registration → 3B synchronization,
 * plus idempotency, concurrency, review, failures and recovery. Provider,
 * search and website responses are in-memory fakes; nothing touches the network.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fakeTransport } from "@/lib/ats/__fixtures__/transport";
import { AtsError } from "@/lib/ats/http";
import { DEFAULT_WORKER_CONFIG } from "@/lib/ats/schedule";
import type { AtsAdapter, FetchResult, ProviderPosting } from "@/lib/ats/types";
import { drainDueBoards, startWorker } from "@/lib/ats/worker";
import { createBoard } from "@/lib/boards/service";
import { DEFAULT_DISCOVERY_CONFIG, type DiscoveryConfig } from "@/lib/discovery/config";
import { importCommonCrawlFile } from "@/lib/discovery/import";
import type { PageResult, SiteFetcher } from "@/lib/discovery/net";
import { approveCandidate, registerCandidate, rejectCandidate, requeueCandidate } from "@/lib/discovery/register";
import { claimDiscovery, requestDiscoveryRun, runDiscovery, runDiscoveryIfDue, SCHEDULE_ID, type DiscoveryDeps } from "@/lib/discovery/run";
import type { SearchProvider } from "@/lib/discovery/search";
import { claimCandidates } from "@/lib/discovery/verify";
import type { AtsProvider } from "@/lib/types";
import { createTestPrisma, truncateAll } from "./helpers";

const db = createTestPrisma();
afterAll(() => db.$disconnect());

let clock = new Date("2030-02-01T12:00:00Z");
const now = () => new Date(clock);
const advance = (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000));

const posting = (id: string, description: string, over: Partial<ProviderPosting> = {}): ProviderPosting => ({
  postingId: id,
  title: `Software Developer Co-op ${id}`,
  url: null,
  descriptionText: description,
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

/** Live boards keyed "provider:token"; anything else is a 404. */
function fakeBoards(boards: Record<string, ProviderPosting[]>, failures: Record<string, AtsError> = {}) {
  const calls: string[] = [];
  const adapterFor = (provider: AtsProvider): AtsAdapter => ({
    provider,
    documentation: "test",
    async fetchPostings(token): Promise<FetchResult> {
      const key = `${provider}:${token}`;
      calls.push(key);
      if (failures[key]) throw failures[key];
      if (!(key in boards)) throw new AtsError("not_found", "The provider has no public board with this identifier.", 404);
      return { postings: structuredClone(boards[key]), warnings: [], requests: 1, complete: true, incompleteReason: null };
    },
  });
  return { adapterFor, calls };
}

/** Company websites keyed by URL; html or an ATS redirect. */
function fakeSites(pages: Record<string, { html?: string; redirect?: string }>): SiteFetcher & { fetched: string[] } {
  const fetched: string[] = [];
  let requests = 0;
  return {
    fetched,
    get requests() {
      return requests;
    },
    async fetchPage(url): Promise<PageResult> {
      requests++;
      fetched.push(url);
      const page = pages[url];
      if (!page) return { ok: false, url, failure: "http_error", message: "HTTP 404" };
      if (page.redirect) return { ok: true, url, finalUrl: url, status: 302, html: null, redirects: [page.redirect], atsRedirect: page.redirect };
      return { ok: true, url, finalUrl: url, status: 200, html: page.html ?? "", redirects: [] };
    },
  };
}

function fakeSearch(results: Record<string, string[]>, fail?: AtsError): SearchProvider & { queries: string[] } {
  const queries: string[] = [];
  let requests = 0;
  let credits = 0;
  return {
    name: "tavily",
    queries,
    get requests() {
      return requests;
    },
    get credits() {
      return credits;
    },
    async search(query) {
      requests++;
      queries.push(query);
      if (fail) throw fail;
      credits++;
      return { urls: results[query] ?? [], moreAvailable: false, requests: 1, credits: 1 };
    },
  };
}

const config: DiscoveryConfig = { ...DEFAULT_DISCOVERY_CONFIG, enabled: true, tavilyApiKey: "test", maxQueriesPerRun: 5, maxRequestsPerDay: 20, verifyConcurrency: 2 };

function deps(over: Partial<DiscoveryDeps> & { boards?: ReturnType<typeof fakeBoards> }): DiscoveryDeps {
  const boards = over.boards ?? fakeBoards({});
  return {
    prisma: db,
    config,
    atsTransport: fakeTransport({}).transport,
    siteFetcher: fakeSites({}),
    search: fakeSearch({}),
    now,
    adapterFor: boards.adapterFor,
    random: () => 0.5,
    ...over,
  };
}

/** Puts URLs on the first query the registry will pick for this run. */
async function searchFor(urls: string[]): Promise<SearchProvider & { queries: string[] }> {
  const { generateQueries, selectQueries } = await import("@/lib/discovery/queries");
  await db.discoveryQuery.createMany({ data: generateQueries(), skipDuplicates: true });
  const all = await db.discoveryQuery.findMany();
  const first = selectQueries(all.map((q) => ({ ...q, provider: q.provider as AtsProvider })), config.maxQueriesPerRun, now())[0];
  return fakeSearch({ [first.text]: urls });
}

const ACME_SITE = '<html><body><a href="https://boards.greenhouse.io/acmerobotics">Careers</a></body></html>';

beforeEach(async () => {
  await truncateAll(db);
  await db.discoverySchedule.create({ data: { id: SCHEDULE_ID, nextRunAt: now() } });
  clock = new Date("2030-02-01T12:00:00Z");
});

describe("search → candidate → verification → registration → synchronization", () => {
  it("registers a board whose company website links to it, and the 3B worker syncs it", async () => {
    const boards = fakeBoards({ "greenhouse:acmerobotics": [posting("1", "Join us! Learn more at https://www.acme-robotics.ca/about")] });
    const search = await searchFor(["https://boards.greenhouse.io/acmerobotics/jobs/1?gh_src=search", "https://example.com/not-ats"]);
    const sites = fakeSites({ "https://acme-robotics.ca/": { html: ACME_SITE } });
    const summary = await runDiscovery(deps({ boards, search, siteFetcher: sites }), { trigger: "manual" });
    expect(summary).toMatchObject({ status: "succeeded", searchRequests: 5, candidateUrls: 1, uniqueCandidates: 1, newCandidates: 1, validated: 1, registered: 1, pendingReview: 0 });

    const candidate = await db.discoveryCandidate.findFirstOrThrow({ include: { evidence: true } });
    expect(candidate).toMatchObject({ status: "registered", provider: "greenhouse", boardToken: "acmerobotics", companyDomain: "acme-robotics.ca", source: "search" });
    // Search results are not stored: the canonical board URL is kept, not the result URL.
    expect(candidate.discoveredUrl).toBe("https://job-boards.greenhouse.io/acmerobotics");
    const types = candidate.evidence.map((e) => `${e.type}:${e.status}`).sort();
    expect(types).toEqual(["ats_board_response:validated", "official_site_link:validated", "search_result:unvalidated"]);
    expect(JSON.stringify(candidate.evidence)).not.toContain("gh_src=search");

    const board = await db.employerBoard.findUniqueOrThrow({ where: { id: candidate.registeredBoardId! }, include: { company: true } });
    expect(board).toMatchObject({ origin: "discovered", enabled: true, employerName: "Acme Robotics", pollIntervalMinutes: 360 });
    expect(board.company).toMatchObject({ domain: "acme-robotics.ca", name: "Acme Robotics" });
    expect(board.nextSyncAt).toEqual(clock); // scheduled by the existing 3B rule

    // The existing worker picks it up like any registered board.
    const synced = await drainDueBoards({ prisma: db, transport: fakeTransport({}).transport, config: DEFAULT_WORKER_CONFIG, owner: "w", log: () => undefined, now, adapterFor: boards.adapterFor });
    expect(synced).toMatchObject([{ status: "succeeded", created: 1, trigger: "scheduled" }]);
    const query = await db.discoveryQuery.findFirstOrThrow({ where: { text: search.queries[0] } });
    expect(query).toMatchObject({ runs: 1, newCandidates: 1, verified: 1, requests: 1 });
  });

  it("accepts a careers-page redirect to the board as ownership evidence", async () => {
    const boards = fakeBoards({ "lever:acme": [posting("1", "Questions? careers@acme.dev")] });
    const search = await searchFor(["https://jobs.lever.co/acme"]);
    const sites = fakeSites({ "https://acme.dev/careers": { redirect: "https://jobs.lever.co/acme" } });
    expect(await runDiscovery(deps({ boards, search, siteFetcher: sites }), { trigger: "manual" })).toMatchObject({ registered: 1 });
    const evidence = await db.discoveryEvidence.findFirstOrThrow({ where: { type: "official_site_redirect" } });
    expect(evidence).toMatchObject({ status: "validated", sourceUrl: "https://acme.dev/careers" });
  });

  it("keeps a live board without ownership evidence pending review — never auto-registered", async () => {
    const boards = fakeBoards({ "ashby:mystery": [posting("1", "We are hiring. See https://mystery-corp.com")] });
    const search = await searchFor(["https://jobs.ashbyhq.com/mystery"]);
    // The hinted website exists but does not link to the board.
    const sites = fakeSites({ "https://mystery-corp.com/": { html: '<a href="https://jobs.ashbyhq.com/someone-else">jobs</a>' } });
    const summary = await runDiscovery(deps({ boards, search, siteFetcher: sites }), { trigger: "manual" });
    expect(summary).toMatchObject({ validated: 1, registered: 0, pendingReview: 1 });
    expect(await db.employerBoard.count()).toBe(0);
    expect(await db.company.count()).toBe(0);
    const c = await db.discoveryCandidate.findFirstOrThrow();
    expect(c).toMatchObject({ status: "pending_review", companyDomain: "mystery-corp.com" });
    expect(c.statusReason).toMatch(/none of mystery-corp.com links to it/);
  });

  it("rejects boards the provider does not know, without registering anything", async () => {
    const search = await searchFor(["https://jobs.lever.co/ghost-board"]);
    expect(await runDiscovery(deps({ search }), { trigger: "manual" })).toMatchObject({ rejected: 1, registered: 0 });
    expect(await db.discoveryCandidate.findFirstOrThrow()).toMatchObject({ status: "rejected", statusReason: expect.stringMatching(/no public board/) });
  });
});

describe("idempotency, duplicates and concurrency", () => {
  it("repeated discovery creates no duplicate candidates, boards, companies or sync tasks", async () => {
    const boards = fakeBoards({ "greenhouse:acmerobotics": [posting("1", "https://acme-robotics.ca")] });
    const sites = fakeSites({ "https://acme-robotics.ca/": { html: ACME_SITE } });
    const urls = ["https://boards.greenhouse.io/acmerobotics", "https://job-boards.greenhouse.io/AcmeRobotics/jobs/9", "https://boards.greenhouse.io/embed/job_board?for=acmerobotics"];
    for (let i = 0; i < 3; i++) {
      const search = await searchFor(urls);
      await runDiscovery(deps({ boards, search, siteFetcher: sites }), { trigger: "manual" });
      advance(60 * 24 * 8); // past the query cooldown
    }
    expect(await db.discoveryCandidate.count()).toBe(1);
    expect(await db.employerBoard.count()).toBe(1);
    expect(await db.company.count()).toBe(1);
    expect(await db.employerBoard.count({ where: { nextSyncAt: { not: null } } })).toBe(1);
    const runs = await db.discoveryRun.findMany({ orderBy: { startedAt: "asc" } });
    expect(runs.map((r) => r.newCandidates)).toEqual([1, 0, 0]);
  });

  it("detects a previously registered board and links it without changing it", async () => {
    const manual = await createBoard(db, { provider: "lever", employerName: "My Name For Acme", boardToken: "acme", boardUrl: "https://jobs.lever.co/acme", pollIntervalMinutes: 720, enabled: false });
    if (!manual.ok) throw new Error(manual.message);
    const boards = fakeBoards({ "lever:acme": [posting("1", "x")] });
    const search = await searchFor(["https://jobs.lever.co/acme/123"]);
    const before = await db.employerBoard.findUniqueOrThrow({ where: { id: manual.value.id } });
    expect(await runDiscovery(deps({ boards, search }), { trigger: "manual" })).toMatchObject({ registered: 0 });
    expect(await db.discoveryCandidate.findFirstOrThrow()).toMatchObject({ status: "registered", registeredBoardId: manual.value.id });
    expect(await db.employerBoard.findUniqueOrThrow({ where: { id: manual.value.id } })).toEqual(before);
    expect(boards.calls).toEqual([]); // no provider request needed
  });

  it("concurrent registrations of one candidate create exactly one board", async () => {
    await db.discoveryCandidate.create({
      data: { provider: "ashby", boardToken: "acme", boardUrl: "https://jobs.ashbyhq.com/acme", discoveredUrl: "https://jobs.ashbyhq.com/acme", source: "manual", status: "verified", companyName: "Acme", companyDomain: "acme.dev", firstDiscoveredAt: now(), lastDiscoveredAt: now() },
    });
    const c = await db.discoveryCandidate.findFirstOrThrow();
    const results = await Promise.all(Array.from({ length: 5 }, () => registerCandidate(db, { candidateId: c.id, mode: "automatic", now: now() })));
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results.filter((r) => r.ok && r.value.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.ok && r.value.boardId)).size).toBe(1);
    expect(await db.employerBoard.count()).toBe(1);
  });

  it("two discovery workers never run at the same time", async () => {
    const [a, b] = await Promise.all([
      claimDiscovery(db, { owner: "a", now: now(), leaseMs: config.leaseMs, scheduledEnabled: true }),
      claimDiscovery(db, { owner: "b", now: now(), leaseMs: config.leaseMs, scheduledEnabled: true }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    // And the run table itself allows one running run.
    await db.discoveryRun.create({ data: { source: "x", trigger: "manual", startedAt: now() } });
    expect(await runDiscovery(deps({}), { trigger: "manual" })).toBeNull();
  });

  it("a company can own several verified boards; companies are never merged by name", async () => {
    const boards = fakeBoards({ "greenhouse:acme": [posting("1", "https://acme.dev")], "lever:acme-eng": [posting("2", "https://acme.dev")], "ashby:acmecorp": [posting("3", "https://acme-corp.dev")] });
    const sites = fakeSites({
      "https://acme.dev/": { html: '<a href="https://boards.greenhouse.io/acme">a</a><a href="https://jobs.lever.co/acme-eng">b</a>' },
      "https://acme-corp.dev/": { html: '<a href="https://jobs.ashbyhq.com/acmecorp">c</a>' },
    });
    const search = await searchFor(["https://boards.greenhouse.io/acme", "https://jobs.lever.co/acme-eng", "https://jobs.ashbyhq.com/acmecorp"]);
    expect(await runDiscovery(deps({ boards, search, siteFetcher: sites }), { trigger: "manual" })).toMatchObject({ registered: 3 });
    const companies = await db.company.findMany({ include: { boards: true }, orderBy: { domain: "asc" } });
    expect(companies.map((c) => [c.domain, c.boards.length])).toEqual([["acme-corp.dev", 1], ["acme.dev", 2]]);
  });
});

describe("manual review", () => {
  async function pending() {
    return db.discoveryCandidate.create({
      data: { provider: "lever", boardToken: "maybe", boardUrl: "https://jobs.lever.co/maybe", discoveredUrl: "https://jobs.lever.co/maybe", source: "search", status: "pending_review", companyDomain: "maybe.dev", firstDiscoveredAt: now(), lastDiscoveredAt: now() },
    });
  }

  it("approval re-validates the board, registers it, and does not attach an unverified domain", async () => {
    const c = await pending();
    const live = fakeTransport({ "https://api.lever.co/v0/postings/maybe?mode=json&skip=0&limit=100": [] });
    expect(await approveCandidate(db, { candidateId: c.id, employerName: null, transport: live.transport })).toMatchObject({ ok: false, code: "validation" });
    const result = await approveCandidate(db, { candidateId: c.id, employerName: "Maybe Inc", transport: live.transport, now: now() });
    expect(result).toMatchObject({ ok: true, value: { created: true } });
    const board = await db.employerBoard.findFirstOrThrow();
    expect(board).toMatchObject({ employerName: "Maybe Inc", origin: "discovered", companyId: null });
    expect(await db.discoveryEvidence.count({ where: { candidateId: c.id, type: "manual_review" } })).toBe(1);
    // Approving again is a no-op.
    expect(await approveCandidate(db, { candidateId: c.id, employerName: "Maybe Inc", transport: live.transport })).toMatchObject({ ok: true, value: { created: false } });
  });

  it("approval refuses a board the provider no longer has", async () => {
    const c = await pending();
    expect(await approveCandidate(db, { candidateId: c.id, employerName: "X", transport: fakeTransport({}).transport })).toMatchObject({ ok: false, message: expect.stringMatching(/no longer has/) });
    expect(await db.employerBoard.count()).toBe(0);
  });

  it("reject and re-validate follow the allowed transitions", async () => {
    const c = await pending();
    expect(await rejectCandidate(db, c.id, "Recruiting agency")).toMatchObject({ ok: true });
    expect(await registerCandidate(db, { candidateId: c.id, mode: "manual_approval", employerName: "X" })).toMatchObject({ ok: false, code: "invalid_transition" });
    expect(await requeueCandidate(db, c.id, now())).toMatchObject({ ok: true });
    expect(await db.discoveryCandidate.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "discovered", attempts: 0 });
  });
});

describe("failures, budgets and recovery", () => {
  it("a rate-limited search ends the search phase as a partial run; other sources still work", async () => {
    // A saved job references an unregistered board (existing_jobs source).
    await db.jobPosting.create({
      data: {
        id: "job-x", dedupeKey: "k", company: "Acme", title: "Dev", jobType: "co_op", disciplines: [], summary: "", responsibilities: [], qualifications: [],
        firstDiscoveredAt: now(), discoveryStatus: "discovered", origin: "manual", primarySourceId: "src-manual",
        observations: { create: { sourceId: "src-manual", sourceUrl: "https://jobs.ashbyhq.com/savedco/abc", atsProvider: "ashby", atsBoardToken: "savedco", atsPostingId: "abc", firstSeenAt: now(), lastSeenAt: now() } },
      },
    });
    const search = fakeSearch({}, new AtsError("rate_limited", "The search API rate limit or quota was reached.", 429));
    const summary = await runDiscovery(deps({ search }), { trigger: "scheduled" });
    expect(summary).toMatchObject({ status: "partial", apiErrors: 1, searchRequests: 1, newCandidates: 1 });
    expect(search.queries).toHaveLength(1); // stopped after the quota error
    expect(await db.discoveryCandidate.findFirstOrThrow()).toMatchObject({ boardToken: "savedco", source: "existing_jobs" });
  });

  it("missing credentials disable search gracefully", async () => {
    const summary = await runDiscovery(deps({ config: { ...config, tavilyApiKey: null }, search: null }), { trigger: "manual" });
    expect(summary).toMatchObject({ status: "succeeded", searchRequests: 0, source: "existing_jobs" });
    expect(summary?.notes.join(" ")).toMatch(/TAVILY_API_KEY is not set/);
  });

  it("enforces the rolling 24-hour search budget", async () => {
    await db.discoveryRun.create({ data: { source: "search", trigger: "scheduled", status: "succeeded", startedAt: new Date(clock.getTime() - 3_600_000), finishedAt: now(), searchRequests: 20 } });
    const search = await searchFor(["https://jobs.lever.co/x"]);
    const summary = await runDiscovery(deps({ search }), { trigger: "manual" });
    expect(search.queries).toEqual([]);
    expect(summary?.notes.join(" ")).toMatch(/Daily search budget used \(20 of 20/);
  });

  it("enforces the Tavily calendar-month credit budget", async () => {
    await db.discoveryRun.create({ data: { source: "search", trigger: "scheduled", status: "succeeded", startedAt: new Date("2030-02-01T01:00:00Z"), finishedAt: now(), searchProvider: "tavily", searchRequests: 20, searchCredits: 20 } });
    const search = await searchFor(["https://jobs.lever.co/x"]);
    const summary = await runDiscovery(deps({ search, config: { ...config, maxCreditsPerMonth: 20, maxRequestsPerDay: 100 } }), { trigger: "manual" });
    expect(search.queries).toEqual([]);
    expect(summary?.notes.join(" ")).toMatch(/Monthly Tavily credit budget used \(20 of 20/);
  });

  it("retries temporary provider failures a bounded number of times, then rejects", async () => {
    const boards = fakeBoards({}, { "lever:flaky": new AtsError("http_error", "The provider returned HTTP 503.", 503) });
    await requestDiscoveryRun(db);
    await db.discoveryCandidate.create({ data: { provider: "lever", boardToken: "flaky", boardUrl: "https://jobs.lever.co/flaky", discoveredUrl: "https://jobs.lever.co/flaky", source: "manual", firstDiscoveredAt: now(), lastDiscoveredAt: now() } });
    const statuses: string[] = [];
    for (let i = 0; i < 3; i++) {
      await runDiscovery(deps({ boards, search: null, config: { ...config, tavilyApiKey: null } }), { trigger: "manual" });
      const c = await db.discoveryCandidate.findFirstOrThrow();
      statuses.push(`${c.status}:${c.attempts}`);
      if (c.nextAttemptAt) clock = new Date(c.nextAttemptAt.getTime() + 1_000);
    }
    expect(statuses).toEqual(["discovered:1", "discovered:2", "rejected:3"]);
  });

  it("recovers candidates and schedules left by a crashed worker", async () => {
    await db.discoveryCandidate.create({ data: { provider: "lever", boardToken: "stuck", boardUrl: "https://jobs.lever.co/stuck", discoveredUrl: "https://jobs.lever.co/stuck", source: "manual", status: "validating", validatingUntil: new Date(clock.getTime() - 1), firstDiscoveredAt: now(), lastDiscoveredAt: now() } });
    expect(await claimCandidates(db, { limit: 10, now: now(), leaseMs: 60_000 })).toHaveLength(1);
    // Schedule lease held by a dead worker.
    await db.discoverySchedule.update({ where: { id: SCHEDULE_ID }, data: { leaseOwner: "dead", leaseExpiresAt: new Date(clock.getTime() + 60_000), nextRunAt: now() } });
    expect(await claimDiscovery(db, { owner: "alive", now: now(), leaseMs: 60_000, scheduledEnabled: true })).toBeNull();
    advance(2);
    expect(await claimDiscovery(db, { owner: "alive", now: now(), leaseMs: 60_000, scheduledEnabled: true })).toEqual({ trigger: "scheduled" });
  });

  it("scheduled discovery persists its next run, honours the switch and manual requests", async () => {
    const off = { ...config, enabled: false, tavilyApiKey: null };
    expect(await runDiscoveryIfDue(deps({ config: off, search: null }), { owner: "w" })).toBeNull();
    await requestDiscoveryRun(db, now()); // "Run discovery now" works even when scheduling is off
    expect(await runDiscoveryIfDue(deps({ config: off, search: null }), { owner: "w" })).toMatchObject({ trigger: "manual" });
    const schedule = await db.discoverySchedule.findUniqueOrThrow({ where: { id: SCHEDULE_ID } });
    expect(schedule).toMatchObject({ leaseOwner: null, requestedAt: null });
    expect(Math.round((schedule.nextRunAt!.getTime() - clock.getTime()) / 3_600_000)).toBe(24);
  });
});

describe("Common Crawl import", () => {
  it("imports bounded, deduplicated, unverified candidates and records the crawl", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "prorez-cc-"));
    const file = path.join(dir, "cc.jsonl");
    await writeFile(
      file,
      [
        '{"url":"https://jobs.lever.co/ccco/123","timestamp":"20250915120000","crawl":"CC-MAIN-2025-38"}',
        '{"url":"https://jobs.lever.co/CCCO","timestamp":"20250916120000","crawl":"CC-MAIN-2025-38"}',
        "https://example.com/not-an-ats-url",
        "https://jobs.smartrecruiters.com/OtherCo/7440001-dev",
        "https://boards.greenhouse.io/third",
      ].join("\n"),
    );
    const summary = await importCommonCrawlFile(db, file, { maxRows: 4, now });
    expect(summary).toMatchObject({ rows: 4, recognized: 3, unique: 2, newCandidates: 2, ignored: 1, truncated: true });
    const candidates = await db.discoveryCandidate.findMany({ orderBy: { boardToken: "asc" } });
    expect(candidates.map((c) => [c.boardToken, c.status, c.source])).toEqual([["ccco", "discovered", "common_crawl"], ["otherco", "discovered", "common_crawl"]]);
    const evidence = await db.discoveryEvidence.findFirstOrThrow({ where: { type: "common_crawl" } });
    expect(evidence).toMatchObject({ status: "unvalidated", observedAt: new Date("2025-09-15T12:00:00Z") });
    expect(await db.discoveryRun.findFirstOrThrow()).toMatchObject({ source: "common_crawl", status: "partial" });
  });
});

describe("worker integration", () => {
  it("the 3B worker runs requested discovery in its own lane and still syncs boards", async () => {
    const boards = fakeBoards({ "greenhouse:acmerobotics": [posting("1", "https://acme-robotics.ca")] });
    const sites = fakeSites({ "https://acme-robotics.ca/": { html: ACME_SITE } });
    await db.discoveryCandidate.create({
      data: { provider: "greenhouse", boardToken: "acmerobotics", boardUrl: "https://job-boards.greenhouse.io/acmerobotics", discoveredUrl: "https://job-boards.greenhouse.io/acmerobotics", source: "manual", firstDiscoveredAt: now(), lastDiscoveredAt: now() },
    });
    await requestDiscoveryRun(db, now());
    const worker = startWorker({
      prisma: db,
      transport: fakeTransport({}).transport,
      config: { ...DEFAULT_WORKER_CONFIG, pollIntervalMs: 50 },
      owner: "worker-int",
      log: () => undefined,
      now,
      adapterFor: boards.adapterFor,
      discovery: () => deps({ boards, siteFetcher: sites, search: null, config: { ...config, tavilyApiKey: null } }),
    });
    // Discovery registers the board; the same worker then syncs it.
    for (let i = 0; i < 100 && (await db.boardSyncRun.count()) === 0; i++) await new Promise((r) => setTimeout(r, 50));
    await worker.stop();
    expect(await db.discoveryRun.count({ where: { status: "succeeded" } })).toBe(1);
    expect(await db.employerBoard.findFirstOrThrow()).toMatchObject({ origin: "discovered" });
    expect(await db.boardSyncRun.findFirstOrThrow()).toMatchObject({ trigger: "scheduled", status: "succeeded", created: 1 });
  });
});
