import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Database integration tests: `npm run test:db`.
 * Requires PostgreSQL (`npm run db:up`) and TEST_DATABASE_URL pointing at a
 * database whose name ends in `_test`. Its schema is dropped and re-migrated
 * at the start of every run.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/db/**/*.db.test.ts"],
    globalSetup: ["tests/db/global-setup.ts"],
    // Files share one database; run them one at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      // Anything that reads DATABASE_URL during tests targets the test database.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      PROREZ_DATA_SOURCE: "database",
    },
  },
});
