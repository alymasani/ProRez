import "dotenv/config";
import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

const PORT = Number(process.env.E2E_DB_PORT ?? 3211);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Read by specs (inherited by worker processes) to enable database-only tests.
process.env.E2E_DATA_SOURCE = "database";

/**
 * Runs the e2e suite with pages reading from — and writing to — PostgreSQL.
 * Uses the dedicated E2E_DATABASE_URL (name must end in `_e2e`), which is
 * rebuilt in global setup and re-seeded before each persistence test, so
 * development data is never touched. Prerequisite: `npm run db:up`.
 */
export default defineConfig({
  ...baseConfig,
  // Persistence tests share one database, so run one test at a time.
  workers: 1,
  fullyParallel: false,
  globalSetup: "./e2e/db-global-setup.ts",
  use: { ...baseConfig.use, baseURL: BASE_URL },
  webServer: {
    command: `npm run build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      PROREZ_DATA_SOURCE: "database",
      PROREZ_LOCAL_MUTATIONS: "enabled",
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
    },
  },
});
