import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTestPrisma } from "./helpers";
import { APP_ROOT, prisma as prismaCli } from "./test-database";

const db = createTestPrisma();
afterAll(() => db.$disconnect());

const migrationDirs = readdirSync(path.join(APP_ROOT, "prisma", "migrations"), { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

describe("database connectivity", () => {
  it("connects to the dedicated test database", async () => {
    const [row] = await db.$queryRaw<{ db: string; ok: number }[]>`SELECT current_database() AS db, 1 AS ok`;
    expect(row.ok).toBe(1);
    expect(row.db).toMatch(/_test$/);
  });
});

describe("migrations", () => {
  it("records every committed migration as successfully applied", async () => {
    const applied = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
      ORDER BY migration_name`;
    expect(applied.map((m) => m.migration_name)).toEqual(migrationDirs);
  });

  it("reports the schema as up to date", () => {
    expect(prismaCli(["migrate", "status"])).toMatch(/Database schema is up to date/);
  });

  it("is idempotent: deploying again applies nothing", () => {
    expect(prismaCli(["migrate", "deploy"])).toMatch(/No pending migrations to apply/);
  });

  it("produces exactly the schema in schema.prisma (no drift)", () => {
    // --exit-code: 0 = no difference, 2 = difference (execFileSync throws on non-zero).
    const out = prismaCli([
      "migrate",
      "diff",
      "--from-config-datasource",
      "--to-schema",
      "prisma/schema.prisma",
      "--exit-code",
    ]);
    expect(out).toMatch(/No difference detected/);
  });

  it("creates the hand-written CHECK constraints and partial unique index", async () => {
    const checks = await db.$queryRaw<{ conname: string }[]>`
      SELECT conname FROM pg_constraint WHERE contype = 'c' AND connamespace = 'public'::regnamespace`;
    const names = checks.map((c) => c.conname);
    for (const expected of [
      "job_matches_fit_score_range",
      "search_profiles_min_fit_score_range",
      "applications_submission_consistency",
      "workflow_runs_finish_after_start",
      "approval_requests_pending_unanswered",
      "projects_published_requires_url",
    ]) {
      expect(names).toContain(expected);
    }
    const [partial] = await db.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE indexname = 'approval_requests_one_pending_per_job'`;
    expect(partial.indexdef).toMatch(/UNIQUE INDEX .* WHERE \(decision = 'pending'/);
  });
});
