import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import path from "node:path";

export const APP_ROOT = path.resolve(__dirname, "../..");
const PRISMA_BIN = path.join(APP_ROOT, "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");

/**
 * Returns TEST_DATABASE_URL after checking it can never point at a database
 * that matters: the name must end in `_test` and differ from DATABASE_URL.
 */
export function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error("TEST_DATABASE_URL is not set. Copy .env.example to .env and run `npm run db:up`.");
  }
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  if (!name.endsWith("_test")) {
    throw new Error(`Refusing to use "${name}" for tests: the database name must end in "_test".`);
  }
  return url;
}

/** Runs the Prisma CLI against the test database. Returns stdout. */
export function prisma(args: string[], options: ExecFileSyncOptions = {}): string {
  return execFileSync(PRISMA_BIN, args, {
    cwd: APP_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
    env: { ...process.env, DATABASE_URL: requireTestDatabaseUrl(), ...options.env },
  }) as string;
}
