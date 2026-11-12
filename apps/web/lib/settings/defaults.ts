import type { AppSettings, SearchPreferences } from "../types";

/** Defaults shown until settings are saved for the first time. */
export const DEFAULT_PREFERENCES: SearchPreferences = {
  provinces: ["ON", "BC", "QC", "NS"],
  arrangements: ["hybrid", "remote"],
  jobTypes: ["internship", "co_op", "new_grad"],
  durations: ["exactly_4"],
  disciplines: ["backend", "full_stack", "infrastructure"],
  includeRemoteCanadaWide: true,
};

export function defaultSettings(): AppSettings {
  return {
    search: structuredClone(DEFAULT_PREFERENCES),
    notifications: { paused: false, defaultCadence: "immediate" },
    workflow: { defaultApplicationMode: "quick_apply", defaultAutomationMode: "approval_required" },
    version: 0,
    updatedAt: null,
  };
}

/** Sources that are always on (they need no connector). */
export const ALWAYS_ENABLED_SOURCES: readonly string[] = ["src-manual"];
