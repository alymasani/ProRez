import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/** Creates a Prisma client for a specific connection string (used by tests and scripts). */
export function createPrismaClient(connectionString: string): PrismaClient {
  if (!connectionString) {
    throw new Error("A PostgreSQL connection string is required. Set DATABASE_URL (see .env.example).");
  }
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      // Fail fast instead of hanging when PostgreSQL (e.g. a restarted Docker
      // container) is unreachable, and drop idle sockets before a NAT/VM
      // network layer silently kills them. Matters most for the long-running
      // sync worker.
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 60_000,
      keepAlive: true,
    }),
  });
}

const globalForPrisma = globalThis as unknown as { prorezPrisma?: PrismaClient };

/**
 * Process-wide client for the app, created lazily from DATABASE_URL. Cached on
 * `globalThis` so dev-server hot reloads do not open a new pool each time.
 */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prorezPrisma) {
    globalForPrisma.prorezPrisma = createPrismaClient(process.env.DATABASE_URL ?? "");
  }
  return globalForPrisma.prorezPrisma;
}
