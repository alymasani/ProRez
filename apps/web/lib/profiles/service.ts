/**
 * Search-profile persistence. Every function expects input that has ALREADY
 * passed `parseProfileDraft` and an authorised actor (see app/profiles/actions.ts).
 *
 * - Every create/update writes an immutable snapshot to search_profile_versions.
 * - Updates use optimistic concurrency: the caller sends the version it edited,
 *   and a stale version is rejected instead of silently overwriting.
 * - Delete never destroys history. "History" means matches on evaluations that
 *   already produced a notification (frozen; see lib/matching/persist.ts).
 *   Live, un-notified matches are derived data and are simply recomputed. A
 *   profile with history is archived (hidden, disabled, name freed) instead.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { EVALUATION_LOCK_KEY } from "../matching/persist";
import { fail, prismaErrorCode, type MutationResult } from "../mutations/result";
import { durationFromDb, durationToDb, profileInclude, toSearchProfile } from "../repositories/prisma-mappers";
import { LEGACY_DURATION_REQUIREMENTS, type SearchProfile, type SearchProfileDraft } from "../types";

const LEGACY_DURATION_MESSAGE =
  "Old duration settings can only be kept or removed, not added. Choose one of the current duration options.";

/** Legacy requirements in `draft` that are not already stored (`kept`). */
function addedLegacyDurations(draft: SearchProfileDraft, kept: readonly string[]): string[] {
  return draft.criteria.durations.filter(
    (d) => (LEGACY_DURATION_REQUIREMENTS as readonly string[]).includes(d) && !kept.includes(d),
  );
}

type Tx = Prisma.TransactionClient;

const NAME_TAKEN = "Another active profile already uses this name.";

function scalarData(draft: SearchProfileDraft) {
  return {
    name: draft.name,
    description: draft.description,
    enabled: draft.enabled,
    minFitScore: draft.minFitScore,
    automationMode: draft.automationMode,
    notificationsEnabled: draft.notifications.enabled,
    notificationChannel: draft.notifications.channel,
    notificationCadence: draft.notifications.cadence,
  } as const;
}

function criteriaData(draft: SearchProfileDraft) {
  return { ...draft.criteria, durations: draft.criteria.durations.map(durationToDb) };
}

/** The immutable snapshot stored for each version. */
export function profileSnapshot(draft: SearchProfileDraft): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(draft)) as Prisma.InputJsonObject;
}

function isNameConflict(error: unknown): boolean {
  if (prismaErrorCode(error) !== "P2002") return false;
  return /search_profiles_active_name_key|name/i.test(String((error as Error).message));
}

async function load(tx: Tx | PrismaClient, id: string): Promise<SearchProfile | null> {
  const row = await tx.searchProfile.findUnique({ where: { id }, include: profileInclude });
  return row ? toSearchProfile(row) : null;
}

export async function createProfile(
  prisma: PrismaClient,
  draft: SearchProfileDraft,
  options: { id?: string; isDemo?: boolean; now?: Date } = {},
): Promise<MutationResult<SearchProfile>> {
  const id = options.id ?? `profile-${randomUUID()}`;
  if (addedLegacyDurations(draft, []).length > 0) {
    return fail("validation", LEGACY_DURATION_MESSAGE, { fieldErrors: { durations: LEGACY_DURATION_MESSAGE } });
  }
  try {
    const profile = await prisma.$transaction(async (tx) => {
      await tx.searchProfile.create({
        data: {
          id,
          version: 1,
          ...scalarData(draft),
          isDemo: options.isDemo ?? false,
          ...(options.now ? { createdAt: options.now, updatedAt: options.now } : {}),
          criteria: { create: criteriaData(draft) },
          versions: { create: { version: 1, snapshot: profileSnapshot(draft), ...(options.now ? { createdAt: options.now } : {}) } },
        },
      });
      return (await load(tx, id))!;
    });
    return { ok: true, value: profile };
  } catch (error) {
    if (isNameConflict(error)) return fail("name_taken", NAME_TAKEN, { fieldErrors: { name: NAME_TAKEN } });
    throw error;
  }
}

export async function updateProfile(
  prisma: PrismaClient,
  id: string,
  expectedVersion: number,
  draft: SearchProfileDraft,
): Promise<MutationResult<SearchProfile>> {
  try {
    return await prisma.$transaction(async (tx) => {
      const stored = await tx.profileCriteria.findUnique({ where: { profileId: id }, select: { durations: true } });
      const kept = (stored?.durations ?? []).map(durationFromDb);
      if (addedLegacyDurations(draft, kept).length > 0) {
        return fail("validation", LEGACY_DURATION_MESSAGE, { fieldErrors: { durations: LEGACY_DURATION_MESSAGE } });
      }
      // Compare-and-swap on the version: only one concurrent writer can win.
      // Saving also acknowledges any duration conversion notice from the 2C migration.
      const updated = await tx.searchProfile.updateMany({
        where: { id, version: expectedVersion, archivedAt: null },
        data: { ...scalarData(draft), durationReviewRequired: false, version: { increment: 1 } },
      });
      if (updated.count === 0) {
        const current = await tx.searchProfile.findUnique({ where: { id }, select: { version: true, archivedAt: true } });
        if (!current) return fail("not_found", "This profile no longer exists.");
        if (current.archivedAt) return fail("archived", "This profile was deleted and archived; it can no longer be edited.");
        return fail(
          "version_conflict",
          `This profile was changed elsewhere (now version ${current.version}). Your edits were not saved.`,
          { currentVersion: current.version },
        );
      }
      const newVersion = expectedVersion + 1;
      await tx.profileCriteria.upsert({
        where: { profileId: id },
        create: { profileId: id, ...criteriaData(draft) },
        update: criteriaData(draft),
      });
      await tx.searchProfileVersion.create({
        data: { profileId: id, version: newVersion, snapshot: profileSnapshot(draft) },
      });
      return { ok: true as const, value: (await load(tx, id))! };
    });
  } catch (error) {
    if (isNameConflict(error)) return fail("name_taken", NAME_TAKEN, { fieldErrors: { name: NAME_TAKEN } });
    throw error;
  }
}

/** Enabling/disabling is not a criteria change, so it does not create a new version. */
export async function setProfileEnabled(
  prisma: PrismaClient,
  id: string,
  enabled: boolean,
): Promise<MutationResult<SearchProfile>> {
  const updated = await prisma.searchProfile.updateMany({ where: { id, archivedAt: null }, data: { enabled } });
  if (updated.count === 0) {
    const exists = await prisma.searchProfile.findUnique({ where: { id }, select: { archivedAt: true } });
    return exists ? fail("archived", "Archived profiles cannot be enabled.") : fail("not_found", "This profile no longer exists.");
  }
  return { ok: true, value: (await load(prisma, id))! };
}

/** Picks "Name (copy)", "Name (copy 2)", … that is free among active profiles. */
export async function nextCopyName(prisma: PrismaClient | Tx, name: string): Promise<string> {
  const base = `${name} (copy`;
  const taken = new Set(
    (
      await prisma.searchProfile.findMany({
        where: { archivedAt: null, name: { startsWith: base, mode: "insensitive" } },
        select: { name: true },
      })
    ).map((p) => p.name.toLowerCase()),
  );
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? `${name} (copy)` : `${name} (copy ${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate.slice(0, 60);
  }
}

/** Copies a profile's settings into a new, DISABLED profile (avoids instant duplicate matching). */
export async function duplicateProfile(prisma: PrismaClient, id: string): Promise<MutationResult<SearchProfile>> {
  const source = await load(prisma, id);
  if (!source) return fail("not_found", "This profile no longer exists.");
  const { id: _id, version: _v, archivedAt: _a, createdAt: _c, updatedAt: _u, isDemo: _d, ...draft } = source;
  void [_id, _v, _a, _c, _u, _d];
  // Retry once if another request took the generated name in between.
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await createProfile(prisma, { ...draft, name: await nextCopyName(prisma, source.name), enabled: false });
    if (result.ok || result.code !== "name_taken") return result;
  }
  return fail("name_taken", "Could not find a free name for the copy. Rename the original and try again.");
}

export type DeleteOutcome = { outcome: "deleted" } | { outcome: "archived"; historyCount: number };

/** Matches on notified (frozen) evaluations: the history a profile must keep. */
export function countProfileHistory(prisma: PrismaClient | Tx, profileId: string): Promise<number> {
  return prisma.jobProfileMatch.count({ where: { profileId, evaluation: { notifiedAt: { not: null } } } });
}

/**
 * Removes a profile from live results, then hard-deletes it unless notified
 * history references it, in which case it is archived. Runs under the
 * evaluation lock so a concurrent re-evaluation cannot interleave; the RESTRICT
 * foreign keys on job_profile_matches remain the final safety net.
 */
export async function deleteProfile(prisma: PrismaClient, id: string): Promise<MutationResult<DeleteOutcome>> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EVALUATION_LOCK_KEY})`;
    const exists = await tx.searchProfile.findUnique({ where: { id }, select: { archivedAt: true } });
    if (!exists) return fail("not_found", "This profile no longer exists.");
    if (exists.archivedAt) return fail("archived", "This profile is already archived.");

    await tx.jobProfileMatch.deleteMany({ where: { profileId: id, evaluation: { notifiedAt: null } } });
    const historyCount = await countProfileHistory(tx, id);
    if (historyCount === 0) {
      await tx.searchProfileVersion.deleteMany({ where: { profileId: id } });
      await tx.searchProfile.delete({ where: { id } });
      return { ok: true as const, value: { outcome: "deleted" as const } };
    }
    await tx.searchProfile.update({ where: { id }, data: { archivedAt: new Date(), enabled: false } });
    return { ok: true as const, value: { outcome: "archived" as const, historyCount } };
  });
}
