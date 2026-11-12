import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

/** Creates a Prisma client for a specific connection string (used by tests and scripts). */
export function createPrismaClient(connectionString: string): PrismaClient {
  if (!connectionString) {
    throw new Error("A PostgreSQL connection string is required. Set DATABASE_URL (see .env.example).");
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
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
