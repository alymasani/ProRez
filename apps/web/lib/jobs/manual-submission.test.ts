import { describe, expect, it } from "vitest";
import { EMPTY_MANUAL_JOB_INPUT, validateManualJob, type ManualJobInput } from "./manual-submission";

const valid: ManualJobInput = { ...EMPTY_MANUAL_JOB_INPUT, jobUrl: "https://careers.example/acme/123", company: "  Acme Demo  ", title: "Software Developer Co-op", jobType: "co_op", durationMonths: "4" };

describe("validateManualJob", () => {
  it("accepts and normalizes a valid submission", () => {
    const result = validateManualJob(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.company).toBe("Acme Demo");
      expect(result.value.durationMonths).toBe(4);
      expect(result.value.url?.canonical).toBe("https://careers.example/acme/123");
    }
  });
  it("requires a URL or description", () => {
    const result = validateManualJob({ ...valid, jobUrl: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.jobUrl).toMatch(/URL.*description/i);
  });
  it("accepts a description without a URL", () => expect(validateManualJob({ ...valid, jobUrl: "", description: "x".repeat(60) }).ok).toBe(true));
  it("rejects descriptions that are too short", () => {
    const result = validateManualJob({ ...valid, description: "too short" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.description).toBeDefined();
  });
  it("requires company, title, and employment type", () => {
    const result = validateManualJob({ ...valid, company: " ", title: "", jobType: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors)).toEqual(expect.arrayContaining(["company", "title", "jobType"]));
  });
  it("rejects unsupported URL schemes", () => {
    for (const jobUrl of ["careers.example/job", "javascript:alert(1)", "ftp://host/x"]) expect(validateManualJob({ ...valid, jobUrl }).ok).toBe(false);
  });
  it("validates duration when present", () => {
    expect(validateManualJob({ ...valid, durationMonths: "" }).ok).toBe(true);
    for (const durationMonths of ["0", "4.5", "abc", "36"]) expect(validateManualJob({ ...valid, durationMonths }).ok).toBe(false);
  });
});
