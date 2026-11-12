/** Server-only bridge between the pure mutation guard and the incoming request. */
import { headers } from "next/headers";
import { resolveDataSource } from "../repositories/source";
import { checkMutationAccess, mutationsConfigured, type MutationAccess } from "./mutation-guard";

/** Must be the first call in every Server Action that writes data. */
export async function requireMutationAccess(): Promise<MutationAccess> {
  const h = await headers();
  return checkMutationAccess({
    dataSource: resolveDataSource(process.env),
    localMutations: process.env.PROREZ_LOCAL_MUTATIONS,
    host: h.get("host"),
    origin: h.get("origin"),
  });
}

/** For pages: whether to offer save controls (no request data needed). */
export function getMutationAvailability(): { enabled: boolean; reason: string | null } {
  const { enabled, reason } = mutationsConfigured({
    dataSource: resolveDataSource(process.env),
    localMutations: process.env.PROREZ_LOCAL_MUTATIONS,
  });
  return { enabled, reason };
}
