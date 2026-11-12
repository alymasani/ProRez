/**
 * Server-side parsing for Settings. Strict: unknown fields are rejected, every
 * enum value is checked, and duration requirements follow the same rule as
 * profiles (they only apply when internships or co-ops are selected).
 */
import { z } from "zod";
import { formatIssues } from "../jobs/schema";
import {
  APPLICATION_MODES,
  AUTOMATION_MODES,
  DISCIPLINES,
  JOB_TYPES,
  NOTIFICATION_CADENCES,
  PROVINCES,
  SELECTABLE_DURATION_REQUIREMENTS,
  WORK_ARRANGEMENTS,
  type AppSettings,
} from "../types";
import { ALWAYS_ENABLED_SOURCES } from "./defaults";

const unique = <T extends readonly [string, ...string[]]>(values: T) =>
  z.array(z.enum(values)).max(values.length * 2).transform((list) => Array.from(new Set(list)));

export const settingsInputSchema = z.strictObject({
  search: z.strictObject({
    provinces: unique(PROVINCES),
    arrangements: unique(WORK_ARRANGEMENTS),
    jobTypes: unique(JOB_TYPES),
    durations: unique(SELECTABLE_DURATION_REQUIREMENTS),
    disciplines: unique(DISCIPLINES),
    includeRemoteCanadaWide: z.boolean(),
  }),
  notifications: z.strictObject({
    paused: z.boolean(),
    defaultCadence: z.enum(NOTIFICATION_CADENCES),
  }),
  workflow: z.strictObject({
    defaultApplicationMode: z.enum(APPLICATION_MODES),
    defaultAutomationMode: z.enum(AUTOMATION_MODES),
  }),
  /** Source id → enabled. */
  sources: z.record(z.string().max(100), z.boolean()),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;
export type SettingsField = "durations" | "sources";

export type ParseSettingsResult =
  | { ok: true; settings: Omit<AppSettings, "version" | "updatedAt">; sources: Record<string, boolean> }
  | { ok: false; fieldErrors: Partial<Record<SettingsField, string>>; formErrors: string[] };

export function validateSettings(input: SettingsInput): Partial<Record<SettingsField, string>> {
  const errors: Partial<Record<SettingsField, string>> = {};
  const types = input.search.jobTypes;
  const termTypes = types.length === 0 || types.includes("internship") || types.includes("co_op");
  if (!termTypes && input.search.durations.length > 0) {
    errors.durations = "Durations only apply to internships and co-ops.";
  }
  const disabledAlwaysOn = ALWAYS_ENABLED_SOURCES.find((id) => input.sources[id] === false);
  if (disabledAlwaysOn) errors.sources = "Manual submissions are always available and can't be turned off.";
  return errors;
}

export function parseSettingsInput(input: unknown): ParseSettingsResult {
  const parsed = settingsInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: {}, formErrors: formatIssues(parsed.error.issues, "settings") };
  const fieldErrors = validateSettings(parsed.data);
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, formErrors: [] };
  const { sources, ...settings } = parsed.data;
  return { ok: true, settings, sources };
}
