/**
 * Single choke point for every write. Each Server Action calls
 * `requireMutationAccess()` (server-actor.ts) before touching data.
 *
 * Milestone 2B is single-user with no accounts, so access is granted only to
 * the local owner, and it fails closed:
 *   1. The data source must be the database (fixtures are read-only).
 *   2. PROREZ_LOCAL_MUTATIONS=enabled must be set explicitly.
 *   3. The request's Host AND Origin must be loopback (localhost / 127.0.0.1 / ::1).
 *      This blocks LAN clients reaching a dev server and DNS-rebinding attacks
 *      from web pages. It is defence in depth: the npm scripts also bind the
 *      server to 127.0.0.1 so other machines cannot connect at all.
 *
 * BEFORE ANY NETWORK DEPLOYMENT: replace rule 2–3 with a real session check
 * (e.g. Supabase Auth) and per-resource authorization, returning a user actor.
 * Callers only depend on `MutationActor`, so that swap is local to this file.
 */

export type MutationActor = { kind: "local-owner" };

export type MutationAccess =
  | { ok: true; actor: MutationActor }
  | { ok: false; code: "read_only" | "forbidden"; message: string };

export interface MutationContext {
  dataSource: "fixtures" | "database";
  localMutations: string | undefined;
  host: string | null;
  origin: string | null;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function hostnameOf(hostHeader: string): string | null {
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function checkMutationAccess(ctx: MutationContext): MutationAccess {
  if (ctx.dataSource !== "database") {
    return {
      ok: false,
      code: "read_only",
      message: "Demo fixtures are read-only. Set PROREZ_DATA_SOURCE=database to save changes.",
    };
  }
  if (ctx.localMutations !== "enabled") {
    return {
      ok: false,
      code: "forbidden",
      message: "Saving is disabled. Set PROREZ_LOCAL_MUTATIONS=enabled for local single-user development.",
    };
  }

  const host = ctx.host ? hostnameOf(ctx.host) : null;
  if (!host || !LOOPBACK_HOSTNAMES.has(host)) {
    return { ok: false, code: "forbidden", message: "Changes can only be made from this computer (localhost)." };
  }

  let originHost: string | null = null;
  try {
    originHost = ctx.origin ? new URL(ctx.origin).hostname.toLowerCase() : null;
  } catch {
    originHost = null;
  }
  if (!originHost || !LOOPBACK_HOSTNAMES.has(originHost)) {
    return { ok: false, code: "forbidden", message: "Changes must come from the ProRez app running on localhost." };
  }

  return { ok: true, actor: { kind: "local-owner" } };
}

/** Whether the UI should offer saving at all (host/origin are checked per request). */
export function mutationsConfigured(env: { dataSource: "fixtures" | "database"; localMutations: string | undefined }) {
  if (env.dataSource !== "database") {
    return { enabled: false, reason: "Demo fixtures are read-only — run in database mode to save." } as const;
  }
  if (env.localMutations !== "enabled") {
    return { enabled: false, reason: "Saving is disabled (set PROREZ_LOCAL_MUTATIONS=enabled)." } as const;
  }
  return { enabled: true, reason: null } as const;
}
