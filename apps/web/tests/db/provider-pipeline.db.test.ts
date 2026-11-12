/**
 * Milestone 3B provider integration: the REAL adapters for all four providers,
 * fed recorded-shape (fictional) paginated responses through the in-memory
 * transport, run by the background worker into PostgreSQL — then checked for
 * pagination, Canadian filtering, normalization and profile matching.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeTransport } from "@/lib/ats/__fixtures__/transport";
import { DEFAULT_WORKER_CONFIG } from "@/lib/ats/schedule";
import { drainDueBoards } from "@/lib/ats/worker";
import { LEVER_PAGE_SIZE } from "@/lib/ats/providers/lever";
import { SR_PAGE_SIZE } from "@/lib/ats/providers/smartrecruiters";
import { createTestPrisma, truncateAll } from "./helpers";

const db = createTestPrisma();
afterAll(() => db.$disconnect());
const now = () => new Date("2030-01-01T12:00:00Z");

const DESC = "<p>FICTIONAL recorded response. A 4-month co-op building backend services.</p><ul><li>TypeScript</li><li>PostgreSQL</li></ul>";

// Greenhouse: one unpaginated list; one Canadian co-op, one US role.
const GH = {
  "https://boards-api.greenhouse.io/v1/boards/pipe-gh/jobs?content=true": {
    jobs: [
      { id: 9001, title: "Software Developer Co-op (Summer 2027)", absolute_url: "https://job-boards.greenhouse.io/pipe-gh/jobs/9001", location: { name: "Toronto, ON" }, content: DESC.replace(/</g, "&lt;").replace(/>/g, "&gt;") },
      { id: 9002, title: "Software Engineering Intern", absolute_url: "https://job-boards.greenhouse.io/pipe-gh/jobs/9002", location: { name: "Austin, TX" }, content: "" },
    ],
    meta: { total: 2 },
  },
};

// Lever: two pages (100 US filler postings, then a Canadian co-op).
const leverUrl = (p: number) => `https://api.lever.co/v0/postings/pipe-lever?mode=json&skip=${p * LEVER_PAGE_SIZE}&limit=${LEVER_PAGE_SIZE}`;
const LEVER = {
  [leverUrl(0)]: Array.from({ length: LEVER_PAGE_SIZE }, (_, i) => ({ id: `us-${i}`, text: `Sales Associate ${i}`, hostedUrl: `https://jobs.lever.co/pipe-lever/us-${i}`, categories: { location: "Denver, CO" }, country: "US" })),
  [leverUrl(1)]: [
    { id: "ca-1", text: "Backend Developer Co-op", hostedUrl: "https://jobs.lever.co/pipe-lever/ca-1", categories: { location: "Waterloo, ON", commitment: "Co-op" }, country: "CA", workplaceType: "hybrid", description: DESC },
  ],
};

// Ashby: remote-in-Canada internship.
const ASHBY = {
  "https://api.ashbyhq.com/posting-api/job-board/pipe-ashby?includeCompensation=false": {
    jobs: [
      { id: "a-1", title: "Software Engineering Intern (Fall 2027)", jobUrl: "https://jobs.ashbyhq.com/pipe-ashby/a-1", location: "Canada", isRemote: true, workplaceType: "Remote", isListed: true, descriptionPlain: "FICTIONAL. A 4-month internship.\n\n - TypeScript\n - PostgreSQL" },
    ],
  },
};

// SmartRecruiters: two list pages + detail for the Canadian posting only.
const srBase = "https://api.smartrecruiters.com/v1/companies/pipe-sr/postings";
const SR = {
  [`${srBase}?limit=${SR_PAGE_SIZE}&offset=0`]: { totalFound: SR_PAGE_SIZE + 1, content: Array.from({ length: SR_PAGE_SIZE }, (_, i) => ({ id: `${800000 + i}`, name: `Warehouse Associate ${i}`, location: { city: "Austin", region: "TX", country: "us" } })) },
  [`${srBase}?limit=${SR_PAGE_SIZE}&offset=${SR_PAGE_SIZE}`]: { totalFound: SR_PAGE_SIZE + 1, content: [{ id: "899999", name: "Junior Software Developer", location: { city: "Montréal", region: "QC", country: "ca", hybrid: true }, releasedDate: "2029-12-30T10:00:00.000Z" }] },
  [`${srBase}/899999`]: { postingUrl: "https://jobs.smartrecruiters.com/PipeSR/899999", jobAd: { sections: { jobDescription: { title: "Responsibilities", text: DESC } } } },
};

beforeAll(async () => {
  await truncateAll(db);
  for (const [provider, token] of [["greenhouse", "pipe-gh"], ["lever", "pipe-lever"], ["ashby", "pipe-ashby"], ["smartrecruiters", "pipe-sr"]] as const) {
    await db.employerBoard.create({ data: { provider, employerName: `Pipe ${provider}`, boardToken: token, boardUrl: `https://example.com/${token}`, nextSyncAt: now() } });
  }
  await db.searchProfile.create({
    data: { id: "profile-any-entry", name: "Any entry-level", criteria: { create: {} }, versions: { create: { version: 1, snapshot: {} } } },
  });
});

describe("all four providers through the scheduled pipeline", () => {
  it("pages fully, keeps only Canadian entry-level roles, persists and evaluates them", async () => {
    const { transport, requested } = fakeTransport({ ...GH, ...LEVER, ...ASHBY, ...SR });
    const results = await drainDueBoards({ prisma: db, transport, config: DEFAULT_WORKER_CONFIG, owner: "pipeline", log: () => undefined, now });

    expect(results).toHaveLength(4);
    for (const r of results) expect(r).toMatchObject({ status: "succeeded", complete: true, created: 1, errorCount: 0, trigger: "scheduled" });
    expect(Object.fromEntries(results.map((r) => [r.fetched, r.skipped]))).toEqual({ 2: 1, 101: 100, 1: 0 });
    // Pagination: both Lever pages and both SmartRecruiters pages, details only for Canada.
    expect(requested).toEqual(expect.arrayContaining([leverUrl(0), leverUrl(1), `${srBase}?limit=${SR_PAGE_SIZE}&offset=${SR_PAGE_SIZE}`, `${srBase}/899999`]));
    expect(requested.filter((u) => /postings\/800\d{3}$/.test(u))).toHaveLength(0); // no detail fetches for US postings

    const jobs = await db.jobPosting.findMany({ include: { locations: true, observations: true }, orderBy: { title: "asc" } });
    expect(jobs.map((j) => [j.title, j.jobType, j.locations[0]?.province ?? "remote"])).toEqual([
      ["Backend Developer Co-op", "co_op", "ON"],
      ["Junior Software Developer", "junior", "QC"],
      ["Software Developer Co-op (Summer 2027)", "co_op", "ON"],
      ["Software Engineering Intern (Fall 2027)", "internship", "remote"],
    ]);
    for (const j of jobs) {
      expect(j.origin).toBe("automatic");
      expect(j.description?.length).toBeGreaterThan(10);
      expect(j.observations[0]).toMatchObject({ closedAt: null, missingCount: 0 });
      expect(j.observations[0].contentHash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Matching ran for every imported job.
    expect(await db.jobProfileEvaluation.count()).toBe(4);
    // Each board is rescheduled ~6 h out and its lease released.
    const boards = await db.employerBoard.findMany();
    for (const b of boards) {
      expect(b.syncLeaseOwner).toBeNull();
      expect((b.nextSyncAt!.getTime() - now().getTime()) / 3_600_000).toBeGreaterThan(5);
    }
  });
});
