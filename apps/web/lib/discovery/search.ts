/**
 * Search-API discovery source (Milestone 3C). Pluggable: anything that
 * implements SearchProvider can feed candidate URLs.
 *
 * Provider result URLs are transient: only canonical board identifiers that
 * pass ProRez's independent ATS/company verification are persisted. Titles,
 * snippets, ranks and raw provider responses are never stored.
 */
import { AtsError, withRetries, type HttpTransport, type RetryPolicy } from "../ats/http";

export interface SearchPage {
  /** Result URLs (transient — callers must not persist them). */
  urls: string[];
  moreAvailable: boolean;
  /** HTTP requests this page cost (including retries). */
  requests: number;
  /** Provider-reported credits consumed by successful requests. */
  credits: number;
}

export interface SearchProvider {
  readonly name: string;
  /** Total HTTP requests sent so far, including failed ones (budget accounting). */
  readonly requests: number;
  readonly credits: number;
  /** `page` is 0-based; providers bound it (Brave: 0–9). */
  /** `requestLimit` bounds this call including retries. */
  search(query: string, page: number, signal?: AbortSignal, requestLimit?: number): Promise<SearchPage>;
}

export const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
export const TAVILY_ENDPOINT = "https://api.tavily.com/search";
export const BRAVE_MAX_PAGE = 9;
const BRAVE_HOST = "api.search.brave.com";
const BRAVE_TIMEOUT_MS = 15_000;
const TAVILY_TIMEOUT_MS = 20_000;
const MAX_SEARCH_RESPONSE_BYTES = 2 * 1024 * 1024;

const sitePattern = /(?:^|\s)site:([a-z0-9.-]+)/gi;

/** Job aggregators excluded from unrestricted (careers-page) searches: never a company's own site. */
const AGGREGATORS = ["linkedin.com", "indeed.com", "glassdoor.com", "glassdoor.ca", "ziprecruiter.com", "monster.com", "monster.ca", "simplyhired.com", "talent.com", "workopolis.com", "jobbank.gc.ca", "builtin.com", "wellfound.com"];

/**
 * Tavily request body. Domain-restricted queries ("site:host") send
 * include_domains; unrestricted careers-page queries must NOT send an empty
 * restriction (Tavily answers HTTP 400 — observed live) and exclude job
 * aggregators instead.
 */
export function tavilyRequestBody(query: string): Record<string, unknown> {
  const domains = domainsFromQuery(query);
  return {
    query,
    search_depth: "basic",
    topic: "general",
    max_results: 20,
    include_answer: false,
    include_raw_content: false,
    include_images: false,
    include_usage: true,
    ...(domains.length > 0 ? { include_domains: domains, include_domains_mode: "restrict" } : { exclude_domains: AGGREGATORS }),
    safe_search: true,
  };
}

/** Extracts query domains for Tavily's server-side domain restriction. */
export function domainsFromQuery(query: string): string[] {
  return [...query.matchAll(sitePattern)].map((match) => match[1].toLowerCase()).filter((host, i, all) => all.indexOf(host) === i).slice(0, 20);
}

/** Validates Tavily's response and intentionally discards all fields but URLs. */
function tavilyCredits(data: unknown): number {
  if (!data || typeof data !== "object") throw new AtsError("invalid_response", "Tavily search response is not an object.");
  const reportedCredits = (data as { usage?: { credits?: unknown } }).usage?.credits;
  if (reportedCredits !== undefined && (typeof reportedCredits !== "number" || !Number.isInteger(reportedCredits) || reportedCredits < 0)) {
    throw new AtsError("invalid_response", "Tavily search response has invalid credit usage.");
  }
  // Basic search is documented as one credit. `include_usage` asks Tavily to
  // report it; the fallback keeps accounting correct for older responses.
  return reportedCredits ?? 1;
}

export function parseTavilyResponse(data: unknown): Omit<SearchPage, "requests"> {
  const consumed = tavilyCredits(data);
  const results = (data as { results?: unknown }).results;
  if (!Array.isArray(results)) throw new AtsError("invalid_response", "Tavily search response has no results list.");
  const urls = results
    .map((result) => result && typeof result === "object" && typeof (result as { url?: unknown }).url === "string" ? (result as { url: string }).url : null)
    .filter((url): url is string => !!url)
    .slice(0, 20);
  return { urls, moreAvailable: false, credits: consumed };
}

export function createTavilySearchProvider(
  apiKey: string,
  options: { fetchImpl?: typeof fetch; retry?: RetryPolicy; minIntervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): SearchProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const retry = options.retry ?? { maxRetries: 2, baseDelayMs: 2_000, maxDelayMs: 10_000 };
  const minInterval = options.minIntervalMs ?? 650;
  let requests = 0;
  let credits = 0;
  let last = 0;

  async function request(query: string, signal?: AbortSignal, requestLimit = Number.POSITIVE_INFINITY): Promise<unknown> {
    const startRequests = requests;
    for (let attempt = 0; ; attempt++) {
      const wait = last + minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      const timeout = AbortSignal.timeout(TAVILY_TIMEOUT_MS);
      let response: Response;
      try {
        requests++;
        response = await fetchImpl(TAVILY_ENDPOINT, {
          method: "POST",
          redirect: "error",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(tavilyRequestBody(query)),
        });
      } catch {
        if (signal?.aborted) throw new AtsError("cancelled", "Discovery was cancelled.");
        if (timeout.aborted) throw new AtsError("timeout", "Tavily did not respond in time.");
        throw new AtsError("network", "Could not reach Tavily Search.");
      } finally {
        last = Date.now();
      }
      const retryAfterRaw = response.headers.get("retry-after");
      const retryAfter = retryAfterRaw && /^\d+$/.test(retryAfterRaw) ? Number(retryAfterRaw) * 1000 : undefined;
      if (response.status === 401 || response.status === 403) throw new AtsError("invalid_board", "Tavily rejected the API key.", response.status);
      if (response.status === 432 || response.status === 433) throw new AtsError("quota_exhausted", "Tavily's plan or monthly credit limit is exhausted.", response.status);
      const transient = response.status === 429 || response.status >= 500;
      if (transient && attempt < retry.maxRetries && requests - startRequests < requestLimit) {
        const delay = Math.min(retry.maxDelayMs, retryAfter ?? retry.baseDelayMs * 2 ** attempt);
        await sleep(delay);
        continue;
      }
      if (response.status === 429) throw new AtsError("rate_limited", "Tavily is rate-limiting requests. Try again later.", 429, retryAfter);
      if (!response.ok) throw new AtsError("http_error", `Tavily returned HTTP ${response.status}.`, response.status, retryAfter);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > MAX_SEARCH_RESPONSE_BYTES) throw new AtsError("too_large", "Tavily's response is too large.");
      const text = await response.text();
      if (text.length > MAX_SEARCH_RESPONSE_BYTES) throw new AtsError("too_large", "Tavily's response is too large.");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new AtsError("invalid_response", "Tavily returned something other than JSON.");
      }
    }
  }

  return {
    name: "tavily",
    get requests() { return requests; },
    get credits() { return credits; },
    async search(query, _page, signal, requestLimit) {
      const before = requests;
      const data = await request(query, signal, requestLimit);
      credits += tavilyCredits(data);
      const parsed = parseTavilyResponse(data);
      return { ...parsed, requests: requests - before };
    },
  };
}

/** Fetch transport locked to the Brave API host, with the key in a header. */
export function createBraveTransport(apiKey: string, fetchImpl: typeof fetch = fetch): HttpTransport {
  return {
    async getJson(url, { signal, timeoutMs = BRAVE_TIMEOUT_MS }) {
      const target = new URL(url);
      if (target.protocol !== "https:" || target.hostname !== BRAVE_HOST || target.port || target.username) {
        throw new AtsError("blocked_host", "Refused to send the search API key anywhere but the Brave API host.");
      }
      const timeout = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(target, {
          method: "GET",
          redirect: "error",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
          headers: { accept: "application/json", "x-subscription-token": apiKey },
        });
      } catch {
        if (signal?.aborted) throw new AtsError("cancelled", "Discovery was cancelled.");
        if (timeout.aborted) throw new AtsError("timeout", "The search API did not respond in time.");
        throw new AtsError("network", "Could not reach the search API.");
      }
      const retryAfter = response.headers.get("retry-after");
      const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : undefined;
      if (response.status === 401 || response.status === 403) throw new AtsError("invalid_board", "The search API rejected the API key.", response.status);
      if (response.status === 429) throw new AtsError("rate_limited", "The search API rate limit or quota was reached.", 429, retryAfterMs);
      if (!response.ok) throw new AtsError("http_error", `The search API returned HTTP ${response.status}.`, response.status, retryAfterMs);
      const text = await response.text();
      if (text.length > MAX_SEARCH_RESPONSE_BYTES) throw new AtsError("too_large", "The search API response is too large.");
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new AtsError("invalid_response", "The search API returned something other than JSON.");
      }
    },
  };
}

/** Validates the documented Brave web-search response shape and keeps only URLs. */
export function parseBraveResponse(data: unknown): Omit<SearchPage, "requests" | "credits"> {
  if (!data || typeof data !== "object") throw new AtsError("invalid_response", "Search response is not an object.");
  const d = data as { web?: { results?: unknown }; query?: { more_results_available?: unknown } };
  // A query with no results may omit `web` entirely.
  const results = d.web === undefined ? [] : d.web?.results;
  if (!Array.isArray(results)) throw new AtsError("invalid_response", "Search response has no results list.");
  const urls = results
    .map((r) => (r && typeof r === "object" && typeof (r as { url?: unknown }).url === "string" ? (r as { url: string }).url : null))
    .filter((u): u is string => !!u)
    .slice(0, 50);
  return { urls, moreAvailable: d.query?.more_results_available === true };
}

export function createBraveSearchProvider(
  apiKey: string,
  options: { fetchImpl?: typeof fetch; retry?: RetryPolicy; minIntervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): SearchProvider {
  let requests = 0;
  const counting: HttpTransport = {
    async getJson(url, opts) {
      requests++;
      return base.getJson(url, opts);
    },
  };
  const base = createBraveTransport(apiKey, options.fetchImpl);
  const transport = withRetries(counting, options.retry ?? { maxRetries: 2, baseDelayMs: 2_000, maxDelayMs: 10_000 });
  const minInterval = options.minIntervalMs ?? 1_100;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let last = 0;
  return {
    name: "brave",
    get requests() {
      return requests;
    },
    get credits() {
      return 0;
    },
    async search(query, page, signal) {
      const offset = Math.min(Math.max(0, page), BRAVE_MAX_PAGE);
      const wait = last + minInterval - Date.now();
      if (wait > 0) await sleep(wait);
      const before = requests;
      const url = `${BRAVE_ENDPOINT}?${new URLSearchParams({ q: query, count: "20", offset: String(offset), safesearch: "strict", text_decorations: "false" })}`;
      try {
        const parsed = parseBraveResponse(await transport.getJson(url, { signal }));
        return { ...parsed, credits: 0, moreAvailable: parsed.moreAvailable && offset < BRAVE_MAX_PAGE, requests: requests - before };
      } finally {
        last = Date.now();
      }
    },
  };
}
