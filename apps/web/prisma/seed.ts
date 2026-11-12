/**
 * Development-only demo seed: `npm run db:seed` (or `npx prisma db seed`).
 *
 * Loads FICTIONAL fixtures. Refuses to run in production, against non-local
 * hosts (unless PROREZ_ALLOW_REMOTE_DEMO_SEED=1), or against databases whose
 * name contains "prod". See lib/db/seed-guard.ts.
 */
import "dotenv/config";
import { createPrismaClient } from "../lib/db/client";
import { checkDemoSeedAllowed } from "../lib/db/seed-guard";
import { seedDemoData } from "../lib/db/seed-demo";

async function main() {
  const guard = checkDemoSeedAllowed(process.env);
  if (!guard.ok) {
    console.error(`Refusing to seed demo data: ${guard.reason}`);
    process.exitCode = 1;
    return;
  }

  const prisma = createPrismaClient(process.env.DATABASE_URL!);
  try {
    const summary = await seedDemoData(prisma);
    console.log(`Seeded fictional demo data into "${guard.database}":`);
    console.table(summary);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
