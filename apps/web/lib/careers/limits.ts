/**
 * Extraction limits for Workday and generic career sources (Milestone 3D),
 * from PROREZ_WORKDAY_* / PROREZ_GENERIC_* variables. Invalid values fail at
 * start-up, like the other worker settings.
 */
import type { ExtractionLimits } from "../ats/types";
import type { AtsProvider } from "../types";
import { WORKDAY_DEFAULT_LIMITS } from "../ats/providers/workday";
import { GENERIC_DEFAULT_LIMITS } from "./extract";

type Env = Readonly<Record<string, string | undefined>>;

function intFrom(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${name} "${raw}": expected a whole number between ${min} and ${max}.`);
  return n;
}

export function extractionLimitsFromEnv(env: Env): Partial<Record<AtsProvider, ExtractionLimits>> {
  return {
    workday: {
      maxListingPages: intFrom(env, "PROREZ_WORKDAY_MAX_LISTING_PAGES", WORKDAY_DEFAULT_LIMITS.maxListingPages, 1, 500),
      maxDetailPages: intFrom(env, "PROREZ_WORKDAY_MAX_DETAILS", WORKDAY_DEFAULT_LIMITS.maxDetailPages, 0, 1000),
      maxRenders: 0,
      minIntervalMs: intFrom(env, "PROREZ_WORKDAY_MIN_INTERVAL_MS", WORKDAY_DEFAULT_LIMITS.minIntervalMs, 0, 10_000),
    },
    company_site: {
      maxListingPages: intFrom(env, "PROREZ_GENERIC_MAX_LISTING_PAGES", GENERIC_DEFAULT_LIMITS.maxListingPages, 1, 50),
      maxDetailPages: intFrom(env, "PROREZ_GENERIC_MAX_JOB_PAGES", GENERIC_DEFAULT_LIMITS.maxDetailPages, 1, 500),
      maxRenders: intFrom(env, "PROREZ_GENERIC_MAX_RENDERS", GENERIC_DEFAULT_LIMITS.maxRenders, 0, 20),
      minIntervalMs: intFrom(env, "PROREZ_GENERIC_MIN_INTERVAL_MS", GENERIC_DEFAULT_LIMITS.minIntervalMs, 0, 30_000),
    },
  };
}
