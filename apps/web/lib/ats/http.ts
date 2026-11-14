/**
 * Outbound HTTP for ATS adapters — the ONLY code in ProRez that makes network
 * requests to job sources.
 *
 * Safety rules (enforced here, not by callers):
 * - Requests go only to a fixed allow-list of provider API hosts over https,
 *   plus Workday career-site hosts (*.myworkdayjobs.com / wdN.myworkdaysite.com,
 *   matched label by label; Milestone 3D). Generic company sites never go
 *   through this transport: they use the SSRF-hardened `site()` fetcher.
 *   URLs are built by adapters from constants plus a validated board token;
 *   nothing from a job description or user-entered URL is ever requested.
 * - Redirects are refused (a redirect could point anywhere).
 * - Every request has a timeout and honours the caller's AbortSignal.
 * - Responses are size-capped and must be JSON.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isWorkdayHost } from "../boards/board-url";
import { createFixtureSiteFetcher, createSafeSiteFetcher, type SiteFetcher } from "../discovery/net";
import { rendererFromEnv } from "../careers/render";

export const ALLOWED_HOSTS = [
  "boards-api.greenhouse.io",
  "api.lever.co",
  "api.eu.lever.co",
  "api.ashbyhq.com",
  "api.smartrecruiters.com",
] as const;

export const DEFAULT_TIMEOUT_MS = 20_000;
export const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;
const USER_AGENT = "ProRez/0.3 (personal job search; manual board sync)";

export type AtsErrorCode =
  | "invalid_board"
  | "not_found"
  | "rate_limited"
  | "quota_exhausted"
  | "http_error"
  | "timeout"
  | "cancelled"
  | "network"
  | "too_large"
  | "invalid_response"
  | "blocked_host";

/** Structured failure returned by adapters (never thrown past the sync service). */
export class AtsError extends Error {
  constructor(
    readonly code: AtsErrorCode,
    message: string,
    readonly status?: number,
    /** From a Retry-After header (429/503), in milliseconds. */
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AtsError";
  }
}

/**
 * Errors that a later attempt may not repeat: rate limits, server errors,
 * timeouts and network failures. Configuration problems (unknown board,
 * blocked host) and malformed/oversized responses are permanent until
 * something changes, so they are never retried automatically.
 */
export function isTransientError(error: unknown): boolean {
  if (!(error instanceof AtsError)) return false;
  switch (error.code) {
    case "rate_limited":
    case "timeout":
    case "network":
      return true;
    case "http_error":
      return error.status === undefined || error.status >= 500 || error.status === 408;
    default:
      return false;
  }
}

export { isPermanentConfigError } from "./errors";

/** Parses Retry-After (delta-seconds or HTTP date). */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

export interface HttpTransport {
  getJson(url: string, options: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
  /** JSON POST (Workday's public job search is a POST). Same host policy as getJson. */
  postJson?(url: string, body: unknown, options: { signal?: AbortSignal; timeoutMs?: number }): Promise<unknown>;
  /**
   * Creates a fresh SSRF-safe fetcher for company websites (generic career
   * sources). Fresh per sync so robots.txt is re-read and requests are counted.
   */
  site?(): SiteFetcher;
}

/** Throws unless `url` is https on an allow-listed host with no credentials or custom port. */
export function assertAllowedUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AtsError("blocked_host", "Refused to request a malformed URL.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    !((ALLOWED_HOSTS as readonly string[]).includes(parsed.hostname) || isWorkdayHost(parsed.hostname))
  ) {
    throw new AtsError("blocked_host", `Refused to request ${parsed.hostname}: not an approved job-board API host.`);
  }
  return parsed;
}

/** Real network transport (global fetch). */
export function createFetchTransport(fetchImpl: typeof fetch = fetch): HttpTransport {
  async function request(url: string, init: { method: "GET" | "POST"; body?: string }, { signal, timeoutMs = DEFAULT_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number }) {
    const target = assertAllowedUrl(url);
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetchImpl(target, {
        method: init.method,
        body: init.body,
        redirect: "error",
        signal: combined,
        headers: { accept: "application/json", "user-agent": USER_AGENT, ...(init.body ? { "content-type": "application/json" } : {}) },
      });
    } catch (error) {
      if (signal?.aborted) throw new AtsError("cancelled", "The sync was cancelled.");
      if (timeout.aborted) throw new AtsError("timeout", `The provider did not respond within ${Math.round(timeoutMs / 1000)} s.`);
      throw new AtsError("network", `Could not reach ${target.hostname}${error instanceof Error ? ` (${error.message})` : ""}.`);
    }

    if (response.status === 404) throw new AtsError("not_found", "The provider has no public board with this identifier.", 404);
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    if (response.status === 429) {
      throw new AtsError("rate_limited", "The provider is rate-limiting requests. Try again later.", 429, retryAfterMs);
    }
    if (response.status === 401 || response.status === 403) {
      // Access restrictions are respected, never worked around.
      throw new AtsError("http_error", `The provider refused access (HTTP ${response.status}); this source cannot be read automatically.`, response.status);
    }
    if (!response.ok) throw new AtsError("http_error", `The provider returned HTTP ${response.status}.`, response.status, retryAfterMs);

    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_RESPONSE_BYTES) throw new AtsError("too_large", "The provider's response is too large.");
    const text = await readCapped(response, MAX_RESPONSE_BYTES);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AtsError("invalid_response", "The provider returned something other than JSON.");
    }
  }
  return {
    getJson: (url, options) => request(url, { method: "GET" }, options),
    postJson: (url, body, options) => request(url, { method: "POST", body: JSON.stringify(body) }, options),
  };
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AtsError("too_large", "The provider's response is too large.");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Recorded-response transport for automated tests (no network). Maps an
 * allow-listed URL to `<dir>/<host>/<path>[__<query>].json`.
 */
export function createFixtureTransport(dir: string): HttpTransport {
  const transport: HttpTransport = {
    // POST bodies select the fixture by their scalar fields: <path>__offset=20.json
    async postJson(url, body, options) {
      const target = assertAllowedUrl(url);
      for (const [k, v] of Object.entries((body ?? {}) as Record<string, unknown>)) {
        if (typeof v === "number" || (typeof v === "string" && v !== "")) target.searchParams.set(k, String(v));
      }
      target.searchParams.delete("limit");
      return transport.getJson(target.toString(), options);
    },
    async getJson(url, { signal }) {
      const target = assertAllowedUrl(url);
      if (signal?.aborted) throw new AtsError("cancelled", "The sync was cancelled.");
      const file = path.join(dir, fixtureName(target));
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        throw new AtsError("not_found", "The provider has no public board with this identifier.", 404);
      }
      const data = JSON.parse(text) as unknown;
      if (data && typeof data === "object" && "__status" in data) {
        const status = Number((data as { __status: number }).__status);
        const retryAfter = (data as { __retryAfterSeconds?: number }).__retryAfterSeconds;
        const retryAfterMs = typeof retryAfter === "number" ? retryAfter * 1000 : undefined;
        if (status === 429) throw new AtsError("rate_limited", "The provider is rate-limiting requests. Try again later.", 429, retryAfterMs);
        throw new AtsError("http_error", `The provider returned HTTP ${status}.`, status, retryAfterMs);
      }
      return data;
    },
  };
  return transport;
}

export function fixtureName(url: URL): string {
  const query = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `${url.hostname}${url.pathname}`.replace(/[^A-Za-z0-9._/-]/g, "_");
  return `${base}${query ? `__${query.replace(/[^A-Za-z0-9=&._-]/g, "_")}` : ""}.json`;
}

export interface RetryPolicy {
  /** Retries after the first attempt (default 3). */
  maxRetries: number;
  /** First backoff delay; doubles each retry (default 1 s). */
  baseDelayMs: number;
  /** Upper bound for one backoff, and for honouring Retry-After in-request (default 30 s). */
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = { maxRetries: 3, baseDelayMs: 1_000, maxDelayMs: 30_000 };

/** Exponential backoff with full jitter: random in [delay/2, delay]. */
export function backoffDelay(attempt: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const delay = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
  return Math.round(delay / 2 + random() * (delay / 2));
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AtsError("cancelled", "The sync was cancelled."));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new AtsError("cancelled", "The sync was cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Wraps a transport with bounded retries for transient failures (429, 5xx,
 * timeouts, network errors). Honours Retry-After when it fits within
 * `maxDelayMs`; a longer Retry-After is NOT waited out in-request — the error
 * is rethrown so the scheduler can reschedule the whole board after it.
 * Permanent errors (404, blocked host, malformed JSON) are never retried.
 */
export function withRetries(
  transport: HttpTransport,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
  hooks: { sleep?: (ms: number, signal?: AbortSignal) => Promise<void>; random?: () => number; onRetry?: (info: { url: string; attempt: number; delayMs: number; error: AtsError }) => void } = {},
): HttpTransport {
  const sleep = hooks.sleep ?? abortableSleep;
  async function retrying(url: string, options: { signal?: AbortSignal; timeoutMs?: number }, call: () => Promise<unknown>): Promise<unknown> {
      for (let attempt = 0; ; attempt++) {
        try {
          return await call();
        } catch (error) {
          if (!isTransientError(error) || attempt >= policy.maxRetries || options.signal?.aborted) throw error;
          const atsError = error as AtsError;
          if (atsError.retryAfterMs !== undefined && atsError.retryAfterMs > policy.maxDelayMs) throw error;
          const delayMs = Math.max(atsError.retryAfterMs ?? 0, backoffDelay(attempt, policy, hooks.random));
          hooks.onRetry?.({ url, attempt: attempt + 1, delayMs, error: atsError });
          await sleep(delayMs, options.signal);
        }
      }
  }
  return {
    getJson: (url, options) => retrying(url, options, () => transport.getJson(url, options)),
    ...(transport.postJson ? { postJson: (url: string, body: unknown, options: { signal?: AbortSignal; timeoutMs?: number }) => retrying(url, options, () => transport.postJson!(url, body, options)) } : {}),
    ...(transport.site ? { site: transport.site } : {}),
  };
}

/**
 * Transport selection for the running app. Recorded responses are used only
 * when PROREZ_ATS_TRANSPORT=fixtures AND the database is a test/e2e database,
 * so a misconfigured deployment can never silently serve fake jobs.
 */
/** True when DATABASE_URL names a disposable *_e2e or *_test database (fixtures allowed). */
export function isTestDatabase(env: Readonly<Record<string, string | undefined>>): boolean {
  try {
    return /_(e2e|test)$/.test(new URL(env.DATABASE_URL ?? "").pathname.slice(1));
  } catch {
    return false;
  }
}

export function resolveTransport(env: Readonly<Record<string, string | undefined>> = process.env): HttpTransport {
  if (env.PROREZ_ATS_TRANSPORT === "fixtures") {
    if (!isTestDatabase(env)) {
      throw new Error("PROREZ_ATS_TRANSPORT=fixtures is only allowed against a *_e2e or *_test database.");
    }
    const sites = env.PROREZ_DISCOVERY_SITE_FIXTURES ?? path.join(process.cwd(), "e2e", "fixtures", "discovery", "sites");
    return { ...createFixtureTransport(env.PROREZ_ATS_FIXTURE_DIR ?? path.join(process.cwd(), "e2e", "fixtures", "ats")), site: () => createFixtureSiteFetcher(sites) };
  }
  const maxRetries = Number(env.PROREZ_SYNC_MAX_RETRIES ?? DEFAULT_RETRY_POLICY.maxRetries);
  const renderer = rendererFromEnv(env);
  return withRetries({ ...createFetchTransport(), site: () => createSafeSiteFetcher({ renderer }) }, {
    ...DEFAULT_RETRY_POLICY,
    maxRetries: Number.isInteger(maxRetries) && maxRetries >= 0 && maxRetries <= 10 ? maxRetries : DEFAULT_RETRY_POLICY.maxRetries,
  });
}
