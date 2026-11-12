import { describe, expect, it } from "vitest";
import { DEMO_JOBS } from "../fixtures/jobs";
import { DEMO_EVALUATED_AT, DEMO_SEARCH_PROFILES } from "../fixtures/profiles";
import { buildDedupeKey } from "../jobs/dedupe";
import type { JobPosting, ProfileCriteria, SearchProfile } from "../types";
import { evaluateJob, evaluateJobForProfile, type CriterionId } from "./engine";
import { extractExperienceRequirement } from "./experience";
import { checkLocation } from "./location";

// --- builders -------------------------------------------------------------

const NO_CRITERIA: ProfileCriteria = {
  titleKeywords: [],
  excludedTitleKeywords: [],
  includeKeywords: [],
  excludeKeywords: [],
  disciplines: [],
  jobTypes: [],
  durations: [],
  provinces: [],
  arrangements: [],
  includeRemoteCanadaWide: true,
  experienceLevels: [],
  maxYearsExperience: null,
};

function profile(id: string, criteria: Partial<ProfileCriteria> = {}, extra: Partial<SearchProfile> = {}): SearchProfile {
  return {
    id,
    version: 3,
    archivedAt: null,
    name: id,
    description: "",
    enabled: true,
    criteria: { ...NO_CRITERIA, ...criteria },
    minFitScore: 70,
    notifications: { enabled: true, channel: "telegram", cadence: "immediate" },
    automationMode: "approval_required",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    isDemo: false,
    ...extra,
  };
}

function job(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    id: "j1",
    sourceId: "s",
    externalId: null,
    company: "Acme",
    title: "Software Developer Co-op",
    locations: [{ city: "Toronto", province: "ON", arrangement: "hybrid" }],
    jobType: "co_op",
    durationMonths: 4,
    term: null,
    disciplines: ["backend"],
    summary: "Build APIs with automated tests.",
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
    isDemo: false,
    ...overrides,
  };
}

const checkOf = (j: JobPosting, p: SearchProfile, criterion: CriterionId) =>
  evaluateJobForProfile(j, p).checks.find((c) => c.criterion === criterion)!;

// --- duration --------------------------------------------------------------

describe("duration matching", () => {
  const fourMonth = profile("p", { jobTypes: ["co_op", "internship"], durations: ["4"] });

  it("passes a four-month co-op and fails an eight-month one", () => {
    expect(checkOf(job({ durationMonths: 4 }), fourMonth, "duration").result).toBe("pass");
    expect(checkOf(job({ durationMonths: 8 }), fourMonth, "duration").result).toBe("fail");
    expect(evaluateJobForProfile(job({ durationMonths: 8 }), fourMonth).outcome).toBe("ineligible");
  });

  it("treats a missing duration as needs-review, not as a pass", () => {
    const result = evaluateJobForProfile(job({ durationMonths: null }), fourMonth);
    expect(checkOf(job({ durationMonths: null }), fourMonth, "duration").result).toBe("unknown");
    expect(result.outcome).toBe("needs_review");
    expect(result.reasons.join(" ")).toMatch(/Duration not stated/);
  });

  it("accepts a missing duration when the profile explicitly allows 'unspecified'", () => {
    const p = profile("p", { durations: ["4", "unspecified"] });
    expect(evaluateJobForProfile(job({ durationMonths: null }), p).outcome).toBe("eligible");
  });

  it("does not apply durations to new-grad or junior roles", () => {
    for (const jobType of ["new_grad", "junior"] as const) {
      expect(checkOf(job({ jobType, durationMonths: null }), fourMonth, "duration").result).toBe("not_applicable");
    }
  });
});

// --- role and employment type ---------------------------------------------

describe("role and employment-type eligibility", () => {
  it("requires a selected employment type", () => {
    const p = profile("p", { jobTypes: ["new_grad"] });
    expect(evaluateJobForProfile(job({ jobType: "co_op" }), p).outcome).toBe("ineligible");
    expect(evaluateJobForProfile(job({ jobType: "new_grad", title: "Software Engineer" }), p).outcome).toBe("eligible");
  });

  it("matches target titles as whole phrases (intern ≠ internal)", () => {
    const p = profile("p", { titleKeywords: ["intern"] });
    expect(checkOf(job({ title: "Software Intern" }), p, "title_keywords").result).toBe("pass");
    expect(checkOf(job({ title: "Internal Tools Developer" }), p, "title_keywords").result).toBe("fail");
  });

  it("excludes titles and postings containing excluded terms", () => {
    const p = profile("p", { excludedTitleKeywords: ["senior"], excludeKeywords: ["security clearance"] });
    expect(evaluateJobForProfile(job({ title: "Senior Developer" }), p).outcome).toBe("ineligible");
    expect(
      evaluateJobForProfile(job({ qualifications: ["Must hold a valid Security Clearance"] }), p).outcome,
    ).toBe("ineligible");
  });

  it("maps job types to experience levels", () => {
    const students = profile("p", { experienceLevels: ["student"] });
    expect(checkOf(job({ jobType: "internship" }), students, "experience_level").result).toBe("pass");
    expect(checkOf(job({ jobType: "junior" }), students, "experience_level").result).toBe("fail");
  });

  it("requires a shared discipline, and flags unknown disciplines for review", () => {
    const p = profile("p", { disciplines: ["frontend"] });
    expect(evaluateJobForProfile(job({ disciplines: ["backend"] }), p).outcome).toBe("ineligible");
    expect(evaluateJobForProfile(job({ disciplines: [] }), p).outcome).toBe("needs_review");
  });
});

// --- location ---------------------------------------------------------------

describe("Canadian location matching", () => {
  const loc = (city: string, province: "ON" | "BC" | "AB" | "QC", arrangement: "onsite" | "hybrid" | "remote") => ({
    city,
    province,
    arrangement,
  });

  it("passes when any location satisfies province and arrangement", () => {
    const r = checkLocation([loc("Calgary", "AB", "onsite"), loc("Toronto", "ON", "hybrid")], {
      provinces: ["ON"],
      arrangements: ["hybrid"],
      includeRemoteCanadaWide: false,
    });
    expect(r.result).toBe("pass");
    expect(r.matched?.city).toBe("Toronto");
  });

  it("accepts remote roles anywhere in Canada only when enabled", () => {
    const locations = [loc("Edmonton", "AB", "remote")];
    expect(checkLocation(locations, { provinces: ["ON"], arrangements: [], includeRemoteCanadaWide: true }).result).toBe(
      "pass",
    );
    expect(checkLocation(locations, { provinces: ["ON"], arrangements: [], includeRemoteCanadaWide: false }).result).toBe(
      "fail",
    );
  });

  it("does not let remote-anywhere override an arrangement restriction", () => {
    const r = checkLocation([loc("Edmonton", "AB", "remote")], {
      provinces: ["ON"],
      arrangements: ["onsite"],
      includeRemoteCanadaWide: true,
    });
    expect(r.result).toBe("fail");
  });

  it("is not applicable with no location constraints, and unknown with no job locations", () => {
    expect(checkLocation([], { provinces: [], arrangements: [], includeRemoteCanadaWide: true }).result).toBe(
      "not_applicable",
    );
    expect(checkLocation([], { provinces: ["ON"], arrangements: [], includeRemoteCanadaWide: true }).result).toBe("unknown");
  });
});

// --- experience -------------------------------------------------------------

describe("experience requirements", () => {
  it("extracts ranges, single values and number words", () => {
    expect(extractExperienceRequirement(["2-4 years of experience"])).toMatchObject({ minYears: 2, maxYearsMentioned: 2 });
    expect(extractExperienceRequirement(["3+ years with Go"])).toMatchObject({ minYears: 3, ambiguous: false });
    expect(extractExperienceRequirement(["at least two years"])).toMatchObject({ minYears: 2 });
    expect(extractExperienceRequirement(["No prior experience required"])).toMatchObject({
      minYears: 0,
      source: "entry_level_language",
    });
    expect(extractExperienceRequirement(["A 4-month term in 2027"])).toMatchObject({ minYears: null, source: "not_stated" });
  });

  it("flags several different requirements as ambiguous", () => {
    expect(extractExperienceRequirement(["0–2 years required; 5 years preferred"])).toMatchObject({
      minYears: 0,
      maxYearsMentioned: 5,
      ambiguous: true,
    });
  });

  const junior = profile("p", { maxYearsExperience: 2 });

  it("passes within the limit and fails above it", () => {
    expect(checkOf(job({ jobType: "junior", qualifications: ["1-2 years"] }), junior, "years_experience").result).toBe("pass");
    expect(checkOf(job({ jobType: "junior", qualifications: ["3+ years"] }), junior, "years_experience").result).toBe("fail");
  });

  it("needs review when the stated range is ambiguous across the limit", () => {
    const j = job({ jobType: "junior", qualifications: ["1 year required, 4 years preferred"] });
    expect(checkOf(j, junior, "years_experience").result).toBe("unknown");
    expect(evaluateJobForProfile(j, junior).outcome).toBe("needs_review");
  });

  it("assumes entry level only for intern/co-op/new-grad roles when nothing is stated", () => {
    expect(checkOf(job({ jobType: "new_grad", qualifications: [] }), junior, "years_experience").result).toBe("pass");
    expect(checkOf(job({ jobType: "junior", qualifications: [] }), junior, "years_experience").result).toBe("unknown");
  });
});

// --- soft relevance ----------------------------------------------------------

describe("soft relevance signals", () => {
  it("affect relevance but never eligibility", () => {
    const p = profile("p", { includeKeywords: ["kubernetes", "automated tests"] });
    const with1 = evaluateJobForProfile(job(), p);
    const with0 = evaluateJobForProfile(job({ summary: "Nothing relevant" }), p);
    expect(with1.outcome).toBe("eligible");
    expect(with0.outcome).toBe("eligible");
    expect(with1.relevance).toBe(50);
    expect(with0.relevance).toBe(0);
  });

  it("is null when the profile has no soft signals", () => {
    expect(evaluateJobForProfile(job(), profile("p")).relevance).toBeNull();
  });
});

// --- multiple profiles -------------------------------------------------------

describe("multiple-profile evaluation", () => {
  const coop = profile("coop", { jobTypes: ["co_op"], durations: ["4"], includeKeywords: ["automated tests"] });
  const any = profile("any");
  const grad = profile("grad", { jobTypes: ["new_grad"] });
  const off = profile("off", {}, { enabled: false });
  const archived = profile("archived", {}, { archivedAt: "2026-02-01T00:00:00Z" });

  it("produces one canonical result listing every matching active profile", () => {
    const result = evaluateJob(job(), "key", [any, coop, grad, off, archived], "2026-11-11T00:00:00Z");
    expect(result.profiles.map((p) => p.profileId)).toEqual(["any", "coop", "grad"]);
    expect(result.matches.map((m) => [m.profileId, m.rank])).toEqual([
      ["coop", 0], // higher relevance
      ["any", 1],
    ]);
    expect(result.matches[0]).toMatchObject({ profileVersion: 3, status: "eligible", relevance: 100 });
  });

  it("ranks eligible profiles above needs-review ones", () => {
    const strict = profile("strict", { durations: ["4"] });
    const result = evaluateJob(job({ durationMonths: null }), "key", [strict, any], "t");
    expect(result.matches.map((m) => [m.profileId, m.status])).toEqual([
      ["any", "eligible"],
      ["strict", "needs_review"],
    ]);
  });

  it("skips dismissed and expired jobs entirely", () => {
    for (const discoveryStatus of ["dismissed", "expired"] as const) {
      const result = evaluateJob(job({ discoveryStatus }), "key", [any], "t");
      expect(result).toMatchObject({ skipped: "inactive", matches: [] });
    }
  });

  it("is deterministic", () => {
    const a = evaluateJob(job(), "key", [any, coop], "t");
    const b = evaluateJob(job(), "key", [any, coop], "t");
    expect(a).toEqual(b);
  });
});

// --- demo data scenarios -------------------------------------------------------

describe("demo profiles against demo jobs", () => {
  const byId = (id: string) => DEMO_JOBS.find((j) => j.id === id)!;
  const run = (id: string) => {
    const j = byId(id);
    return evaluateJob(j, buildDedupeKey(j.company, j.title, j.locations[0] ?? null), DEMO_SEARCH_PROFILES, DEMO_EVALUATED_AT);
  };
  const statuses = (id: string) => Object.fromEntries(run(id).matches.map((m) => [m.profileId, m.status]));

  it("four-month co-op profile accepts a four-month Ontario co-op", () => {
    expect(statuses("job-007")).toEqual({ "profile-coop-4mo": "eligible" });
  });

  it("flags a co-op with no stated duration for review", () => {
    expect(statuses("job-002")).toEqual({ "profile-coop-4mo": "needs_review" });
  });

  it("matches a junior role within the experience limit to the junior profile only", () => {
    expect(statuses("job-010")).toEqual({ "profile-junior": "eligible" });
  });

  it("flags a new-grad role with mixed experience requirements for review", () => {
    // The junior profile is excluded by location: job-015 is on-site and the profile wants hybrid/remote.
    expect(statuses("job-015")).toEqual({ "profile-new-grad": "needs_review" });
    const junior = run("job-015").profiles.find((p) => p.profileId === "profile-junior")!;
    expect(junior.outcome).toBe("ineligible");
    expect(junior.reasons.join(" ")).toMatch(/No acceptable location/);
  });

  it("ignores the disabled embedded profile", () => {
    expect(run("job-017").matches).toEqual([]);
  });
});
