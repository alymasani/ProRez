/**
 * Background board-sync worker (Milestone 3B).
 *
 *   npm run worker            # run continuously (Ctrl+C / SIGTERM to stop)
 *   npm run worker -- --once  # sync every board that is due now, then exit
 *
 * Reads DATABASE_URL and PROREZ_WORKER_* / PROREZ_SYNC_* settings from .env
 * (see .env.example and docs/ats-sync.md). Safe to run several copies: boards
 * are claimed atomically with leases, so each due board is synced once.
 */
import "dotenv/config";
import { createPrismaClient } from "../lib/db/client";
import { resolveTransport } from "../lib/ats/http";
import { workerConfigFromEnv } from "../lib/ats/schedule";
import { consoleLogger, drainDueBoards, newWorkerId, startWorker } from "../lib/ats/worker";
import { resolveDataSource } from "../lib/repositories/source";
import { discoveryDepsFromEnv } from "../lib/discovery/factory";
import { extractionLimitsFromEnv } from "../lib/careers/limits";

async function main() {
  if (resolveDataSource(process.env) !== "database") {
    throw new Error("The sync worker needs PROREZ_DATA_SOURCE=database (fixture mode has nothing to sync).");
  }
  const config = workerConfigFromEnv(process.env);
  const prisma = createPrismaClient(process.env.DATABASE_URL ?? "");
  const transport = resolveTransport(process.env);
  const owner = newWorkerId();
  // Validates PROREZ_DISCOVERY_* at start-up; discovery runs only when enabled or requested.
  const discovery = discoveryDepsFromEnv(prisma, process.env, consoleLogger);
  const limits = extractionLimitsFromEnv(process.env);
  const deps = { prisma, transport, config, owner, log: consoleLogger, discovery, limits };

  if (process.argv.includes("--once")) {
    consoleLogger("worker_once", { owner });
    const results = await drainDueBoards(deps);
    consoleLogger("worker_once_done", { synced: results.length });
    await prisma.$disconnect();
    return;
  }

  const worker = startWorker(deps);
  let signals = 0;
  const shutdown = (signal: string) => {
    signals++;
    if (signals > 1) process.exit(1); // second Ctrl+C: leave now; leases expire on their own
    consoleLogger("signal", { signal });
    void worker.stop().finally(() => prisma.$disconnect().finally(() => process.exit(0)));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  console.error(`[worker] fatal: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
