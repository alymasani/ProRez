/**
 * Settings persistence: one row (id 'default') plus job_sources.enabled,
 * written together in one transaction with optimistic concurrency.
 */
import type { PrismaClient, UserSettings } from "../generated/prisma/client";
import { fail, type MutationResult } from "../mutations/result";
import { durationFromDb, durationToDb } from "../repositories/prisma-mappers";
import type { AppSettings } from "../types";
import { defaultSettings } from "./defaults";

const SETTINGS_ID = "default";

export function toAppSettings(row: UserSettings | null): AppSettings {
  if (!row) return defaultSettings();
  return {
    search: {
      provinces: row.provinces,
      arrangements: row.arrangements,
      jobTypes: row.jobTypes,
      durations: row.durations.map(durationFromDb),
      disciplines: row.disciplines,
      includeRemoteCanadaWide: row.includeRemoteCanadaWide,
    },
    notifications: { paused: row.notificationsPaused, defaultCadence: row.defaultNotificationCadence },
    workflow: { defaultApplicationMode: row.defaultApplicationMode, defaultAutomationMode: row.defaultAutomationMode },
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function readSettings(prisma: Pick<PrismaClient, "userSettings">): Promise<AppSettings> {
  return toAppSettings(await prisma.userSettings.findUnique({ where: { id: SETTINGS_ID } }));
}

export async function saveSettings(
  prisma: PrismaClient,
  expectedVersion: number,
  settings: Omit<AppSettings, "version" | "updatedAt">,
  sources: Record<string, boolean>,
): Promise<MutationResult<AppSettings>> {
  const data = {
    provinces: settings.search.provinces,
    arrangements: settings.search.arrangements,
    jobTypes: settings.search.jobTypes,
    durations: settings.search.durations.map(durationToDb),
    disciplines: settings.search.disciplines,
    includeRemoteCanadaWide: settings.search.includeRemoteCanadaWide,
    notificationsPaused: settings.notifications.paused,
    defaultNotificationCadence: settings.notifications.defaultCadence,
    defaultApplicationMode: settings.workflow.defaultApplicationMode,
    defaultAutomationMode: settings.workflow.defaultAutomationMode,
  };

  return prisma.$transaction(async (tx) => {
    const knownSources = await tx.jobSource.findMany({ select: { id: true } });
    const known = new Set(knownSources.map((s) => s.id));
    const unknown = Object.keys(sources).filter((id) => !known.has(id));
    if (unknown.length > 0) {
      return fail("validation", `Unknown job source: ${unknown.join(", ")}. Nothing was saved.`);
    }

    const current = await tx.userSettings.findUnique({ where: { id: SETTINGS_ID }, select: { version: true } });
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== expectedVersion) {
      return fail("version_conflict", "Settings were changed elsewhere. Reload to see the latest before saving.", {
        currentVersion,
      });
    }

    if (current) {
      const updated = await tx.userSettings.updateMany({
        where: { id: SETTINGS_ID, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        return fail("version_conflict", "Settings were changed elsewhere. Reload to see the latest before saving.");
      }
    } else {
      // A concurrent first save makes this create fail with P2002, rolling back everything.
      await tx.userSettings.create({ data: { id: SETTINGS_ID, version: 1, ...data } });
    }

    for (const [id, enabled] of Object.entries(sources)) {
      await tx.jobSource.update({ where: { id }, data: { enabled } });
    }
    return { ok: true, value: await readSettings(tx) };
  });
}
