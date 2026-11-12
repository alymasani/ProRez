/**
 * Milestone 3B: adapters must say whether they returned the WHOLE catalogue.
 * Only a complete snapshot may count absent postings as missing, so every
 * truncation or unreadable item must be reported. Responses are synthetic.
 */
import { describe, expect, it } from "vitest";
import { fakeTransport } from "../__fixtures__/transport";
import { ashbyAdapter } from "./ashby";
import { greenhouseAdapter } from "./greenhouse";
import { LEVER_MAX_PAGES, LEVER_PAGE_SIZE, leverAdapter } from "./lever";
import { SR_MAX_PAGES, SR_PAGE_SIZE, smartRecruitersAdapter } from "./smartrecruiters";

const GH = "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true";
const ASHBY = "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=false";
const lever = (page: number) => `https://api.lever.co/v0/postings/acme?mode=json&skip=${page * LEVER_PAGE_SIZE}&limit=${LEVER_PAGE_SIZE}`;
const sr = (page: number) => `https://api.smartrecruiters.com/v1/companies/acme/postings?limit=${SR_PAGE_SIZE}&offset=${page * SR_PAGE_SIZE}`;

const ghJob = (id: number) => ({ id, title: `Job ${id}`, absolute_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`, location: { name: "Toronto, ON" }, content: "" });
const leverJob = (i: number) => ({ id: `lever-${i}`, text: `Job ${i}`, hostedUrl: `https://jobs.lever.co/acme/lever-${i}`, categories: { location: "Toronto, ON" } });
const srJob = (i: number) => ({ id: `${700000 + i}`, name: `Job ${i}`, location: { city: "Austin", region: "TX", country: "us" } });

describe("Greenhouse completeness", () => {
  it("is complete for a well-formed list (including an empty but valid board)", async () => {
    const full = await greenhouseAdapter.fetchPostings("acme", { transport: fakeTransport({ [GH]: { jobs: [ghJob(1), ghJob(2)], meta: { total: 2 } } }).transport });
    expect(full).toMatchObject({ complete: true, incompleteReason: null });
    const empty = await greenhouseAdapter.fetchPostings("acme", { transport: fakeTransport({ [GH]: { jobs: [], meta: { total: 0 } } }).transport });
    expect(empty).toMatchObject({ complete: true, postings: [] });
  });

  it("is incomplete when an item is unreadable or meta.total disagrees", async () => {
    const malformed = await greenhouseAdapter.fetchPostings("acme", { transport: fakeTransport({ [GH]: { jobs: [ghJob(1), { title: "no id" }] } }).transport });
    expect(malformed).toMatchObject({ complete: false, incompleteReason: expect.stringMatching(/unreadable/) });
    const mismatch = await greenhouseAdapter.fetchPostings("acme", { transport: fakeTransport({ [GH]: { jobs: [ghJob(1)], meta: { total: 5 } } }).transport });
    expect(mismatch).toMatchObject({ complete: false, incompleteReason: expect.stringMatching(/reported 5 jobs but returned 1/) });
  });
});

describe("Lever pagination and completeness", () => {
  it("reads every page until a short page and is complete", async () => {
    const page0 = Array.from({ length: LEVER_PAGE_SIZE }, (_, i) => leverJob(i));
    const page1 = [leverJob(100), leverJob(101)];
    const { transport, requested } = fakeTransport({ [lever(0)]: page0, [lever(1)]: page1 });
    const result = await leverAdapter.fetchPostings("acme", { transport });
    expect(requested).toEqual([lever(0), lever(1)]);
    expect(result).toMatchObject({ complete: true, requests: 2 });
    expect(result.postings).toHaveLength(102);
  });

  it("an exact multiple of the page size ends on an empty page and is complete", async () => {
    const page0 = Array.from({ length: LEVER_PAGE_SIZE }, (_, i) => leverJob(i));
    const result = await leverAdapter.fetchPostings("acme", { transport: fakeTransport({ [lever(0)]: page0, [lever(1)]: [] }).transport });
    expect(result).toMatchObject({ complete: true });
  });

  it("is incomplete (truncated) when it stops at the page cap", async () => {
    const responses: Record<string, unknown> = {};
    for (let p = 0; p < LEVER_MAX_PAGES; p++) responses[lever(p)] = Array.from({ length: LEVER_PAGE_SIZE }, (_, i) => leverJob(p * LEVER_PAGE_SIZE + i));
    const result = await leverAdapter.fetchPostings("acme", { transport: fakeTransport(responses).transport });
    expect(result).toMatchObject({ complete: false, incompleteReason: expect.stringMatching(/later pages were not read/) });
  });
});

describe("Ashby completeness", () => {
  it("is complete for a valid (even empty) board and incomplete with an unreadable job", async () => {
    expect(await ashbyAdapter.fetchPostings("acme", { transport: fakeTransport({ [ASHBY]: { jobs: [] } }).transport })).toMatchObject({ complete: true });
    const bad = await ashbyAdapter.fetchPostings("acme", { transport: fakeTransport({ [ASHBY]: { jobs: [{ id: "x" }, "junk"] } }).transport });
    expect(bad).toMatchObject({ complete: false });
  });

  it("excluding unlisted (direct-link) jobs does not make the snapshot incomplete", async () => {
    const result = await ashbyAdapter.fetchPostings("acme", {
      transport: fakeTransport({ [ASHBY]: { jobs: [{ id: "a1", title: "Hidden", isListed: false }] } }).transport,
    });
    expect(result).toMatchObject({ complete: true, postings: [] });
  });
});

describe("SmartRecruiters pagination and completeness", () => {
  it("pages by offset until totalFound and is complete", async () => {
    const page0 = Array.from({ length: SR_PAGE_SIZE }, (_, i) => srJob(i));
    const { transport, requested } = fakeTransport({
      [sr(0)]: { totalFound: 101, content: page0 },
      [sr(1)]: { totalFound: 101, content: [srJob(100)] },
    });
    const result = await smartRecruitersAdapter.fetchPostings("acme", { transport });
    expect(requested).toEqual([sr(0), sr(1)]);
    expect(result).toMatchObject({ complete: true });
    expect(result.postings).toHaveLength(101);
  });

  it("is incomplete when fewer postings arrive than totalFound (truncated pagination)", async () => {
    const result = await smartRecruitersAdapter.fetchPostings("acme", {
      transport: fakeTransport({ [sr(0)]: { totalFound: 250, content: [srJob(1)] } }).transport,
    });
    expect(result).toMatchObject({ complete: false, incompleteReason: expect.stringMatching(/reported 250 postings but returned 1/) });
  });

  it("is incomplete when the page cap stops the listing", async () => {
    const responses: Record<string, unknown> = {};
    for (let p = 0; p < SR_MAX_PAGES; p++) responses[sr(p)] = { totalFound: 5_000, content: Array.from({ length: SR_PAGE_SIZE }, (_, i) => srJob(p * SR_PAGE_SIZE + i)) };
    const result = await smartRecruitersAdapter.fetchPostings("acme", { transport: fakeTransport(responses).transport });
    expect(result).toMatchObject({ complete: false, incompleteReason: expect.stringMatching(/later pages were not read/) });
  });
});

describe("Lever EU region (Milestone 3C)", () => {
  it("reads EU boards from api.eu.lever.co and US boards from api.lever.co", async () => {
    const eu = `https://api.eu.lever.co/v0/postings/acme?mode=json&skip=0&limit=${LEVER_PAGE_SIZE}`;
    const euRun = fakeTransport({ [eu]: [leverJob(1)] });
    const result = await leverAdapter.fetchPostings("acme", { transport: euRun.transport, region: "eu" });
    expect(euRun.requested).toEqual([eu]);
    expect(result).toMatchObject({ complete: true });
    const usRun = fakeTransport({ [lever(0)]: [leverJob(1)] });
    await leverAdapter.fetchPostings("acme", { transport: usRun.transport });
    expect(usRun.requested).toEqual([lever(0)]);
  });
});

describe("SmartRecruiters description enrichment (Milestone 3C)", () => {
  const caJob = (i: number) => ({ id: `${900000 + i}`, name: `Junior Developer ${i}`, location: { city: "Toronto", region: "ON", country: "ca" } });
  it("enriches postings without stored descriptions first, caps requests, and flags the rest", async () => {
    const jobs = Array.from({ length: 160 }, (_, i) => caJob(i));
    const responses: Record<string, unknown> = {
      [sr(0)]: { totalFound: 160, content: jobs.slice(0, 100) },
      [sr(1)]: { totalFound: 160, content: jobs.slice(100) },
    };
    for (const j of jobs) responses[`https://api.smartrecruiters.com/v1/companies/acme/postings/${j.id}`] = { jobAd: { sections: { jobDescription: { title: "About", text: "<p>Desc</p>" } } } };
    // The first 20 already have stored descriptions.
    const enriched = new Set(jobs.slice(0, 20).map((j) => j.id));
    const { transport, requested } = fakeTransport(responses);
    const result = await smartRecruitersAdapter.fetchPostings("acme", { transport, enrichedPostingIds: enriched });
    const detailCalls = requested.filter((u) => /postings\/9\d{5}$/.test(u));
    expect(detailCalls).toHaveLength(150);
    // All 140 un-enriched postings were fetched; only 10 refreshes fit under the cap.
    for (const j of jobs.slice(20)) expect(detailCalls).toContain(`https://api.smartrecruiters.com/v1/companies/acme/postings/${j.id}`);
    expect(result.enrichmentDeferred).toBe(10);
    expect(result.complete).toBe(true); // enrichment never affects listing completeness
    expect(result.postings.filter((p) => p.descriptionFetched === false)).toHaveLength(10);
    expect(result.warnings).toEqual([]); // a deferred description is not an error
  });
});
