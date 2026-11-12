import { describe, expect, it } from "vitest";
import { discoveryLatencyMs } from "./metrics";
import { normalizePosting } from "./normalize";
import type { ProviderPosting } from "./types";

const posting = (over: Partial<ProviderPosting> = {}): ProviderPosting => ({
  postingId: "1",
  title: "Software Developer Co-op",
  url: "https://jobs.lever.co/acme/1",
  descriptionText: "A 4-month co-op in Toronto.",
  locationTexts: ["Toronto, ON"],
  structuredLocations: [],
  workplace: null,
  employmentType: null,
  department: null,
  publishedAt: null,
  publishedAtKind: "none",
  metadata: {},
  ...over,
});

describe("normalizePosting", () => {
  it("records an inferred work arrangement explicitly", () => {
    const r = normalizePosting(posting(), "Acme");
    expect(r).toMatchObject({ ok: true, job: { locations: [{ arrangement: "onsite" }], notes: { arrangementInferred: true } } });
  });

  it("produces a stable content hash that changes with material fields only", () => {
    const a = normalizePosting(posting(), "Acme");
    const b = normalizePosting(posting({ metadata: { anything: 1 } }), "Acme");
    const c = normalizePosting(posting({ descriptionText: "A 4-month co-op in Toronto. Updated." }), "Acme");
    if (!a.ok || !b.ok || !c.ok) throw new Error("expected ok");
    expect(a.job.contentHash).toBe(b.job.contentHash);
    expect(a.job.contentHash).not.toBe(c.job.contentHash);
  });

  it("leaves ambiguous durations unknown", () => {
    const r = normalizePosting(posting({ descriptionText: "4 or 8 months" }), "Acme");
    expect(r.ok && r.job.durationMonths).toBeNull();
  });

  it("skips with a reason", () => {
    expect(normalizePosting(posting({ title: "Senior Software Engineer" }), "Acme")).toMatchObject({ ok: false });
    expect(normalizePosting(posting({ locationTexts: ["Berlin, Germany"] }), "Acme")).toMatchObject({ ok: false });
  });
});

describe("discovery latency", () => {
  it("is computed only from a first-publication time", () => {
    expect(discoveryLatencyMs("2026-11-01T00:00:00Z", "first_published", "2026-11-01T02:00:00Z")).toBe(7_200_000);
    expect(discoveryLatencyMs("2026-11-01T00:00:00Z", "last_published", "2026-11-01T02:00:00Z")).toBeNull();
    expect(discoveryLatencyMs("2026-11-01T00:00:00Z", "updated", "2026-11-01T02:00:00Z")).toBeNull();
    expect(discoveryLatencyMs(null, "none", "2026-11-01T02:00:00Z")).toBeNull();
    expect(discoveryLatencyMs("2026-11-03T00:00:00Z", "first_published", "2026-11-01T00:00:00Z")).toBeNull();
  });
});
