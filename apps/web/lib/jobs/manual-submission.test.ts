import { describe, expect, it } from "vitest";
import {
  EMPTY_MANUAL_SUBMISSION,
  validateManualSubmission,
  type ManualSubmissionInput,
} from "./manual-submission";

const valid: ManualSubmissionInput = {
  ...EMPTY_MANUAL_SUBMISSION,
  jobUrl: "https://careers.example/acme/123",
  company: "  Acme Demo  ",
  title: "Software Developer Co-op",
  jobType: "co_op",
  durationMonths: "4",
  mode: "quick_apply",
};

describe("validateManualSubmission", () => {
  it("accepts a valid submission and trims values", () => {
    const result = validateManualSubmission(valid);
    expect(result).toEqual({
      ok: true,
      value: {
        jobUrl: "https://careers.example/acme/123",
        description: null,
        company: "Acme Demo",
        title: "Software Developer Co-op",
        location: null,
        jobType: "co_op",
        durationMonths: 4,
        mode: "quick_apply",
      },
    });
  });

  it("requires a URL or description", () => {
    const result = validateManualSubmission({ ...valid, jobUrl: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.jobUrl).toMatch(/URL, a job description/);
  });

  it("accepts a description without a URL", () => {
    const result = validateManualSubmission({ ...valid, jobUrl: "", description: "x".repeat(60) });
    expect(result.ok).toBe(true);
  });

  it("rejects non-http URLs", () => {
    for (const jobUrl of ["careers.example/job", "javascript:alert(1)", "ftp://host/x"]) {
      const result = validateManualSubmission({ ...valid, jobUrl });
      expect(result.ok).toBe(false);
    }
  });

  it("rejects too-short descriptions", () => {
    const result = validateManualSubmission({ ...valid, description: "too short" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.description).toBeDefined();
  });

  it("requires company, title, employment type, and mode", () => {
    const result = validateManualSubmission({
      ...valid,
      company: " ",
      title: "",
      jobType: "",
      mode: "auto_submit",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(["company", "jobType", "mode", "title"]);
    }
  });

  it("treats duration as optional but validates it when present", () => {
    expect(validateManualSubmission({ ...valid, durationMonths: "" }).ok).toBe(true);
    for (const durationMonths of ["0", "4.5", "abc", "36"]) {
      expect(validateManualSubmission({ ...valid, durationMonths }).ok).toBe(false);
    }
  });
});
