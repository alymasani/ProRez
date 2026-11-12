import { describe, expect, it } from "vitest";
import type { JobPosting, JobWithMatch } from "../types";
import {
  EMPTY_FILTERS,
  countActiveFilters,
  durationBucket,
  filterJobs,
  parseFilters,
  serializeFilters,
  type JobFilters,
} from "./filters";

function makeJob(overrides: Partial<JobPosting> & { id: string }): JobPosting {
  return {
    sourceId: "src-test",
    externalId: null,
    company: "Test Co",
    title: "Software Developer",
    locations: [{ city: "Toronto", province: "ON", arrangement: "hybrid" }],
    jobType: "co_op",
    durationMonths: 4,
    term: null,
    disciplines: ["backend"],
    summary: "",
    responsibilities: [],
    qualifications: [],
    postingUrl: null,
    postedAt: null,
    discoveredAt: "2026-11-01T00:00:00Z",
    discoveryStatus: "discovered",
    origin: "automatic",
    version: 1,
    description: null,
    experienceRequirement: null,
    salary: null,
    notes: "",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    isDemo: true,
    ...overrides,
  };
}

function item(job: JobPosting, fitScore: number | null = null): JobWithMatch {
  return {
    job,
    match:
      fitScore === null
        ? null
        : {
            id: `m-${job.id}`,
            jobId: job.id,
            fitScore,
            matchedSkills: [],
            missingSkills: [],
            reasons: [],
            computedAt: "2026-11-01T00:00:00Z",
            isDemo: true,
          },
  };
}

const withFilters = (overrides: Partial<JobFilters>): JobFilters => ({ ...EMPTY_FILTERS, ...overrides });
const ids = (items: JobWithMatch[]) => items.map((i) => i.job.id);

const JOBS: JobWithMatch[] = [
  item(
    makeJob({
      id: "a",
      company: "Northlight Robotics",
      title: "Embedded Intern",
      jobType: "internship",
      disciplines: ["embedded"],
      locations: [{ city: "Waterloo", province: "ON", arrangement: "onsite" }],
      discoveredAt: "2026-11-10T00:00:00Z",
    }),
    88,
  ),
  item(
    makeJob({
      id: "b",
      company: "Glacier Labs",
      title: "ML Intern",
      jobType: "internship",
      disciplines: ["machine_learning", "data"],
      locations: [{ city: "Montréal", province: "QC", arrangement: "hybrid" }],
      discoveredAt: "2026-11-09T00:00:00Z",
    }),
    64,
  ),
  item(
    makeJob({
      id: "c",
      company: "Quillstone",
      title: "Junior Engineer",
      jobType: "new_grad",
      durationMonths: null,
      locations: [
        { city: "Vancouver", province: "BC", arrangement: "remote" },
        { city: "Toronto", province: "ON", arrangement: "hybrid" },
      ],
      discoveredAt: "2026-11-08T00:00:00Z",
    }),
  ),
  item(
    makeJob({
      id: "d",
      title: "SRE Co-op",
      durationMonths: 12,
      disciplines: ["infrastructure"],
      discoveredAt: "2026-11-07T00:00:00Z",
    }),
    70,
  ),
  item(makeJob({ id: "e", discoveryStatus: "dismissed", discoveredAt: "2026-11-11T00:00:00Z" }), 99),
  item(makeJob({ id: "f", discoveryStatus: "expired", discoveredAt: "2026-11-11T00:00:00Z" }), 50),
];

describe("durationBucket", () => {
  it("buckets month counts", () => {
    expect(durationBucket(null)).toBe("unspecified");
    expect(durationBucket(4)).toBe("4");
    expect(durationBucket(8)).toBe("8");
    expect(durationBucket(12)).toBe("12_plus");
    expect(durationBucket(16)).toBe("12_plus");
  });
});

describe("filterJobs", () => {
  it("hides dismissed and expired jobs by default, newest first", () => {
    expect(ids(filterJobs(JOBS, EMPTY_FILTERS))).toEqual(["a", "b", "c", "d"]);
  });

  it("includes inactive jobs when requested", () => {
    expect(ids(filterJobs(JOBS, withFilters({ includeInactive: true })))).toEqual([
      "e",
      "f",
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("matches every search term across title, company and city, ignoring case and accents", () => {
    expect(ids(filterJobs(JOBS, withFilters({ query: "montreal" })))).toEqual(["b"]);
    expect(ids(filterJobs(JOBS, withFilters({ query: "NORTHLIGHT intern" })))).toEqual(["a"]);
    expect(ids(filterJobs(JOBS, withFilters({ query: "northlight ml" })))).toEqual([]);
    expect(ids(filterJobs(JOBS, withFilters({ query: "   " })))).toHaveLength(4);
  });

  it("filters by province against any of a job's locations", () => {
    expect(ids(filterJobs(JOBS, withFilters({ provinces: ["BC"] })))).toEqual(["c"]);
    expect(ids(filterJobs(JOBS, withFilters({ provinces: ["QC", "BC"] })))).toEqual(["b", "c"]);
  });

  it("filters by work arrangement", () => {
    expect(ids(filterJobs(JOBS, withFilters({ arrangements: ["remote"] })))).toEqual(["c"]);
    expect(ids(filterJobs(JOBS, withFilters({ arrangements: ["onsite"] })))).toEqual(["a"]);
  });

  it("filters by job type", () => {
    expect(ids(filterJobs(JOBS, withFilters({ jobTypes: ["internship"] })))).toEqual(["a", "b"]);
    expect(ids(filterJobs(JOBS, withFilters({ jobTypes: ["new_grad", "co_op"] })))).toEqual(["c", "d"]);
  });

  it("filters by duration bucket, including unspecified", () => {
    expect(ids(filterJobs(JOBS, withFilters({ durations: ["4"] })))).toEqual(["a", "b"]);
    expect(ids(filterJobs(JOBS, withFilters({ durations: ["12_plus", "unspecified"] })))).toEqual([
      "c",
      "d",
    ]);
  });

  it("filters by discipline", () => {
    expect(ids(filterJobs(JOBS, withFilters({ disciplines: ["data"] })))).toEqual(["b"]);
  });

  it("combines facets with AND across groups and OR within a group", () => {
    const filters = withFilters({ jobTypes: ["internship", "co_op"], provinces: ["ON"] });
    expect(ids(filterJobs(JOBS, filters))).toEqual(["a", "d"]);
  });

  it("sorts by fit score with unscored jobs last", () => {
    expect(ids(filterJobs(JOBS, withFilters({ sort: "fit" })))).toEqual(["a", "d", "b", "c"]);
  });

  it("does not mutate its input", () => {
    const copy = [...JOBS];
    filterJobs(JOBS, withFilters({ sort: "fit" }));
    expect(JOBS).toEqual(copy);
  });
});

describe("countActiveFilters", () => {
  it("counts selected facet values but not the query or sort", () => {
    expect(countActiveFilters(EMPTY_FILTERS)).toBe(0);
    expect(
      countActiveFilters(
        withFilters({ query: "x", sort: "fit", provinces: ["ON", "BC"], includeInactive: true }),
      ),
    ).toBe(3);
  });
});

describe("URL serialization", () => {
  it("round-trips filters through search params", () => {
    const filters = withFilters({
      query: "backend",
      provinces: ["ON", "QC"],
      arrangements: ["remote"],
      jobTypes: ["co_op"],
      durations: ["4", "unspecified"],
      disciplines: ["backend"],
      includeInactive: true,
      sort: "fit",
    });
    expect(parseFilters(serializeFilters(filters))).toEqual(filters);
  });

  it("omits defaults so an unfiltered view has a clean URL", () => {
    expect(serializeFilters(EMPTY_FILTERS).toString()).toBe("");
  });

  it("ignores unknown and duplicate values from hand-edited URLs", () => {
    const parsed = parseFilters(
      new URLSearchParams("province=ON,XX,ON&type=bogus&sort=random&inactive=yes"),
    );
    expect(parsed.provinces).toEqual(["ON"]);
    expect(parsed.jobTypes).toEqual([]);
    expect(parsed.sort).toBe("newest");
    expect(parsed.includeInactive).toBe(false);
  });
});
