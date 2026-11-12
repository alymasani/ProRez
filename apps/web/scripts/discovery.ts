/**
 * Board discovery commands (Milestone 3C).
 *
 *   npm run discovery -- run                      # one manual discovery run now, in this process
 *   npm run discovery -- import <file> [--crawl CC-MAIN-2025-38] [--max 50000]
 *                                                 # import Common Crawl URL-index results (see docs/discovery.md)
 *   npm run discovery -- status                   # counts, last runs, budget
 *
 * Scheduled discovery runs inside the worker (npm run worker) when
 * PROREZ_DISCOVERY_ENABLED=true; "Run discovery now" in the app asks the worker.
 */
import "dotenv/config";
import { createPrismaClient } from "../lib/db/client";
import { consoleLogger } from "../lib/ats/worker";
import { discoveryDepsFromEnv } from "../lib/discovery/factory";
import { importCommonCrawlFile } from "../lib/discovery/import";
import { claimDiscovery, requestDiscoveryRun, runDiscovery, searchRequestsLast24h, tavilyCreditsThisMonth, SCHEDULE_ID } from "../lib/discovery/run";
import { newWorkerId } from "../lib/ats/worker";
import { resolveDataSource } from "../lib/repositories/source";

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (resolveDataSource(process.env) !== "database") throw new Error("Discovery needs PROREZ_DATA_SOURCE=database.");
  const prisma = createPrismaClient(process.env.DATABASE_URL ?? "");
  const [command, arg] = process.argv.slice(2).filter((a) => a !== "--");
  try {
    if (command === "run") {
      const makeDeps = discoveryDepsFromEnv(prisma, process.env, consoleLogger);
      const deps = makeDeps();
      const owner = `cli:${newWorkerId()}`;
      // Take the schedule lease like the worker, so a CLI run never overlaps a worker run.
      await requestDiscoveryRun(prisma); // creates the schedule row if missing
      const claim = await claimDiscovery(prisma, { owner, now: new Date(), leaseMs: deps.config.leaseMs, scheduledEnabled: false });
      if (!claim) {
        console.log("Another discovery run holds the lease; try again when it finishes.");
        return;
      }
      try {
        const summary = await runDiscovery(deps, { trigger: "manual" });
        if (summary) console.log(JSON.stringify(summary, null, 2));
      } finally {
        const next = new Date(Date.now() + deps.config.intervalHours * 3_600_000);
        await prisma.discoverySchedule.updateMany({ where: { id: SCHEDULE_ID, leaseOwner: owner }, data: { leaseOwner: null, leaseExpiresAt: null, requestedAt: null, nextRunAt: next } });
      }
    } else if (command === "import") {
      if (!arg) throw new Error("Usage: npm run discovery -- import <file> [--crawl CC-MAIN-2025-38] [--max 50000]");
      const max = flag("--max") ? Number(flag("--max")) : undefined;
      if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > 1_000_000)) throw new Error("--max must be a whole number between 1 and 1000000.");
      const summary = await importCommonCrawlFile(prisma, arg, { crawl: flag("--crawl"), maxRows: max });
      console.log(JSON.stringify(summary, null, 2));
      console.log("Imported candidates are unverified; the next discovery run verifies them against the live ATS.");
    } else if (command === "status") {
      const [byStatus, runs, used, credits, schedule] = await Promise.all([
        prisma.discoveryCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.discoveryRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
        searchRequestsLast24h(prisma, new Date()),
        tavilyCreditsThisMonth(prisma, new Date()),
        prisma.discoverySchedule.findUnique({ where: { id: SCHEDULE_ID } }),
      ]);
      console.log("Candidates:", Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])));
      console.log("Search requests in the last 24 h:", used);
      console.log("Tavily credits in the current UTC month:", credits);
      console.log("Next scheduled run:", schedule?.nextRunAt?.toISOString() ?? "not scheduled");
      for (const r of runs) console.log(`${r.startedAt.toISOString()} ${r.trigger} ${r.source} ${r.status} new=${r.newCandidates} registered=${r.registered} pending=${r.pendingReview} rejected=${r.rejected} search=${r.searchRequests} credits=${r.searchCredits} ats=${r.atsRequests} site=${r.siteRequests}`);
    } else {
      throw new Error("Usage: npm run discovery -- run | import <file> | status");
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(`[discovery] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
