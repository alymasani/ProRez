import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createBoard, deleteBoard, setBoardEnabled } from "@/lib/boards/service";
import { parseBoardInput } from "@/lib/boards/schema";
import { reevaluateAllJobs } from "@/lib/matching/persist";
import { draftFromProfile, emptyProfileDraft } from "@/lib/profiles/draft";
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  setProfileEnabled,
  updateProfile,
} from "@/lib/profiles/service";
import { createPrismaRepository } from "@/lib/repositories/prisma-repository";
import type { SearchProfileDraft } from "@/lib/types";
import { TEST_SOURCE_ID, createTestPrisma, truncateAll } from "./helpers";

const db = createTestPrisma();
const repo = createPrismaRepository(db);
afterAll(() => db.$disconnect());
beforeEach(() => truncateAll(db));

function coopDraft(overrides: Partial<SearchProfileDraft> = {}): SearchProfileDraft {
  const draft = emptyProfileDraft();
  draft.name = "Co-ops";
  draft.criteria.jobTypes = ["co_op"];
  draft.criteria.durations = ["up_to_4"];
  draft.criteria.provinces = ["ON"];
  draft.criteria.includeKeywords = ["typescript"];
  draft.criteria.excludeKeywords = ["security clearance"];
  return { ...draft, ...overrides };
}

async function createJob(id: string, overrides: { durationMonths?: number | null; title?: string } = {}) {
  await db.jobPosting.create({
    data: {
      id,
      dedupeKey: `acme|${id}`,
      company: "Acme",
      title: overrides.title ?? "Software Developer Co-op",
      jobType: "co_op",
      durationMonths: overrides.durationMonths === undefined ? 4 : overrides.durationMonths,
      disciplines: ["backend"],
      firstDiscoveredAt: new Date("2026-11-01T00:00:00Z"),
      primarySourceId: TEST_SOURCE_ID,
      locations: { create: [{ position: 0, city: "Toronto", province: "ON", arrangement: "hybrid" }] },
    },
  });
}

const ok = <T>(result: { ok: true; value: T } | { ok: false; message: string }): T => {
  if (!result.ok) throw new Error(`Expected success, got: ${result.message}`);
  return result.value;
};

describe("profile CRUD", () => {
  it("creates a profile with every criterion, version 1 and a snapshot", async () => {
    const created = ok(await createProfile(db, coopDraft()));
    expect(created).toMatchObject({ version: 1, archivedAt: null, enabled: true, isDemo: false });
    expect(draftFromProfile(created)).toEqual(coopDraft());

    const versions = await db.searchProfileVersion.findMany({ where: { profileId: created.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0].snapshot).toEqual(JSON.parse(JSON.stringify(coopDraft())));
    expect(await repo.getSearchProfile(created.id)).toEqual(created);
  });

  it("updates criteria, bumps the version, and keeps every earlier snapshot", async () => {
    const created = ok(await createProfile(db, coopDraft()));
    const changed = coopDraft({ minFitScore: 85 });
    changed.criteria.durations = ["up_to_4", "4_to_8"];
    const updated = ok(await updateProfile(db, created.id, 1, changed));

    expect(updated.version).toBe(2);
    expect(updated.criteria.durations).toEqual(["up_to_4", "4_to_8"]);
    const versions = await db.searchProfileVersion.findMany({ where: { profileId: created.id }, orderBy: { version: "asc" } });
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    expect((versions[0].snapshot as { minFitScore: number }).minFitScore).toBe(70);
  });

  it("enables and disables without creating a new version", async () => {
    const created = ok(await createProfile(db, coopDraft()));
    expect(ok(await setProfileEnabled(db, created.id, false))).toMatchObject({ enabled: false, version: 1 });
    expect(ok(await setProfileEnabled(db, created.id, true)).enabled).toBe(true);
  });

  it("supports several simultaneously enabled profiles", async () => {
    ok(await createProfile(db, coopDraft({ name: "A" })));
    ok(await createProfile(db, coopDraft({ name: "B" })));
    ok(await createProfile(db, coopDraft({ name: "C", enabled: false })));
    expect((await repo.listSearchProfiles()).filter((p) => p.enabled).map((p) => p.name)).toEqual(["A", "B"]);
  });

  it("duplicates as a disabled copy with a free name", async () => {
    const created = ok(await createProfile(db, coopDraft()));
    const copy1 = ok(await duplicateProfile(db, created.id));
    const copy2 = ok(await duplicateProfile(db, created.id));
    expect([copy1.name, copy2.name]).toEqual(["Co-ops (copy)", "Co-ops (copy 2)"]);
    expect(copy1).toMatchObject({ enabled: false, version: 1 });
    expect(copy1.criteria).toEqual(created.criteria);
    expect(copy1.id).not.toBe(created.id);
  });

  it("reports a friendly error for duplicate names (case-insensitive)", async () => {
    ok(await createProfile(db, coopDraft()));
    expect(await createProfile(db, coopDraft({ name: "co-ops" }))).toMatchObject({ ok: false, code: "name_taken" });
  });

  it("reports not-found for missing profiles", async () => {
    expect(await updateProfile(db, "missing", 1, coopDraft())).toMatchObject({ ok: false, code: "not_found" });
    expect(await setProfileEnabled(db, "missing", true)).toMatchObject({ ok: false, code: "not_found" });
    expect(await deleteProfile(db, "missing")).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("persistence across reconnects", () => {
  it("reads back exactly what another connection wrote", async () => {
    const writer = createTestPrisma();
    const created = ok(await createProfile(writer, coopDraft()));
    await writer.$disconnect();

    const reader = createTestPrisma();
    try {
      expect(await createPrismaRepository(reader).getSearchProfile(created.id)).toEqual(created);
    } finally {
      await reader.$disconnect();
    }
  });
});

describe("safe deletion and history", () => {
  it("hard-deletes a profile that never matched anything", async () => {
    const created = ok(await createProfile(db, coopDraft()));
    expect(ok(await deleteProfile(db, created.id))).toEqual({ outcome: "deleted" });
    expect(await db.searchProfile.count()).toBe(0);
    expect(await db.searchProfileVersion.count()).toBe(0);
  });

  it("deletes a profile that only appears in live (un-notified) matches", async () => {
    await createJob("job-a");
    const created = ok(await createProfile(db, coopDraft()));
    await reevaluateAllJobs(db);
    expect(await db.jobProfileMatch.count({ where: { profileId: created.id } })).toBe(1);
    expect(await repo.countProfileHistory(created.id)).toBe(0);

    expect(ok(await deleteProfile(db, created.id))).toEqual({ outcome: "deleted" });
    expect(await db.searchProfile.count()).toBe(0);
    expect(await db.jobProfileMatch.count()).toBe(0);
    // The job's evaluation row remains; it is simply recomputed without the profile.
    expect(await db.jobProfileEvaluation.count()).toBe(1);
  });

  it("archives a profile with notified history and keeps that history intact", async () => {
    await createJob("job-a");
    const created = ok(await createProfile(db, coopDraft()));
    await reevaluateAllJobs(db);
    await db.jobProfileEvaluation.update({ where: { jobId: "job-a" }, data: { notifiedAt: new Date() } });
    expect(await repo.countProfileHistory(created.id)).toBe(1);

    expect(ok(await deleteProfile(db, created.id))).toEqual({ outcome: "archived", historyCount: 1 });
    await reevaluateAllJobs(db);
    const history = await db.jobProfileMatch.findFirstOrThrow({ where: { profileId: created.id } });
    expect(history).toMatchObject({ jobId: "job-a", profileVersion: 1 });
    const archived = await repo.getSearchProfile(created.id);
    expect(archived).toMatchObject({ enabled: false });
    expect(archived?.archivedAt).not.toBeNull();
    expect(await repo.listSearchProfiles()).toEqual([]);
    expect((await repo.listArchivedSearchProfiles()).map((p) => p.id)).toEqual([created.id]);
    expect(await db.searchProfileVersion.count({ where: { profileId: created.id } })).toBe(1);

    // The archived name can be reused, and archived profiles cannot be edited or re-enabled.
    ok(await createProfile(db, coopDraft()));
    expect(await updateProfile(db, created.id, 1, coopDraft())).toMatchObject({ ok: false, code: "archived" });
    expect(await setProfileEnabled(db, created.id, true)).toMatchObject({ ok: false, code: "archived" });
  });

  it("records the profile version each match was evaluated against", async () => {
    await createJob("job-a");
    const created = ok(await createProfile(db, coopDraft()));
    await reevaluateAllJobs(db);
    ok(await updateProfile(db, created.id, 1, coopDraft({ minFitScore: 90 })));
    await reevaluateAllJobs(db);
    const match = await db.jobProfileMatch.findFirstOrThrow({ where: { profileId: created.id } });
    expect(match.profileVersion).toBe(2);
    expect(await db.searchProfileVersion.count({ where: { profileId: created.id } })).toBe(2);
  });

  it("never recomputes an evaluation that already produced a notification", async () => {
    await createJob("job-a");
    const created = ok(await createProfile(db, coopDraft()));
    await reevaluateAllJobs(db);
    await db.jobProfileEvaluation.update({ where: { jobId: "job-a" }, data: { notifiedAt: new Date() } });

    // A later change that would remove the match does not rewrite notified history.
    ok(await setProfileEnabled(db, created.id, false));
    const summary = await reevaluateAllJobs(db);
    expect(summary.skippedNotified).toBe(1);
    expect(await db.jobProfileMatch.count({ where: { jobId: "job-a" } })).toBe(1);
  });
});

describe("evaluation results in the database", () => {
  it("stores one canonical result per job with every matching profile and explicit review states", async () => {
    await createJob("job-a");
    await createJob("job-b", { durationMonths: null });
    const p1 = ok(await createProfile(db, coopDraft({ name: "P1" })));
    const p2 = ok(await createProfile(db, coopDraft({ name: "P2" })));

    await reevaluateAllJobs(db);
    const a = await repo.getProfileMatchForJob("job-a");
    expect(a?.matchedProfileIds.sort()).toEqual([p1.id, p2.id].sort());
    expect(a?.entries.every((e) => e.status === "eligible")).toBe(true);
    expect(await db.jobProfileEvaluation.count()).toBe(2);

    const b = await repo.getProfileMatchForJob("job-b");
    expect(b?.entries.map((e) => e.status)).toEqual(["needs_review", "needs_review"]);
    expect(b?.entries[0].reasons.join(" ")).toMatch(/Duration not stated/);
  });

  it("serialises concurrent evaluation runs without errors or duplicate rows", async () => {
    await createJob("job-a");
    ok(await createProfile(db, coopDraft()));
    await Promise.all([reevaluateAllJobs(db), reevaluateAllJobs(db), reevaluateAllJobs(db)]);
    expect(await db.jobProfileEvaluation.count()).toBe(1);
    expect(await db.jobProfileMatch.count()).toBe(1);
  });
});

describe("concurrent updates", () => {
  it("lets exactly one of two edits of the same version win", async () => {
    const created = ok(await createProfile(db, coopDraft()));
    const [a, b] = await Promise.all([
      updateProfile(db, created.id, 1, coopDraft({ minFitScore: 80 })),
      updateProfile(db, created.id, 1, coopDraft({ minFitScore: 90 })),
    ]);
    const results = [a, b];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: "version_conflict", currentVersion: 2 });

    const stored = await repo.getSearchProfile(created.id);
    const winner = results.find((r) => r.ok)!;
    expect(stored?.version).toBe(2);
    expect(stored?.minFitScore).toBe(winner.ok ? winner.value.minFitScore : -1);
    expect(await db.searchProfileVersion.count({ where: { profileId: created.id } })).toBe(2);
  });

  it("rejects a stale version after a successful update", async () => {
    const created = ok(await createProfile(db, coopDraft()));
    ok(await updateProfile(db, created.id, 1, coopDraft({ minFitScore: 80 })));
    expect(await updateProfile(db, created.id, 1, coopDraft({ minFitScore: 99 }))).toMatchObject({
      ok: false,
      code: "version_conflict",
    });
  });

  it("allows only one of two concurrent creates with the same name", async () => {
    const results = await Promise.all([createProfile(db, coopDraft()), createProfile(db, coopDraft())]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: "name_taken" });
  });
});

describe("employer board registry", () => {
  const input = (overrides: Record<string, unknown> = {}) => {
    const parsed = parseBoardInput({
      provider: "greenhouse",
      employerName: "Acme",
      boardToken: "acme",
      pollIntervalMinutes: 360,
      enabled: true,
      ...overrides,
    });
    if (!parsed.ok) throw new Error("invalid test input");
    return parsed.board;
  };

  it("registers boards for several employers on the same provider", async () => {
    ok(await createBoard(db, input()));
    ok(await createBoard(db, input({ employerName: "Beta", boardToken: "beta" })));
    ok(await createBoard(db, input({ provider: "lever" })));
    expect((await repo.listEmployerBoards()).map((b) => `${b.employerName}/${b.provider}`)).toEqual([
      "Acme/greenhouse",
      "Acme/lever",
      "Beta/greenhouse",
    ]);
  });

  it("prevents duplicate registrations, regardless of token case", async () => {
    ok(await createBoard(db, input()));
    expect(await createBoard(db, input({ boardToken: "ACME", employerName: "Other" }))).toMatchObject({
      ok: false,
      code: "duplicate",
    });
  });

  it("enforces board constraints in the database itself", async () => {
    const base = { employerName: "X", boardUrl: "https://jobs.lever.co/x", boardToken: "x" };
    await expect(db.employerBoard.create({ data: { ...base, provider: "manual" } })).rejects.toThrow(
      /employer_boards_source_provider/,
    );
    await expect(db.employerBoard.create({ data: { ...base, provider: "lever", boardToken: "UPPER" } })).rejects.toThrow(
      /employer_boards_token_format/,
    );
    await expect(
      db.employerBoard.create({ data: { ...base, provider: "lever", pollIntervalMinutes: 1 } }),
    ).rejects.toThrow(/employer_boards_poll_interval_range/);
    await expect(
      db.employerBoard.create({ data: { ...base, provider: "lever", lastSuccessAt: new Date() } }),
    ).rejects.toThrow(/employer_boards_success_after_check/);
  });

  it("toggles and deletes boards; observations keep their source", async () => {
    const board = ok(await createBoard(db, input()));
    expect(ok(await setBoardEnabled(db, board.id, false)).enabled).toBe(false);

    await createJob("job-a");
    await db.sourceObservation.create({
      data: { jobId: "job-a", sourceId: TEST_SOURCE_ID, boardId: board.id, firstSeenAt: new Date(), lastSeenAt: new Date() },
    });
    ok(await deleteBoard(db, board.id));
    const observation = await db.sourceObservation.findFirstOrThrow({ where: { jobId: "job-a" } });
    expect(observation).toMatchObject({ boardId: null, sourceId: TEST_SOURCE_ID });
    expect(await deleteBoard(db, board.id)).toMatchObject({ ok: false, code: "not_found" });
  });
});
