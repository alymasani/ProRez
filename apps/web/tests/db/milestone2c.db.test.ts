import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { changeSubmissionStatus, createApplication, recordInterview, updateApplicationNotes } from "@/lib/applications/service";
import { changeDiscoveryStatus, createManualJob, updateJobNotes } from "@/lib/jobs/service";
import type { ManualJob } from "@/lib/jobs/manual-submission";
import { defaultSettings } from "@/lib/settings/defaults";
import { readSettings, saveSettings } from "@/lib/settings/service";
import { createTestPrisma, truncateAll } from "./helpers";

const db = createTestPrisma();
afterAll(() => db.$disconnect());
beforeEach(() => truncateAll(db));
const ok = <T>(result: { ok: true; value: T } | { ok: false; message: string }) => { if (!result.ok) throw new Error(result.message); return result.value; };
const job = (): ManualJob => ({ url: { original: "https://careers.example/jobs/42?utm_source=test", canonical: "https://careers.example/jobs/42", ats: null }, description: "A sufficiently detailed plain-text job description for persistence testing.", company: "Acme", title: "Software Developer Co-op", location: { city: "Calgary", province: "AB", arrangement: "hybrid" }, jobType: "co_op", durationMonths: 4, term: "Summer 2027", experienceRequirement: null, disciplines: ["backend"], salary: null, notes: "Initial" });

describe("Milestone 2C persistence", () => {
  it("creates, de-duplicates, matches and manages a manual job", async () => {
    await db.searchProfile.create({ data: { id: "profile", name: "Co-ops", criteria: { create: { jobTypes: ["co_op"], durations: ["exactly_4"] } }, versions: { create: { version: 1, snapshot: {} } } } });
    const created = ok(await createManualJob(db, job(), { now: new Date("2026-11-11T12:00:00Z") }));
    expect(created.job.discoveryStatus).toBe("saved"); expect(created.matches).toHaveLength(1);
    expect((await createManualJob(db, job())).ok).toBe(false);
    expect(ok(await changeDiscoveryStatus(db, created.job.id, "dismiss", "saved")).discoveryStatus).toBe("dismissed");
    expect(ok(await changeDiscoveryStatus(db, created.job.id, "restore", "dismissed")).discoveryStatus).toBe("saved");
    expect(ok(await updateJobNotes(db, created.job.id, "Changed")).notes).toBe("Changed");
    expect(await db.jobDescriptionSnapshot.count({ where: { jobId: created.job.id } })).toBe(1);
  });

  it("persists application submission, notes, interviews and append-only history", async () => {
    const saved = ok(await createManualJob(db, job()));
    let app = ok(await createApplication(db, { jobId: saved.job.id, mode: "quick_apply", notes: "" }));
    app = ok(await changeSubmissionStatus(db, { applicationId: app.id, expectedStatus: "not_submitted", to: "submitted", submittedOn: "2026-11-10", note: null, today: "2026-11-11" }));
    expect(app.submittedAt?.slice(0, 10)).toBe("2026-11-10");
    app = ok(await updateApplicationNotes(db, { applicationId: app.id, expectedUpdatedAt: app.updatedAt, notes: "Follow up Friday" }));
    app = ok(await recordInterview(db, { applicationId: app.id, stage: "technical", occurredOn: "2026-11-20", notes: "Scheduled", today: "2026-11-11" }));
    expect(app.submissionStatus).toBe("interviewing");
    expect(await db.applicationInterview.count({ where: { applicationId: app.id } })).toBe(1);
    expect(await db.applicationEvent.count({ where: { applicationId: app.id } })).toBeGreaterThanOrEqual(5);
  });

  it("persists settings and source choices transactionally", async () => {
    const initial = defaultSettings();
    const sources = Object.fromEntries((await db.jobSource.findMany()).map((s) => [s.id, s.id === "src-manual"]));
    const saved = ok(await saveSettings(db, 0, { search: { ...initial.search, provinces: ["AB"] }, notifications: { paused: true, defaultCadence: "daily_digest" }, workflow: initial.workflow }, sources));
    expect(saved.version).toBe(1); expect((await readSettings(db)).search.provinces).toEqual(["AB"]);
  });
});
