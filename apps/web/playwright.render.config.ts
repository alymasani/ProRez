import "dotenv/config";
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_RENDER_PORT ?? 3212);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Read by e2e/render-validation.spec.ts (inherited by worker processes).
process.env.E2E_RENDER_VALIDATION = "1";

/**
 * Rendering regression suite (`npm run test:e2e:render`).
 *
 * Next.js only validates Cache Components / instant navigation in `next dev`
 * (production builds never report "uncached data outside <Suspense>"), so this
 * suite runs a DEV server in database mode against the isolated
 * E2E_DATABASE_URL (rebuilt in global setup; dev data is never touched) and
 * fails on any validation error, for direct loads and client navigations.
 *
 * Isolation (Milestone 3C fix): its own port (E2E_RENDER_PORT, default 3212)
 * and its own Next.js folder (.next-render), so it runs while `npm run dev`
 * is active without touching that server. `reuseExistingServer: false` means
 * an unrelated process on the port fails the run instead of being tested.
 * The database is prepared BEFORE the server starts (see webServer.command).
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "render-validation.spec.ts",
  workers: 1,
  reporter: [["list"]],
  use: { baseURL: BASE_URL, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
  webServer: {
    command: `npx tsx scripts/reset-e2e-db.ts && npx next dev -H 127.0.0.1 -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PROREZ_DATA_SOURCE: "database",
      PROREZ_NEXT_DIST_DIR: ".next-render",
      PROREZ_LOCAL_MUTATIONS: "enabled",
      // Board syncs read recorded responses from e2e/fixtures/ats — never the network.
      PROREZ_ATS_TRANSPORT: "fixtures",
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
    },
  },
});
