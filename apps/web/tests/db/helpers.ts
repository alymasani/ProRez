import { createPrismaClient } from "@/lib/db/client";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { requireTestDatabaseUrl } from "./test-database";

export function createTestPrisma(): PrismaClient {
  return createPrismaClient(requireTestDatabaseUrl());
}

/**
 * Empties every application table. Keeps the migration history and the
 * reference job_sources rows that the migrations insert.
 */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'job_sources')`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/** Reference source inserted by the migrations (provider = company_site). */
export const TEST_SOURCE_ID = "src-company-site";

/** Minimal valid job for constraint tests. */
export async function createSourceAndJob(prisma: PrismaClient, jobId = "job-a") {
  return prisma.jobPosting.create({
    data: {
      id: jobId,
      dedupeKey: `acme|developer|${jobId}`,
      company: "Acme Test",
      title: "Developer",
      jobType: "co_op",
      firstDiscoveredAt: new Date("2026-11-01T00:00:00Z"),
      primarySourceId: TEST_SOURCE_ID,
    },
  });
}

/** Deeply normalises ISO date strings so "…:00Z" and "…:00.000Z" compare equal. */
export function normalizeDates<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, v) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? new Date(v).toISOString() : v,
  );
}

/** Creates a profile with a version-1 snapshot, as the service does. */
export async function createProfileRow(prisma: PrismaClient, id: string, name = id) {
  return prisma.searchProfile.create({
    data: { id, name, versions: { create: { version: 1, snapshot: { name } } } },
  });
}
