import { describe, expect, it } from "vitest";
import { DEMO_SEARCH_PROFILES } from "../fixtures/profiles";
import { draftFromProfile, durationApplies, emptyProfileDraft, parseKeywordList, validateProfileDraft } from "./draft";

describe("parseKeywordList", () => {
  it("trims, collapses whitespace, drops empties and case-insensitive duplicates", () => {
    expect(parseKeywordList(" software,  Developer , ,developer,new   grad")).toEqual([
      "software",
      "Developer",
      "new grad",
    ]);
    expect(parseKeywordList("")).toEqual([]);
  });
});

describe("validateProfileDraft", () => {
  it("accepts every demo profile", () => {
    for (const profile of DEMO_SEARCH_PROFILES) {
      expect(validateProfileDraft(draftFromProfile(profile))).toEqual({});
    }
  });

  it("requires a name and at least one employment type", () => {
    const errors = validateProfileDraft(emptyProfileDraft());
    expect(Object.keys(errors).sort()).toEqual(["jobTypes", "name"]);
  });

  it("rejects durations when only new grad roles are targeted", () => {
    const draft = emptyProfileDraft();
    draft.name = "x";
    draft.criteria.jobTypes = ["new_grad"];
    draft.criteria.durations = ["4"];
    expect(durationApplies(draft)).toBe(false);
    expect(validateProfileDraft(draft).durations).toBeDefined();
  });

  it("validates fit score and experience bounds", () => {
    const draft = { ...emptyProfileDraft(), name: "x", minFitScore: 101 };
    draft.criteria = { ...draft.criteria, jobTypes: ["co_op"], maxYearsExperience: -1 };
    const errors = validateProfileDraft(draft);
    expect(errors.minFitScore).toBeDefined();
    expect(errors.maxYearsExperience).toBeDefined();
  });

  it("flags keywords that are both included and excluded", () => {
    const draft = emptyProfileDraft();
    draft.name = "x";
    draft.criteria.jobTypes = ["co_op"];
    draft.criteria.titleKeywords = ["Engineer"];
    draft.criteria.excludedTitleKeywords = ["engineer"];
    expect(validateProfileDraft(draft).titleKeywords).toMatch(/engineer/);
  });

  it("draftFromProfile does not share arrays with the source fixture", () => {
    const source = DEMO_SEARCH_PROFILES[0];
    const draft = draftFromProfile(source);
    draft.criteria.titleKeywords.push("mutated");
    expect(source.criteria.titleKeywords).not.toContain("mutated");
  });
});

describe("demo profile matches", () => {
  it("never has more than one record per job (dedup contract)", async () => {
    const { DEMO_JOB_PROFILE_MATCHES } = await import("../fixtures/profiles");
    const jobIds = DEMO_JOB_PROFILE_MATCHES.map((m) => m.jobId);
    expect(new Set(jobIds).size).toBe(jobIds.length);
    for (const m of DEMO_JOB_PROFILE_MATCHES) {
      expect(m.matchedProfileIds[0]).toBe(m.primaryProfileId);
      expect(m.notifiedAt).toBeNull();
    }
  });
});
