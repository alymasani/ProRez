import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI configuration. The CLI does not load `.env` on its own in Prisma 7,
 * hence `dotenv/config` above. DATABASE_URL is optional here so that commands
 * that need no database (`prisma generate`, `prisma validate`) work without one.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
