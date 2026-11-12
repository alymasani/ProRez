/**
 * Discovery configuration (Milestone 3C). Conservative defaults; invalid values
 * fail at start-up. Credentials are read here on the server only and never
 * reach the browser (no NEXT_PUBLIC_ prefix, never passed to client components).
 */

export interface DiscoveryConfig {
  searchProvider: "tavily" | "brave";
  /** Master switch for scheduled discovery in the worker (manual "Run now" still needs it). */
  enabled: boolean;
  intervalHours: number;
  /** Search API requests per run (each request is one query page). */
  maxQueriesPerRun: number;
  /** Candidates verified per run (each costs ATS + website requests). */
  maxCandidatesPerRun: number;
  /** Rolling 24-hour cap on search API requests across all runs. */
  maxRequestsPerDay: number;
  /** Conservative calendar-month cap. Tavily basic search costs one credit. */
  maxCreditsPerMonth: number;
  /** Register verified candidates automatically (otherwise they wait for approval). */
  autoRegister: boolean;
  /** Minimum gap between search API requests. */
  searchMinIntervalMs: number;
  /** Candidates verified concurrently. */
  verifyConcurrency: number;
  /** Temporary verification failures before a candidate is rejected (re-validatable by hand). */
  maxVerifyAttempts: number;
  /** Discovery-run lease (crash recovery). */
  leaseMs: number;
  /** Hard time limit for one run. */
  runTimeoutMs: number;
  braveApiKey: string | null;
  tavilyApiKey: string | null;
}

export const DEFAULT_DISCOVERY_CONFIG: DiscoveryConfig = {
  searchProvider: "tavily",
  enabled: false,
  intervalHours: 24,
  maxQueriesPerRun: 10,
  maxCandidatesPerRun: 25,
  maxRequestsPerDay: 30,
  maxCreditsPerMonth: 900,
  autoRegister: true,
  searchMinIntervalMs: 1_100,
  verifyConcurrency: 2,
  maxVerifyAttempts: 3,
  leaseMs: 30 * 60_000,
  runTimeoutMs: 20 * 60_000,
  braveApiKey: null,
  tavilyApiKey: null,
};

function provider(env: Readonly<Record<string, string | undefined>>): "tavily" | "brave" {
  const value = env.PROREZ_SEARCH_PROVIDER?.trim().toLowerCase() || DEFAULT_DISCOVERY_CONFIG.searchProvider;
  if (value === "tavily" || value === "brave") return value;
  throw new Error(`Invalid PROREZ_SEARCH_PROVIDER="${env.PROREZ_SEARCH_PROVIDER}": use tavily or brave.`);
}

function int(env: Readonly<Record<string, string | undefined>>, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${key}="${raw}": expected a whole number between ${min} and ${max}.`);
  return n;
}

function bool(env: Readonly<Record<string, string | undefined>>, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "enabled", "on"].includes(raw)) return true;
  if (["0", "false", "no", "disabled", "off"].includes(raw)) return false;
  throw new Error(`Invalid ${key}="${env[key]}": use true or false.`);
}

export function discoveryConfigFromEnv(env: Readonly<Record<string, string | undefined>>): DiscoveryConfig {
  return {
    ...DEFAULT_DISCOVERY_CONFIG,
    searchProvider: provider(env),
    enabled: bool(env, "PROREZ_DISCOVERY_ENABLED", DEFAULT_DISCOVERY_CONFIG.enabled),
    intervalHours: int(env, "PROREZ_DISCOVERY_INTERVAL_HOURS", DEFAULT_DISCOVERY_CONFIG.intervalHours, 1, 24 * 30),
    maxQueriesPerRun: int(env, "PROREZ_DISCOVERY_MAX_QUERIES_PER_RUN", DEFAULT_DISCOVERY_CONFIG.maxQueriesPerRun, 0, 200),
    maxCandidatesPerRun: int(env, "PROREZ_DISCOVERY_MAX_CANDIDATES_PER_RUN", DEFAULT_DISCOVERY_CONFIG.maxCandidatesPerRun, 1, 500),
    maxRequestsPerDay: int(env, "PROREZ_DISCOVERY_MAX_REQUESTS_PER_DAY", DEFAULT_DISCOVERY_CONFIG.maxRequestsPerDay, 0, 10_000),
    maxCreditsPerMonth: int(env, "PROREZ_DISCOVERY_MAX_CREDITS_PER_MONTH", DEFAULT_DISCOVERY_CONFIG.maxCreditsPerMonth, 0, 100_000),
    autoRegister: bool(env, "PROREZ_DISCOVERY_AUTO_REGISTER", DEFAULT_DISCOVERY_CONFIG.autoRegister),
    braveApiKey: env.BRAVE_SEARCH_API_KEY?.trim() || null,
    tavilyApiKey: env.TAVILY_API_KEY?.trim() || null,
  };
}

/** Human-readable reason live search is unavailable, or null when it can run. */
export function searchUnavailableReason(config: DiscoveryConfig): string | null {
  const keyName = config.searchProvider === "tavily" ? "TAVILY_API_KEY" : "BRAVE_SEARCH_API_KEY";
  const key = config.searchProvider === "tavily" ? config.tavilyApiKey : config.braveApiKey;
  if (!key) return `${keyName} is not set for the selected ${config.searchProvider} provider, so search-based discovery is off. Other sources still run.`;
  if (config.maxQueriesPerRun === 0 || config.maxRequestsPerDay === 0 || (config.searchProvider === "tavily" && config.maxCreditsPerMonth === 0)) {
    return "The search request or monthly credit budget is 0.";
  }
  return null;
}
