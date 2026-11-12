import { describe, expect, it } from "vitest";
import type { JobProfileMatch, ProfileMatchEntry, SearchProfile } from "../types";
import { planNotifications } from "./notifications";

function profile(id: string, minFitScore = 70, notify = true): SearchProfile {
  return {
    id,
    version: 1,
    archivedAt: null,
    name: id,
    description: "",
    enabled: true,
    criteria: {
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
    },
    minFitScore,
    notifications: { enabled: notify, channel: "telegram", cadence: "immediate" },
    automationMode: "approval_required",
    createdAt: "t",
    updatedAt: "t",
    isDemo: false,
  };
}

const entry = (profileId: string, rank: number, status: ProfileMatchEntry["status"] = "eligible"): ProfileMatchEntry => ({
  profileId,
  profileVersion: 1,
  rank,
  status,
  relevance: null,
  reasons: [],
});

function match(jobId: string, entries: ProfileMatchEntry[], extra: Partial<JobProfileMatch> = {}): JobProfileMatch {
  return {
    jobId,
    dedupeKey: `key-${jobId}`,
    matchedProfileIds: entries.map((e) => e.profileId),
    primaryProfileId: entries[0]?.profileId ?? "",
    entries,
    engineVersion: "test",
    evaluatedAt: "t",
    notifiedAt: null,
    isDemo: false,
    ...extra,
  };
}

const PROFILES = [profile("a"), profile("b"), profile("strict", 95), profile("quiet", 70, false)];

describe("planNotifications — duplicate suppression", () => {
  it("sends exactly one notification for a job matching several profiles", () => {
    const decisions = planNotifications(
      [{ jobId: "j1", fitScore: 80, match: match("j1", [entry("a", 0), entry("b", 1)]) }],
      PROFILES,
    );
    expect(decisions).toEqual([{ jobId: "j1", send: true, profileId: "a", dedupeKey: "key-j1" }]);
  });

  it("never re-sends a job that was already notified", () => {
    const decisions = planNotifications(
      [{ jobId: "j1", fitScore: 99, match: match("j1", [entry("a", 0)], { notifiedAt: "2026-11-01T00:00:00Z" }) }],
      PROFILES,
    );
    expect(decisions).toEqual([{ jobId: "j1", send: false, reason: "already_notified" }]);
  });

  it("suppresses a second job record with the same dedupe key", () => {
    const decisions = planNotifications(
      [
        { jobId: "j1", fitScore: 80, match: match("j1", [entry("a", 0)], { dedupeKey: "same" }) },
        { jobId: "j2", fitScore: 80, match: match("j2", [entry("b", 0)], { dedupeKey: "same" }) },
      ],
      PROFILES,
    );
    expect(decisions.map((d) => d.send)).toEqual([true, false]);
    expect(decisions[1]).toMatchObject({ reason: "duplicate_posting" });
  });

  it("suppresses a duplicate of a posting that was notified earlier", () => {
    const decisions = planNotifications(
      [
        { jobId: "j1", fitScore: 80, match: match("j1", [entry("a", 0)], { dedupeKey: "same", notifiedAt: "t" }) },
        { jobId: "j2", fitScore: 80, match: match("j2", [entry("a", 0)], { dedupeKey: "same" }) },
      ],
      PROFILES,
    );
    expect(decisions[1]).toMatchObject({ send: false, reason: "duplicate_posting" });
  });
});

describe("planNotifications — gating is separate from eligibility", () => {
  it("waits for a fit score instead of guessing", () => {
    const [d] = planNotifications([{ jobId: "j1", fitScore: null, match: match("j1", [entry("a", 0)]) }], PROFILES);
    expect(d).toMatchObject({ send: false, reason: "awaiting_fit_score" });
  });

  it("falls through to a lower-ranked profile whose threshold is met", () => {
    const [d] = planNotifications(
      [{ jobId: "j1", fitScore: 80, match: match("j1", [entry("strict", 0), entry("b", 1)]) }],
      PROFILES,
    );
    expect(d).toMatchObject({ send: true, profileId: "b" });
  });

  it("does not send below every threshold", () => {
    const [d] = planNotifications([{ jobId: "j1", fitScore: 50, match: match("j1", [entry("a", 0)]) }], PROFILES);
    expect(d).toMatchObject({ send: false, reason: "below_fit_threshold" });
  });

  it("does not notify for needs-review-only matches or profiles with notifications off", () => {
    const decisions = planNotifications(
      [
        { jobId: "j1", fitScore: 99, match: match("j1", [entry("a", 0, "needs_review")]) },
        { jobId: "j2", fitScore: 99, match: match("j2", [entry("quiet", 0)]) },
        { jobId: "j3", fitScore: 99, match: null },
      ],
      PROFILES,
    );
    expect(decisions.map((d) => (d.send ? "send" : d.reason))).toEqual([
      "only_needs_review",
      "notifications_disabled",
      "no_matching_profile",
    ]);
  });
});
