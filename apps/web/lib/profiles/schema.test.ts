import { describe, expect, it } from "vitest";
import { DEMO_SEARCH_PROFILES } from "../fixtures/profiles";
import { draftFromProfile, emptyProfileDraft } from "./draft";
import { parseProfileDraft } from "./schema";

const valid = () => draftFromProfile(DEMO_SEARCH_PROFILES[0]);

describe("parseProfileDraft (server-side validation)", () => {
  it("accepts every demo profile unchanged", () => {
    for (const p of DEMO_SEARCH_PROFILES) {
      const result = parseProfileDraft(draftFromProfile(p));
      expect(result).toEqual({ ok: true, draft: draftFromProfile(p) });
    }
  });

  it("rejects unknown criteria instead of dropping them", () => {
    const input = { ...valid(), criteria: { ...valid().criteria, salaryMin: 90000 } };
    const result = parseProfileDraft(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.formErrors.join(" ")).toMatch(/Unsupported setting in criteria: salaryMin/);
  });

  it("rejects unknown top-level fields, including attempts to set server-owned ones", () => {
    for (const extra of [{ id: "x" }, { version: 99 }, { isDemo: true }, { archivedAt: null }]) {
      const result = parseProfileDraft({ ...valid(), ...extra });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects unsupported enum values", () => {
    const result = parseProfileDraft({ ...valid(), criteria: { ...valid().criteria, provinces: ["ON", "CA"] } });
    expect(result.ok).toBe(false);
    const mode = parseProfileDraft({ ...valid(), automationMode: "auto_submit" });
    expect(mode.ok).toBe(false);
  });

  it("rejects missing fields and wrong types", () => {
    const { criteria, ...withoutCriteria } = valid();
    void criteria;
    expect(parseProfileDraft(withoutCriteria).ok).toBe(false);
    expect(parseProfileDraft({ ...valid(), minFitScore: "70" }).ok).toBe(false);
    expect(parseProfileDraft(null).ok).toBe(false);
  });

  it("normalises keyword lists and enum duplicates", () => {
    const input = valid();
    input.criteria.titleKeywords = ["  Software ", "software", "", "  data   engineer "];
    input.criteria.provinces = ["ON", "ON", "QC"];
    const result = parseProfileDraft(input);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.criteria.titleKeywords).toEqual(["Software", "data engineer"]);
      expect(result.draft.criteria.provinces).toEqual(["ON", "QC"]);
    }
  });

  it("applies the shared semantic rules", () => {
    const result = parseProfileDraft(emptyProfileDraft());
    expect(result).toMatchObject({ ok: false, fieldErrors: { name: expect.any(String), jobTypes: expect.any(String) } });

    const input = valid();
    input.criteria.includeKeywords = ["rust"];
    input.criteria.excludeKeywords = ["Rust"];
    input.minFitScore = 150;
    const conflict = parseProfileDraft(input);
    expect(conflict).toMatchObject({
      ok: false,
      fieldErrors: { includeKeywords: expect.stringMatching(/both preferred and excluded/), minFitScore: expect.any(String) },
    });
  });

  it("enforces size limits", () => {
    const input = valid();
    input.criteria.excludeKeywords = Array.from({ length: 51 }, (_, i) => `k${i}`);
    input.description = "x".repeat(501);
    const result = parseProfileDraft(input);
    expect(result).toMatchObject({ ok: false, fieldErrors: { excludeKeywords: expect.any(String), description: expect.any(String) } });
  });
});
