/**
 * Prepares the dedicated Playwright database (database-mode e2e only).
 *
 *   tsx scripts/reset-e2e-db.ts            # create if missing, rebuild schema, migrate, seed
 *   tsx scripts/reset-e2e-db.ts --data     # truncate + re-seed only (fast, between tests)
 *
 * Refuses any database whose name does not end in `_e2e`.
 */
import "dotenv/config";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { createPrismaClient } from "../lib/db/client";
import { seedDemoData } from "../lib/db/seed-demo";

function e2eUrl(): URL {
  const raw = process.env.E2E_DATABASE_URL;
  if (!raw) throw new Error("E2E_DATABASE_URL is not set (see .env.example).");
  const url = new URL(raw);
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!name.endsWith("_e2e")) throw new Error(`Refusing to reset "${name}": the e2e database name must end in "_e2e".`);
  return url;
}

async function ensureDatabase(url: URL) {
  const name = decodeURIComponent(url.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
}

async function rebuildSchema(url: URL) {
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }
  const prisma = path.join(__dirname, "..", "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
  execFileSync(prisma, ["migrate", "deploy"], {
    cwd: path.join(__dirname, ".."),
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: url.toString() },
  });
}

async function resetData(url: URL) {
  const prisma = createPrismaClient(url.toString());
  try {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'job_sources')`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"public"."${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
    await seedDemoData(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const url = e2eUrl();
  if (!process.argv.includes("--data")) {
    await ensureDatabase(url);
    await rebuildSchema(url);
  }
  await resetData(url);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
