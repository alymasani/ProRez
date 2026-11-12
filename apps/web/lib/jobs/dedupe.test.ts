import { describe, expect, it } from "vitest";
import { DEMO_JOB_PROFILE_MATCHES } from "../fixtures/profiles";
import { DEMO_JOBS } from "../fixtures/jobs";
import { buildDedupeKey, slugify } from "./dedupe";

describe("slugify", () => {
  it("lowercases, strips accents and punctuation", () => {
    expect(slugify("Software Engineering Intern, Embedded Systems")).toBe(
      "software-engineering-intern-embedded-systems",
    );
    expect(slugify("Montréal QC")).toBe("montreal-qc");
    expect(slugify("Junior Software Engineer (New Grad)")).toBe("junior-software-engineer-new-grad");
    expect(slugify("Cedar & Pine")).toBe("cedar-and-pine");
  });
});

describe("buildDedupeKey", () => {
  it("is insensitive to case, spacing and accents so syndicated copies merge", () => {
    const a = buildDedupeKey("Glacier Labs", "Machine Learning Intern", {
      city: "Montréal",
      province: "QC",
      arrangement: "hybrid",
    });
    const b = buildDedupeKey("  glacier labs ", "MACHINE LEARNING INTERN", {
      city: "Montreal",
      province: "QC",
      arrangement: "onsite",
    });
    expect(a).toBe(b);
    expect(a).toBe("glacier-labs|machine-learning-intern|montreal-qc");
  });

  it("handles a missing location", () => {
    expect(buildDedupeKey("Acme", "Dev", null)).toBe("acme|dev|unspecified");
  });

  it("rejects blank company or title", () => {
    expect(() => buildDedupeKey("", "Dev", null)).toThrow();
    expect(() => buildDedupeKey("Acme", " ", null)).toThrow();
  });

  it("matches the keys recorded in the demo profile-match fixtures", () => {
    for (const match of DEMO_JOB_PROFILE_MATCHES) {
      const job = DEMO_JOBS.find((j) => j.id === match.jobId)!;
      expect(buildDedupeKey(job.company, job.title, job.locations[0] ?? null)).toBe(match.dedupeKey);
    }
  });

  it("gives every demo job a distinct key", () => {
    const keys = DEMO_JOBS.map((j) => buildDedupeKey(j.company, j.title, j.locations[0] ?? null));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
