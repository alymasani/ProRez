/**
 * Refuses to load fictional demo data anywhere it could be mistaken for real
 * data. Pure so the rules are unit tested (seed-guard.test.ts).
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "postgres", "host.docker.internal"]);

export interface SeedGuardEnv {
  NODE_ENV?: string;
  DATABASE_URL?: string;
  PROREZ_ALLOW_REMOTE_DEMO_SEED?: string;
}

export type SeedGuardResult = { ok: true; database: string } | { ok: false; reason: string };

export function checkDemoSeedAllowed(env: SeedGuardEnv): SeedGuardResult {
  if (env.NODE_ENV === "production") {
    return { ok: false, reason: "NODE_ENV is 'production'. Demo fixtures are never seeded in production." };
  }
  if (!env.DATABASE_URL) {
    return { ok: false, reason: "DATABASE_URL is not set." };
  }

  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    return { ok: false, reason: "DATABASE_URL is not a valid URL." };
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    return { ok: false, reason: `Unsupported protocol "${url.protocol}".` };
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (/prod/i.test(database)) {
    return { ok: false, reason: `Database name "${database}" looks like production.` };
  }

  const host = url.hostname.toLowerCase();
  if (!LOCAL_HOSTS.has(host) && env.PROREZ_ALLOW_REMOTE_DEMO_SEED !== "1") {
    return {
      ok: false,
      reason: `Host "${host}" is not local. Set PROREZ_ALLOW_REMOTE_DEMO_SEED=1 only for a non-production database.`,
    };
  }

  return { ok: true, database };
}
