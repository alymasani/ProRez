/**
 * Milestone 3D against real PostgreSQL: universal career sources.
 * Search → Workday / careers-page candidates → verification → registration →
 * 3B sync, routing to ATS adapters, manual URL import, safe reconciliation
 * for incomplete generic snapshots. Every response is an in-memory fake.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { AtsError } from "@/lib/ats/http";
import { syncBoard } from "@/lib/ats/sync";
import type { AtsAdapter, FetchResult } from "@/lib/ats/types";
import { DEFAULT_WORKER_CONFIG } from "@/lib/ats/schedule";
import { drainDueBoards } from "@/lib/ats/worker";
import { fakeSite, fakeWorkday, workdayDetail, type FakePage } from "@/lib/careers/__fixtures__/fake";
import { importCareerUrl, previewCareerUrl } from "@/lib/careers/importer";
import { DEFAULT_DISCOVERY_CONFIG, type DiscoveryConfig } from "@/lib/discovery/config";
import { runDiscovery, SCHEDULE_ID, type DiscoveryDeps } from "@/lib/discovery/run";
import type { SearchProvider } from "@/lib/discovery/search";
import { claimCandidates } from "@/lib/discovery/verify";
import type { AtsProvider } from "@/lib/types";
import { createTestPrisma, truncateAll } from "./helpers";

const db = createTestPrisma();
afterAll(() => db.$disconnect());
let clock = new Date("2030-04-01T12:00:00Z");
const now = () => new Date(clock);
const advance = (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000));

const config: DiscoveryConfig = { ...DEFAULT_DISCOVERY_CONFIG, enabled: true, tavilyApiKey: "test", maxQueriesPerRun: 12, maxRequestsPerDay: 50, verifyConcurrency: 1 };

function fakeSearch(byProvider: Partial<Record<AtsProvider, string[]>>): SearchProvider & { queries: string[] } {
  const queries: string[] = [];
  let requests = 0;
  return {
    name: "tavily",
    queries,
    get requests() {
      return requests;
    },
    get credits() {
      return requests;
    },
    async search(query) {
      requests++;
      queries.push(query);
      // The first query of each provider returns that provider's URLs.
      const provider = (query.includes("site:myworkdayjobs.com") ? "workday" : query.includes("site:") ? "other" : "company_site") as AtsProvider;
      const urls = byProvider[provider] ?? [];
      byProvider[provider] = [];
      return { urls, moreAvailable: false, requests: 1, credits: 1 };
    },
  };
}

function deps(over: Partial<DiscoveryDeps>): DiscoveryDeps {
  return { prisma: db, config, atsTransport: fakeWorkday({}), siteFetcher: fakeSite({}), search: fakeSearch({}), now, random: () => 0.5, ...over };
}

const DESC = "<p>You will build backend services. Responsibilities: write tests and review code.</p><p>Qualifications: TypeScript experience. Apply with your resume. Learn more at https://acme.ca</p>";
const WD_BASE = "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/external";
const wdItems = [
  { title: "Software Developer Intern", externalPath: "/job/Toronto-ON/Software-Developer-Intern_R100", locationsText: "Toronto, ON", bulletFields: ["R100"] },
  { title: "Senior Staff Engineer", externalPath: "/job/Toronto-ON/Senior-Staff-Engineer_R101", locationsText: "Toronto, ON", bulletFields: ["R101"] },
];
const wdDetails = {
  "/job/Toronto-ON/Software-Developer-Intern_R100": workdayDetail({ title: "Software Developer Intern", reqId: "R100", description: DESC.repeat(3) }),
  "/job/Toronto-ON/Senior-Staff-Engineer_R101": workdayDetail({ title: "Senior Staff Engineer", reqId: "R101", description: DESC.repeat(3) }),
};

const DESC_TEXT = "About the role: you will build backend services. Responsibilities include writing tests and code reviews. Qualifications: experience with TypeScript. Apply with your application. ".repeat(3);
const jobLd = (title: string, id: string, url: string) => ({
  "@context": "https://schema.org", "@type": "JobPosting", title, description: DESC_TEXT, identifier: id, url,
  hiringOrganization: { "@type": "Organization", name: "Acme Robotics" },
  jobLocation: { "@type": "Place", address: { addressLocality: "Toronto", addressRegion: "ON", addressCountry: "CA" } },
  employmentType: "INTERN",
});
const ldPage = (jobs: unknown[], extra = "") => `<html><body><main><h1>Careers</h1>${extra}</main><script type="application/ld+json">${JSON.stringify(jobs)}</script></body></html>`;

beforeEach(async () => {
  await truncateAll(db);
  await db.discoverySchedule.create({ data: { id: SCHEDULE_ID, nextRunAt: now() } });
  clock = new Date("2030-04-01T12:00:00Z");
});

describe("schema (additive migration)", () => {
  it("keeps existing boards valid and accepts Workday and company-site identities", async () => {
    expect(await db.jobSource.findUnique({ where: { provider: "workday" } })).toMatchObject({ id: "src-workday" });
    await db.employerBoard.create({ data: { provider: "lever", employerName: "L", boardToken: "acme", boardUrl: "https://jobs.lever.co/acme" } });
    await db.employerBoard.create({ data: { provider: "workday", employerName: "W", boardToken: "acme.wd3/external", boardUrl: "https://acme.wd3.myworkdayjobs.com/external", locale: "en-US", extractionStrategy: "workday_cxs" } });
    await db.employerBoard.create({ data: { provider: "company_site", employerName: "G", boardToken: "acme.ca/Careers", boardUrl: "https://acme.ca/Careers", extractionStrategy: "json_ld" } });
    await expect(db.employerBoard.create({ data: { provider: "workday", employerName: "W", boardToken: "acme.wd3", boardUrl: "https://acme.wd3.myworkdayjobs.com/" } })).rejects.toThrow(/employer_boards_token_format/);
    await expect(db.employerBoard.create({ data: { provider: "company_site", employerName: "G", boardToken: "ACME.ca/careers", boardUrl: "https://ACME.ca/careers" } })).rejects.toThrow(/employer_boards_token_format/);
    await expect(db.employerBoard.create({ data: { provider: "lever", employerName: "L", boardToken: "a/b", boardUrl: "https://jobs.lever.co/a/b" } })).rejects.toThrow(/employer_boards_token_format/);
    await expect(db.employerBoard.create({ data: { provider: "company_site", employerName: "G", boardToken: "acme.ca/x", boardUrl: "https://acme.ca/x", extractionStrategy: "guess" } })).rejects.toThrow(/employer_boards_strategy/);
  });
});

describe("Workday: search → candidate → verification → registration → sync", () => {
  it("discovers, verifies ownership via the company site, registers once, and syncs with provenance", async () => {
    const site = fakeSite({ "https://acme.ca/": `<a href="https://acme.wd3.myworkdayjobs.com/en-US/External">Careers</a>` });
    const transport = fakeWorkday({ [WD_BASE]: { total: 2, items: wdItems, details: wdDetails } }, site);
    const search = fakeSearch({ workday: ["https://acme.wd3.myworkdayjobs.com/en-US/External/job/Toronto-ON/Software-Developer-Intern_R100", "https://acme.wd3.myworkdayjobs.com/fr-CA/External"] });
    const run = await runDiscovery(deps({ atsTransport: transport, siteFetcher: site, search }), { trigger: "manual" });
    expect(run).toMatchObject({ registered: 1, validated: 1 });
    expect(search.queries.some((q) => q.startsWith("site:myworkdayjobs.com"))).toBe(true);

    const c = await db.discoveryCandidate.findFirstOrThrow({ where: { provider: "workday" } });
    expect(c).toMatchObject({ boardToken: "acme.wd3/external", status: "registered", companyDomain: "acme.ca" });
    const board = await db.employerBoard.findFirstOrThrow({ include: { company: true } });
    expect(board).toMatchObject({ provider: "workday", boardToken: "acme.wd3/external", origin: "discovered", extractionStrategy: "workday_cxs", company: { domain: "acme.ca" } });
    expect(board.nextSyncAt).not.toBeNull();

    // Enters the existing 3B worker.
    const results = await drainDueBoards({ prisma: db, transport, config: { ...DEFAULT_WORKER_CONFIG, concurrency: 1 }, owner: "w1", log: () => undefined, now });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ status: "succeeded", complete: true, fetched: 2, created: 1, filteredEmploymentType: 1 });
    const obs = await db.sourceObservation.findFirstOrThrow({ where: { atsProvider: "workday" }, include: { job: true } });
    expect(obs).toMatchObject({ sourceId: "src-workday", atsBoardToken: "acme.wd3/external", atsPostingId: "software-developer-intern_r100", boardId: board.id });
    expect(obs.job.description).toMatch(/backend services/);
    const sync = await db.boardSyncRun.findFirstOrThrow();
    expect(sync).toMatchObject({ extractionStrategy: "workday_cxs", descriptionComplete: true });

    // Repeated discovery and syncs: no duplicate registration, no duplicate jobs.
    advance(60 * 24 * 8);
    await runDiscovery(deps({ atsTransport: transport, siteFetcher: site, search: fakeSearch({ workday: ["https://acme.wd3.myworkdayjobs.com/External"] }) }), { trigger: "manual" });
    expect(await db.employerBoard.count({ where: { provider: "workday" } })).toBe(1);
    const again = await syncBoard(db, board.id, { transport, now });
    expect(again.ok && again.value).toMatchObject({ created: 0, unchanged: 1 });
    expect(await db.jobPosting.count()).toBe(1);
  });

  it("a live Workday site without ownership evidence waits for review", async () => {
    const transport = fakeWorkday({ [WD_BASE]: { total: 2, items: wdItems, details: wdDetails } });
    const run = await runDiscovery(deps({ atsTransport: transport, siteFetcher: fakeSite({}), search: fakeSearch({ workday: ["https://acme.wd3.myworkdayjobs.com/External"] }) }), { trigger: "manual" });
    expect(run).toMatchObject({ registered: 0, pendingReview: 1 });
    expect(await db.employerBoard.count()).toBe(0);
  });
});

describe("Generic careers pages", () => {
  const careers = (jobs = [jobLd("Software Developer Co-op", "A1", "https://acme.ca/careers/a1"), jobLd("Firmware Intern", "B2", "https://acme.ca/careers/b2")], extra = "") => ldPage(jobs, extra);

  it("search → careers page → extraction → ownership (own domain) → registration → sync", async () => {
    const site = fakeSite({ "https://acme.ca/careers": careers() });
    const transport = { ...fakeWorkday({}), site: () => site };
    const run = await runDiscovery(deps({ atsTransport: transport, siteFetcher: site, search: fakeSearch({ company_site: ["https://acme.ca/careers/", "https://www.linkedin.com/jobs/view/1", "https://acme.ca/blog/hello"] }) }), { trigger: "manual" });
    expect(run).toMatchObject({ registered: 1 });
    const c = await db.discoveryCandidate.findFirstOrThrow({ where: { provider: "company_site" }, include: { evidence: true } });
    expect(c).toMatchObject({ boardToken: "acme.ca/careers", status: "registered", extractionStrategy: "json_ld", companyName: "Acme Robotics", postingCount: 2 });
    expect(c.evidence.map((e) => e.type)).toEqual(expect.arrayContaining(["search_result", "career_page_extraction", "official_site_link"]));
    const board = await db.employerBoard.findFirstOrThrow();
    expect(board).toMatchObject({ provider: "company_site", boardUrl: "https://acme.ca/careers", extractionStrategy: "json_ld" });

    const s = await syncBoard(db, board.id, { transport, now });
    expect(s.ok && s.value).toMatchObject({ status: "succeeded", complete: true, created: 2 });
    const obs = await db.sourceObservation.findMany({ where: { boardId: board.id }, orderBy: { atsPostingId: "asc" } });
    expect(obs.map((o) => [o.sourceId, o.atsProvider, o.atsPostingId])).toEqual([["src-company-site", "company_site", "id:a1"], ["src-company-site", "company_site", "id:b2"]]);
    const again = await syncBoard(db, board.id, { transport, now });
    expect(again.ok && again.value).toMatchObject({ created: 0, unchanged: 2 });
  });

  it("a careers page that links to a supported ATS is routed to that adapter, not scraped", async () => {
    const site = fakeSite({
      "https://acme.ca/careers": `<html><body><a href="https://job-boards.greenhouse.io/acme">Open roles</a></body></html>`,
      "https://acme.ca/": `<a href="https://boards.greenhouse.io/acme">Jobs</a>`,
    });
    const greenhouse: AtsAdapter = {
      provider: "greenhouse",
      documentation: "test",
      async fetchPostings(token): Promise<FetchResult> {
        if (token !== "acme") throw new AtsError("not_found", "nope", 404);
        return { postings: [], warnings: [], requests: 1, complete: true, incompleteReason: null };
      },
    };
    const d = deps({ siteFetcher: site, search: fakeSearch({ company_site: ["https://acme.ca/careers"] }), adapterFor: (p) => (p === "greenhouse" ? greenhouse : undefined) });
    await runDiscovery(d, { trigger: "manual" });
    // The routed board was queued by the first run and is verified by the next.
    advance(5);
    await runDiscovery(d, { trigger: "manual" });
    const generic = await db.discoveryCandidate.findFirstOrThrow({ where: { provider: "company_site" } });
    expect(generic.status).toBe("rejected");
    expect(generic.statusReason).toMatch(/Routed to https:\/\/job-boards.greenhouse.io\/acme/);
    const gh = await db.discoveryCandidate.findFirstOrThrow({ where: { provider: "greenhouse" } });
    // Routed board: verified using the routing page's domain as the first ownership hint.
    expect(gh).toMatchObject({ boardToken: "acme", source: "career_page", status: "registered", companyDomain: "acme.ca" });
    expect(await db.employerBoard.findFirstOrThrow()).toMatchObject({ provider: "greenhouse", boardToken: "acme" });
  });

  it("a page with no extractable jobs is marked unsupported with diagnostics, never registered", async () => {
    const site = fakeSite({ "https://acme.ca/careers": "<html><body><h1>Join us</h1><p>We are always looking for great people.</p></body></html>" });
    await runDiscovery(deps({ siteFetcher: site, search: fakeSearch({ company_site: ["https://acme.ca/careers"] }) }), { trigger: "manual" });
    const c = await db.discoveryCandidate.findFirstOrThrow({ include: { evidence: true } });
    expect(c.status).toBe("unsupported");
    expect(c.evidence.find((e) => e.type === "career_page_extraction")).toMatchObject({ status: "failed" });
    expect(await db.employerBoard.count()).toBe(0);
  });

  it("an incomplete generic snapshot never marks absent jobs missing; complete ones reconcile as usual", async () => {
    const pages: Record<string, FakePage> = { "https://acme.ca/careers": careers() };
    const site = fakeSite(pages);
    const transport = { ...fakeWorkday({}), site: () => site };
    const imported = await importCareerUrl(db, { url: "https://acme.ca/careers", employerName: null, now: now() }, { transport });
    if (!imported.ok) throw new Error(imported.message);
    const boardId = imported.value.boardId;
    expect(await syncBoard(db, boardId, { transport, now }).then((r) => r.ok && r.value)).toMatchObject({ created: 2, complete: true });

    // B2 disappears, but the page now has pagination ProRez cannot follow → incomplete.
    pages["https://acme.ca/careers"] = careers([jobLd("Software Developer Co-op", "A1", "https://acme.ca/careers/a1")], `<button class="pagination">Load more</button>`);
    for (let i = 0; i < 3; i++) {
      advance(60);
      expect(await syncBoard(db, boardId, { transport, now }).then((r) => r.ok && r.value)).toMatchObject({ status: "partial", complete: false, missing: 0, closed: 0 });
    }
    expect(await db.sourceObservation.count({ where: { boardId, closedAt: { not: null } } })).toBe(0);

    // Provably complete again: B2 is absent from two consecutive complete snapshots → inactive.
    pages["https://acme.ca/careers"] = careers([jobLd("Software Developer Co-op", "A1", "https://acme.ca/careers/a1")]);
    advance(60);
    expect(await syncBoard(db, boardId, { transport, now }).then((r) => r.ok && r.value)).toMatchObject({ complete: true, missing: 1, closed: 0 });
    advance(60);
    expect(await syncBoard(db, boardId, { transport, now }).then((r) => r.ok && r.value)).toMatchObject({ complete: true, closed: 1 });
    expect((await db.employerBoard.findUniqueOrThrow({ where: { id: boardId } })).lastCompleteSnapshotAt).not.toBeNull();
  });
});

describe("Universal URL import", () => {
  it("imports a Workday URL (any locale/posting variant) as one scheduled source", async () => {
    const transport = fakeWorkday({ [WD_BASE]: { total: 2, items: wdItems, details: wdDetails } }, fakeSite({}));
    const preview = await previewCareerUrl(db, "acme.wd3.myworkdayjobs.com/en-US/External/job/Toronto-ON/Software-Developer-Intern_R100", { transport });
    expect(preview.ok && preview.value).toMatchObject({ sourceType: "workday", boardToken: "acme.wd3/external", locale: "en-US", jobsDetected: 2, eligibleJobs: 1, listingComplete: true, registrable: true, verification: "unverified" });
    const r = await importCareerUrl(db, { url: "https://acme.wd3.myworkdayjobs.com/fr-CA/External", employerName: "Acme", now: now() }, { transport });
    expect(r.ok).toBe(true);
    expect(await db.employerBoard.findFirstOrThrow()).toMatchObject({ provider: "workday", origin: "manual", locale: "fr-CA", extractionStrategy: "workday_cxs", companyId: null });
    const dup = await importCareerUrl(db, { url: "https://acme.wd3.myworkdayjobs.com/External", employerName: "Acme", now: now() }, { transport });
    expect(dup).toMatchObject({ ok: false, code: "duplicate" });
  });

  it("imports a custom careers page with company verification, and refuses pages without jobs", async () => {
    const site = fakeSite({
      "https://acme.ca/careers": ldPage([jobLd("Software Developer Co-op", "A1", "https://acme.ca/careers/a1")]),
      "https://jobs.acme.ca/": ldPage([jobLd("Firmware Intern", "B2", "https://jobs.acme.ca/b2")]),
      "https://acme.ca/": "<html><body>No link to the jobs subdomain</body></html>",
      "https://acme.ca/empty": "<html><body><h1>Careers</h1></body></html>",
      "xml:https://acme.ca/robots.txt": "",
    });
    const transport = { ...fakeWorkday({}), site: () => site };
    const own = await previewCareerUrl(db, "https://acme.ca/careers", { transport });
    expect(own.ok && own.value).toMatchObject({ sourceType: "generic", verification: "verified", verifiedDomain: "acme.ca", companyName: "Acme Robotics", extractionStrategy: "json_ld", jobsDetected: 1 });
    const sub = await previewCareerUrl(db, "https://jobs.acme.ca/", { transport });
    expect(sub.ok && sub.value).toMatchObject({ verification: "unverified", verifiedDomain: null, registrable: true });
    const empty = await previewCareerUrl(db, "https://acme.ca/empty", { transport });
    expect(empty.ok && empty.value).toMatchObject({ registrable: false, jobsDetected: 0 });
    expect(await importCareerUrl(db, { url: "https://acme.ca/empty", employerName: "Acme", now: now() }, { transport })).toMatchObject({ ok: false });

    const r = await importCareerUrl(db, { url: "https://acme.ca/careers", employerName: null, now: now() }, { transport });
    expect(r.ok).toBe(true);
    expect(await db.employerBoard.findFirstOrThrow({ include: { company: true } })).toMatchObject({ provider: "company_site", employerName: "Acme Robotics", company: { domain: "acme.ca" } });
    for (const bad of ["http://localhost:3000/careers", "https://10.0.0.1/careers", "ftp://acme.ca/careers"]) {
      expect((await previewCareerUrl(db, bad, { transport })).ok, bad).toBe(false);
    }
  });
});

describe("candidate prioritisation", () => {
  it("claims company-domain careers pages, then Workday, then retries, then generic pages, then the rest", async () => {
    const mk = (provider: AtsProvider, token: string, source: "search" | "company_domain", attempts = 0) =>
      db.discoveryCandidate.create({ data: { provider, boardToken: token, boardUrl: `https://${token}`, discoveredUrl: `https://${token}`, source, attempts, firstDiscoveredAt: now(), lastDiscoveredAt: now() } });
    await mk("greenhouse", "first", "search");
    await mk("company_site", "acme.ca/careers", "search");
    await mk("lever", "retry", "search", 1);
    await mk("workday", "acme.wd3/external", "search");
    await mk("company_site", "known.ca/careers", "company_domain");
    const ids = await claimCandidates(db, { limit: 5, now: now(), leaseMs: 60_000 });
    const order = await Promise.all(ids.map((id) => db.discoveryCandidate.findUniqueOrThrow({ where: { id } }).then((c) => c.boardToken)));
    expect(order).toEqual(["known.ca/careers", "acme.wd3/external", "retry", "acme.ca/careers", "first"]);
  });
});
