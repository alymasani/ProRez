import { createPrismaClient } from "@/lib/db/client";
import type { PrismaClient } from "@/lib/generated/prisma/client";
import { requireTestDatabaseUrl } from "./test-database";

export function createTestPrisma(): PrismaClient {
  return createPrismaClient(requireTestDatabaseUrl());
}

/** Empties every application table (keeps the migration history). */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (rows.length === 0) return;
  const tables = rows.map((r) => `"public"."${r.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}

/** Minimal valid source + job for constraint tests. */
export async function createSourceAndJob(prisma: PrismaClient, jobId = "job-a") {
  await prisma.jobSource.upsert({
    where: { id: "src-test" },
    create: { id: "src-test", provider: "company_site", label: "Test", description: "" },
    update: {},
  });
  return prisma.jobPosting.create({
    data: {
      id: jobId,
      dedupeKey: `acme|developer|${jobId}`,
      company: "Acme Test",
      title: "Developer",
      jobType: "co_op",
      firstDiscoveredAt: new Date("2026-11-01T00:00:00Z"),
      primarySourceId: "src-test",
    },
  });
}

/** Deeply normalises ISO date strings so "…:00Z" and "…:00.000Z" compare equal. */
export function normalizeDates<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, v) =>
    typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? new Date(v).toISOString() : v,
  );
}
