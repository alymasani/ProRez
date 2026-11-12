import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";

const PORT = Number(process.env.E2E_DB_PORT ?? 3211);
const BASE_URL = `http://localhost:${PORT}`;

/**
 * Runs the same e2e suite with pages reading from PostgreSQL.
 * Prerequisite: `npm run db:up && npm run db:deploy && npm run db:seed`
 * (the suite's expectations match the demo seed).
 */
export default defineConfig({
  ...baseConfig,
  use: { ...baseConfig.use, baseURL: BASE_URL },
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { PROREZ_DATA_SOURCE: "database" },
  },
});
