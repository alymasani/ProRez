/**
 * Milestone 3A: board synchronization against a real PostgreSQL database.
 * Provider responses are synthetic (no network): either a fake adapter or the
 * in-memory transport.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { fakeTransport } from "@/lib/ats/__fixtures__/transport";
import { AtsError } from "@/lib/ats/http";
import { syncBoard } from "@/lib/ats/sync";
import type { AtsAdapter, ProviderPosting } from "@/lib/ats/types";
import { createManualJob, changeDiscoveryStatus, updateJobNotes } from "@/lib/jobs/service";
import { createApplication } from "@/lib/applications/service";
import { parseJobUrl } from "@/lib/jobs/url";
import { createPrismaRepository } from "@/lib/repositories/prisma-repository";
import { createTestPrisma, truncateAll } from "./helpers";

const db = createTestPrisma();
afterAll(() => db.$disconnect());

let clock = new Date("2026-11-12T10:00:00Z");
const now = () => new Date(clock);
const tick = (minutes: number) => (clock = new Date(clock.getTime() + minutes * 60_000));

const posting = (id: string, over: Partial<ProviderPosting> = {}): ProviderPosting => ({
  postingId: id,
  title: "Software Developer Co-op",
  url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
  descriptionText: "A 4-month co-op building backend services in Toronto.",
  locationTexts: ["Toronto, ON"],
  structuredLocations: [],
  workplace: "hybrid",
  employmentType: null,
  department: "Engineering",
  publishedAt: null,
  publishedAtKind: "none",
  metadata: { source: "test" },
  ...over,
});

/** Adapter whose responses the test controls between syncs. */
function scriptedAdapter() {
  const state: { postings: ProviderPosting[]; error: AtsError | null; warnings: string[]; incomplete: string | null } = {
    postings: [],
    error: null,
    warnings: [],
    incomplete: null,
  };
  const adapter: AtsAdapter = {
    provider: "greenhouse",
    documentation: "test",
    async fetchPostings() {
      if (state.error) throw state.error;
      return {
        postings: structuredClone(state.postings),
        warnings: state.warnings,
        requests: 1,
        complete: state.incomplete === null,
        incompleteReason: state.incomplete,
      };
    },
  };
  return { adapter, state };
}

const options = (adapter: AtsAdapter) => ({ transport: fakeTransport({}).transport, adapter, now });
const ok = <T>(r: { ok: true; value: T } | { ok: false; message: string }) => {
  if (!r.ok) throw new Error(r.message);
  return r.value;
};

let boardId: string;
beforeEach(async () => {
  await truncateAll(db);
  clock = new Date("2026-11-12T10:00:00Z");
  boardId = (
    await db.employerBoard.create({
      data: { provider: "greenhouse", employerName: "Acme Robotics", boardToken: "acme", boardUrl: "https://job-boards.greenhouse.io/acme" },
    })
  ).id;
  await db.searchProfile.create({
    data: {
      id: "profile-coop",
      name: "Toronto co-ops",
      criteria: { create: { jobTypes: ["co_op"], durations: ["exactly_4"], provinces: ["ON"] } },
      versions: { create: { version: 1, snapshot: {} } },
    },
  });
});

const jobsFor = (postingId: string) =>
  db.jobPosting.findMany({ where: { observations: { some: { atsPostingId: postingId } } }, include: { observations: true, locations: true } });

describe("initial ingestion", () => {
  it("creates canonical jobs, observations, snapshots, history, evaluations and metrics", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [
      posting("101"),
      posting("102", { title: "Senior Backend Engineer" }),
      posting("103", { locationTexts: ["Austin, TX"] }),
    ];
    const summary = ok(await syncBoard(db, boardId, options(adapter)));
    expect(summary).toMatchObject({ status: "succeeded", fetched: 3, created: 1, skipped: 2, errorCount: 0 });

    const [job] = await jobsFor("101");
    expect(job).toMatchObject({ origin: "automatic", discoveryStatus: "discovered", company: "Acme Robotics", jobType: "co_op", durationMonths: 4 });
    expect(job.locations[0]).toMatchObject({ city: "Toronto", province: "ON", arrangement: "hybrid" });
    expect(job.observations[0]).toMatchObject({
      sourceId: "src-greenhouse",
      boardId,
      atsProvider: "greenhouse",
      atsBoardToken: "acme",
      atsPostingId: "101",
      externalId: "acme:101",
      firstSeenAt: clock,
      closedAt: null,
    });
    expect(await db.jobDescriptionSnapshot.count({ where: { jobId: job.id, source: "source_import" } })).toBe(1);
    expect(await db.jobEvent.count({ where: { jobId: job.id, type: "created" } })).toBe(1);

    const evaluation = await db.jobProfileEvaluation.findUnique({ where: { jobId: job.id }, include: { matches: true } });
    expect(evaluation?.matches).toMatchObject([{ profileId: "profile-coop", profileVersion: 1, status: "eligible" }]);

    const run = await db.boardSyncRun.findFirstOrThrow({ where: { boardId } });
    expect(run).toMatchObject({ status: "succeeded", fetched: 3, created: 1, skipped: 2 });
    expect((run.details as { kind: string }[]).filter((d) => d.kind === "skipped")).toHaveLength(2);
    const board = await db.employerBoard.findUniqueOrThrow({ where: { id: boardId } });
    expect(board.lastSuccessAt).toEqual(board.lastCheckedAt);
    expect(board.consecutiveFailures).toBe(0);
  });

  it("is idempotent: repeated syncs never duplicate jobs and keep first-seen", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("101"), posting("104", { title: "Junior Developer" })];
    ok(await syncBoard(db, boardId, options(adapter)));
    const firstSeen = (await db.sourceObservation.findFirstOrThrow({ where: { atsPostingId: "101" } })).firstSeenAt;
    tick(60);
    const again = ok(await syncBoard(db, boardId, options(adapter)));
    expect(again).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
    expect(await db.jobPosting.count()).toBe(2);
    expect(await db.sourceObservation.count()).toBe(2);
    const obs = await db.sourceObservation.findFirstOrThrow({ where: { atsPostingId: "101" } });
    expect(obs.firstSeenAt).toEqual(firstSeen);
    expect(obs.lastSeenAt).toEqual(clock);
  });
});

// Audit regression: Greenhouse never reports a workplace type. A posting
// without arrangement words must be stored as "not stated" and must reach a
// remote/hybrid-only profile as needs_review, not be rejected as on-site.
describe("unstated work arrangement", () => {
  it("persists arrangement_stated=false and evaluates it as needs_review", async () => {
    await db.searchProfile.create({
      data: {
        id: "profile-remote",
        name: "Remote or hybrid co-ops",
        criteria: { create: { jobTypes: ["co_op"], durations: ["exactly_4"], arrangements: ["remote", "hybrid"] } },
        versions: { create: { version: 1, snapshot: {} } },
      },
    });
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("105", { workplace: null }), posting("106", { workplace: "onsite", title: "Firmware Developer Co-op" })];
    ok(await syncBoard(db, boardId, options(adapter)));

    const [unstated] = await jobsFor("105");
    expect(unstated.locations[0]).toMatchObject({ city: "Toronto", province: "ON", arrangement: "onsite", arrangementStated: false });
    const [stated] = await jobsFor("106");
    expect(stated.locations[0]).toMatchObject({ arrangement: "onsite", arrangementStated: true });

    const statusFor = async (jobId: string) =>
      (await db.jobProfileEvaluation.findUnique({ where: { jobId }, include: { matches: true } }))?.matches.find((m) => m.profileId === "profile-remote")?.status ?? "no match row";
    expect(await statusFor(unstated.id)).toBe("needs_review");
    expect(await statusFor(stated.id)).not.toBe("needs_review");
    expect(await statusFor(stated.id)).not.toBe("eligible");
  });
});

// Regression: imported descriptions must reach the job page complete. The
// Cohere (Ashby) posting showed only "WHO ARE WE?" although the full text was
// stored; this pins the storage + repository half of that path.
describe("description persistence", () => {
  const LONG = [
    "WHO ARE WE?",
    "",
    "Acme Robotics is a fictional company that builds warehouse robots in Toronto.",
    "",
    "As a Software Developer Co-op, you will:",
    "",
    " - Build fleet services in TypeScript.",
    "",
    " - Write integration tests against PostgreSQL.",
    "",
    "You may be a good fit if you have:",
    " - Experience with Git",
    "Apply at https://example.com/apply.",
    "x".repeat(200),
  ].join("\n");

  it("stores the complete description, an identical immutable snapshot, and returns it unchanged", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("201", { descriptionText: LONG })];
    ok(await syncBoard(db, boardId, options(adapter)));
    const [job] = await jobsFor("201");
    const snapshots = await db.jobDescriptionSnapshot.findMany({ where: { jobId: job.id } });
    expect(job.description).toBe(LONG.trim());
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].content).toBe(job.description);
    // Summary skips the leading heading.
    expect(job.summary).toBe("Acme Robotics is a fictional company that builds warehouse robots in Toronto.");

    const viaRepository = await createPrismaRepository(db).getJobWithMatch(job.id);
    expect(viaRepository?.job.description).toBe(LONG.trim());
    expect(viaRepository?.job.isDemo).toBe(false);
    expect(viaRepository?.job.postingUrl).toBe("https://job-boards.greenhouse.io/acme/jobs/201");
    // Imports never fabricate structured sections.
    expect(viaRepository?.job.responsibilities).toEqual([]);
    expect(viaRepository?.job.qualifications).toEqual([]);
  });

  it("flags missing or incomplete descriptions in the sync run instead of passing silently", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [
      posting("202", { descriptionText: "", title: "Backend Developer Co-op" }),
      posting("203", { descriptionText: "Short teaser.", title: "Frontend Developer Co-op" }),
      posting("204", { descriptionText: LONG, title: "Platform Developer Co-op" }),
    ];
    const summary = ok(await syncBoard(db, boardId, options(adapter)));
    expect(summary).toMatchObject({ created: 3, errorCount: 0 });
    const run = await db.boardSyncRun.findFirstOrThrow({ where: { boardId } });
    const warnings = (run.details as { postingId: string; kind: string; message: string }[]).filter((d) => d.kind === "warning");
    expect(warnings.map((w) => w.postingId).sort()).toEqual(["202", "203"]);
    expect(warnings.find((w) => w.postingId === "202")?.message).toMatch(/did not provide a job description/);
    expect(warnings.find((w) => w.postingId === "203")?.message).toMatch(/may be incomplete/);

    // Unchanged on re-sync: not reported again.
    tick(60);
    const again = ok(await syncBoard(db, boardId, options(adapter)));
    expect(again.unchanged).toBe(3);
    const latest = await db.boardSyncRun.findFirstOrThrow({ where: { boardId }, orderBy: { startedAt: "desc" } });
    expect((latest.details as { kind: string }[]).filter((d) => d.kind === "warning")).toHaveLength(0);
  });
});

describe("updates", () => {
  it("applies provider changes but never overwrites user data or history", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("101")];
    ok(await syncBoard(db, boardId, options(adapter)));
    const [job] = await jobsFor("101");
    ok(await updateJobNotes(db, job.id, "My interview prep notes"));
    ok(await changeDiscoveryStatus(db, job.id, "save", "discovered"));
    const app = ok(await createApplication(db, { jobId: job.id, mode: "quick_apply", notes: "Applied via referral" }));

    tick(30);
    state.postings = [posting("101", { title: "Software Developer Co-op (Winter 2028)", descriptionText: "Now an 8-month co-op in Toronto." })];
    expect(ok(await syncBoard(db, boardId, options(adapter)))).toMatchObject({ updated: 1 });

    const after = await db.jobPosting.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ title: "Software Developer Co-op (Winter 2028)", durationMonths: 8, term: "Winter 2028", notes: "My interview prep notes", discoveryStatus: "saved", version: 2 });
    expect(await db.jobDescriptionSnapshot.count({ where: { jobId: job.id } })).toBe(2);
    expect(await db.application.findUniqueOrThrow({ where: { id: app.id } })).toMatchObject({ notes: "Applied via referral" });
    // Re-evaluated: an 8-month co-op no longer satisfies "exactly 4 months".
    expect(await db.jobProfileMatch.count({ where: { jobId: job.id } })).toBe(0);
    expect(await db.jobEvent.count({ where: { jobId: job.id, type: "evaluation_changed" } })).toBeGreaterThan(0);
  });

  it("matches a job you added manually by its posting id and keeps your details", async () => {
    const url = parseJobUrl("https://job-boards.greenhouse.io/acme/jobs/101?gh_src=newsletter");
    if (!url.ok) throw new Error("bad url");
    const manual = ok(
      await createManualJob(db, {
        url: { original: url.original, canonical: url.canonical, ats: url.ats },
        description: "My own pasted copy of the job description, kept exactly as I entered it.",
        company: "Acme (my name for it)",
        title: "Co-op I found",
        location: { city: "Toronto", province: "ON", arrangement: "onsite" },
        jobType: "co_op",
        durationMonths: 4,
        term: null,
        experienceRequirement: null,
        disciplines: [],
        salary: null,
        notes: "Manual",
      }),
    );
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("101")];
    // The manual job is created on the real clock; the sync must happen after it
    // (first_seen_at <= last_seen_at is a database constraint).
    clock = new Date(Date.now() + 60_000);
    expect(ok(await syncBoard(db, boardId, options(adapter)))).toMatchObject({ created: 0, updated: 1 });
    expect(await db.jobPosting.count()).toBe(1);
    const job = await db.jobPosting.findUniqueOrThrow({ where: { id: manual.job.id }, include: { observations: true } });
    expect(job).toMatchObject({ origin: "manual", title: "Co-op I found", company: "Acme (my name for it)", notes: "Manual" });
    expect(job.observations).toHaveLength(1);
    expect(job.observations[0]).toMatchObject({ boardId, sourceId: "src-manual", atsPostingId: "101" });
  });

  it("records the same role on a second board as another sighting", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("101")];
    ok(await syncBoard(db, boardId, options(adapter)));
    const other = await db.employerBoard.create({
      data: { provider: "lever", employerName: "Acme Robotics", boardToken: "acme", boardUrl: "https://jobs.lever.co/acme" },
    });
    const lever: AtsAdapter = { ...adapter, provider: "lever" };
    state.postings = [posting("00000000-aaaa", { url: "https://jobs.lever.co/acme/00000000-aaaa" })];
    // Milestone 3C accounting: another sighting of a known job is a "duplicate", not an update.
    expect(ok(await syncBoard(db, other.id, options(lever)))).toMatchObject({ created: 0, updated: 0, duplicate: 1, eligible: 1 });
    expect(await db.jobPosting.count()).toBe(1);
    expect(await db.sourceObservation.count()).toBe(2);
  });
});

describe("closing and reopening", () => {
  // Milestone 3B: inactivation needs two consecutive complete snapshots (was one).
  it("closes postings absent from two complete snapshots and reopens them when they return", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("101")];
    ok(await syncBoard(db, boardId, options(adapter)));
    const [job] = await jobsFor("101");

    tick(10);
    state.postings = [];
    expect(ok(await syncBoard(db, boardId, options(adapter)))).toMatchObject({ missing: 1, closed: 0 });
    expect(await db.jobPosting.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ discoveryStatus: "discovered" });
    tick(10);
    expect(ok(await syncBoard(db, boardId, options(adapter)))).toMatchObject({ missing: 1, closed: 1 });
    expect(await db.jobPosting.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ discoveryStatus: "expired" });
    expect(await db.sourceObservation.findFirstOrThrow({ where: { jobId: job.id } })).toMatchObject({ closedAt: clock });

    tick(10);
    state.postings = [posting("101")];
    expect(ok(await syncBoard(db, boardId, options(adapter)))).toMatchObject({ reactivated: 1, created: 0 });
    expect(await db.jobPosting.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ discoveryStatus: "discovered" });
    expect(await db.sourceObservation.findFirstOrThrow({ where: { jobId: job.id } })).toMatchObject({ closedAt: null, missingCount: 0 });
  });

  it("does not expire a job the user dismissed", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("101")];
    ok(await syncBoard(db, boardId, options(adapter)));
    const [job] = await jobsFor("101");
    ok(await changeDiscoveryStatus(db, job.id, "dismiss", "discovered"));
    state.postings = [];
    ok(await syncBoard(db, boardId, options(adapter)));
    tick(10);
    ok(await syncBoard(db, boardId, options(adapter)));
    expect(await db.jobPosting.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ discoveryStatus: "dismissed" });
  });
});

describe("failures, recovery and concurrency", () => {
  it("records a failed sync without touching existing jobs, then recovers", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("101")];
    ok(await syncBoard(db, boardId, options(adapter)));

    state.error = new AtsError("rate_limited", "The provider is rate-limiting requests. Try again later.", 429);
    const failed = ok(await syncBoard(db, boardId, options(adapter)));
    expect(failed).toMatchObject({ status: "failed", errorMessage: expect.stringMatching(/rate-limiting/) });
    expect(await db.employerBoard.findUniqueOrThrow({ where: { id: boardId } })).toMatchObject({ consecutiveFailures: 1, lastErrorMessage: expect.any(String) });
    expect(await db.jobPosting.findFirstOrThrow()).toMatchObject({ discoveryStatus: "discovered" });
    expect(await db.sourceObservation.findFirstOrThrow()).toMatchObject({ closedAt: null });

    state.error = null;
    expect(ok(await syncBoard(db, boardId, options(adapter)))).toMatchObject({ status: "succeeded", unchanged: 1 });
    expect(await db.employerBoard.findUniqueOrThrow({ where: { id: boardId } })).toMatchObject({ consecutiveFailures: 0, lastErrorMessage: null });
    expect(await db.boardSyncRun.count({ where: { boardId, status: "failed" } })).toBe(1);
  });

  it("counts malformed postings as errors without failing the sync", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("101")];
    state.warnings = ["Skipped a Greenhouse job without an id or title."];
    expect(ok(await syncBoard(db, boardId, options(adapter)))).toMatchObject({ status: "succeeded", created: 1, errorCount: 1 });
  });

  it("refuses a concurrent sync of the same board but clears stale runs", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("101")];
    await db.boardSyncRun.create({ data: { boardId, startedAt: clock } });
    const busy = await syncBoard(db, boardId, options(adapter));
    expect(busy).toMatchObject({ ok: false, code: "sync_in_progress" });

    tick(20); // older than STALE_RUN_MS
    expect(ok(await syncBoard(db, boardId, options(adapter)))).toMatchObject({ status: "succeeded" });
    expect(await db.boardSyncRun.findFirstOrThrow({ where: { errorCode: "stale" } })).toMatchObject({ status: "failed" });
  });

  it("allows only one of two simultaneous syncs", async () => {
    const { adapter, state } = scriptedAdapter();
    state.postings = [posting("101")];
    const results = await Promise.all([syncBoard(db, boardId, options(adapter)), syncBoard(db, boardId, options(adapter))]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "sync_in_progress")).toHaveLength(1);
    expect(await db.jobPosting.count()).toBe(1);
  });

  it("refuses disabled boards", async () => {
    await db.employerBoard.update({ where: { id: boardId }, data: { enabled: false } });
    const { adapter } = scriptedAdapter();
    expect(await syncBoard(db, boardId, options(adapter))).toMatchObject({ ok: false, code: "invalid_transition" });
  });

  it("enforces one running run per board at the database level", async () => {
    await db.boardSyncRun.create({ data: { boardId } });
    await expect(db.boardSyncRun.create({ data: { boardId } })).rejects.toThrow();
  });
});

describe("end to end with the real adapter and recorded responses", () => {
  it("syncs a SmartRecruiters board and records first-publication latency", async () => {
    const sr = await db.employerBoard.create({
      data: { provider: "smartrecruiters", employerName: "Maple Co", boardToken: "maple", boardUrl: "https://jobs.smartrecruiters.com/maple" },
    });
    const { transport } = fakeTransport({
      "https://api.smartrecruiters.com/v1/companies/maple/postings?limit=100&offset=0": {
        totalFound: 1,
        content: [
          {
            id: "744000000009",
            name: "Junior Software Developer",
            releasedDate: "2026-11-12T08:00:00.000Z",
            location: { country: "ca", region: "QC", city: "Montréal", remote: false, hybrid: true },
            typeOfEmployment: { label: "Full-time" },
          },
        ],
      },
      "https://api.smartrecruiters.com/v1/companies/maple/postings/744000000009": {
        postingUrl: "https://jobs.smartrecruiters.com/Maple/744000000009-junior-software-developer",
        jobAd: { sections: { jobDescription: { title: "Description", text: "<p>0–2 years of experience.</p>" } } },
      },
    });
    expect(ok(await syncBoard(db, sr.id, { transport, now }))).toMatchObject({ created: 1 });
    const obs = await db.sourceObservation.findFirstOrThrow({ where: { atsProvider: "smartrecruiters" } });
    expect(obs).toMatchObject({ publishedAtKind: "first_published", providerPublishedAt: new Date("2026-11-12T08:00:00Z") });
    expect(clock.getTime() - obs.providerPublishedAt!.getTime()).toBe(2 * 3_600_000);
    const job = await db.jobPosting.findUniqueOrThrow({ where: { id: obs.jobId }, include: { locations: true } });
    expect(job).toMatchObject({ jobType: "junior", postedAt: new Date("2026-11-12T08:00:00Z") });
    expect(job.locations[0]).toMatchObject({ city: "Montréal", province: "QC", arrangement: "hybrid" });
  });
});
