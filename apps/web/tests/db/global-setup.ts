import "dotenv/config";
import pg from "pg";
import { prisma, requireTestDatabaseUrl } from "./test-database";

/** Recreates the test database schema from the committed migrations. */
export default async function setup() {
  const url = requireTestDatabaseUrl();

  const client = new pg.Client({ connectionString: url });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Cannot connect to the test database. Is PostgreSQL running (\`npm run db:up\`)?\n${String(error)}`,
    );
  }
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
  } finally {
    await client.end();
  }

  prisma(["migrate", "deploy"]);
}
