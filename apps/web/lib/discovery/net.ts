/**
 * Outbound requests to COMPANY WEBSITES during discovery (Milestone 3C).
 * These hosts come from untrusted data, so every request is defended:
 *
 * - URL policy: https only, default port, no credentials, a real DNS name
 *   (no IP literals, no localhost / internal TLDs), bounded length.
 * - SSRF / DNS rebinding: the hostname is resolved ONCE inside the socket's
 *   own `lookup`, every returned address must be public (Node BlockList of
 *   private, loopback, link-local, CGNAT, multicast, reserved and
 *   documentation ranges, IPv4 and IPv6, including IPv4-mapped IPv6), and the
 *   connection uses exactly that vetted address.
 * - Redirects are followed manually (max 3), each hop re-validated; a redirect
 *   to a recognised ATS board is reported, not followed.
 * - Responses: HTML (or text for robots.txt) only, size-capped, time-limited,
 *   no decompression bombs (identity encoding requested).
 * - robots.txt is fetched first and honoured for our user agent; an
 *   unreachable robots.txt means "do not crawl" (RFC 9309 §2.3.1.4).
 * - Nothing is executed: pages are read as text and only link attributes are
 *   extracted (lib/discovery/links.ts).
 */
import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import { recognizeAtsUrl } from "../boards/board-url";

export const SITE_USER_AGENT = "ProRezBot/0.3 (personal job search; verifies employer career links)";
export const MAX_PAGE_BYTES = 1024 * 1024;
export const MAX_ROBOTS_BYTES = 256 * 1024;
export const PAGE_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;

export type SiteFailure =
  | "blocked_url"
  | "blocked_address"
  | "robots_disallowed"
  | "timeout"
  | "network"
  | "http_error"
  | "not_html"
  | "too_large"
  | "too_many_redirects";

export type PageResult =
  | { ok: true; url: string; finalUrl: string; status: number; html: string; redirects: string[] }
  /** The site redirected to an ATS board; it was not followed. */
  | { ok: true; url: string; finalUrl: string; status: number; html: null; redirects: string[]; atsRedirect: string }
  | { ok: false; url: string; failure: SiteFailure; message: string };

export interface SiteFetcher {
  fetchPage(url: string, signal?: AbortSignal): Promise<PageResult>;
  /** Requests actually sent (including robots.txt and redirect hops). */
  readonly requests: number;
}

// ---------------------------------------------------------------------------
// Address and URL policy
// ---------------------------------------------------------------------------

// Separate lists per family: Node's BlockList also matches IPv4 addresses
// against IPv4-mapped IPv6 rules, so one shared list holding ::ffff:0:0/96
// would block every IPv4 address. Mapped addresses are refused explicitly below.
const BLOCKED_V4 = new net.BlockList();
const BLOCKED_V6 = new net.BlockList();
for (const [range, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) BLOCKED_V4.addSubnet(range, bits, "ipv4");
for (const [range, bits] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23],
  ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["fec0::", 10], ["ff00::", 8],
] as const) BLOCKED_V6.addSubnet(range, bits, "ipv6");

/** True only for globally routable unicast addresses. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !BLOCKED_V4.check(address, "ipv4");
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d or ::ffff:7f00:1): never needed for public sites, often an SSRF trick.
    if (/^::ffff:/i.test(address) || /^0{0,4}(:0{0,4}){4}:ffff:/i.test(address)) return false;
    return !BLOCKED_V6.check(address, "ipv6");
  }
  return false;
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".intranet", ".lan", ".home", ".corp", ".private", ".test", ".invalid", ".example", ".onion", ".arpa"];

/** Validates a company-site URL before any network activity. Returns a reason when refused. */
export function checkSiteUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  if (raw.length > 2048) return { ok: false, reason: "URL too long" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: `scheme ${url.protocol} not allowed` };
  if (url.username || url.password) return { ok: false, reason: "credentials in URL" };
  if (url.port && url.port !== "443") return { ok: false, reason: "non-default port" };
  const host = url.hostname.toLowerCase();
  if (net.isIP(host.replace(/^\[|\]$/g, ""))) return { ok: false, reason: "IP-address hosts are not allowed" };
  if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: "internal host" };
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) return { ok: false, reason: "invalid hostname" };
  if (!/\.[a-z]{2,63}$/.test(host)) return { ok: false, reason: "invalid top-level domain" };
  return { ok: true, url };
}

type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

// ---------------------------------------------------------------------------
// robots.txt (RFC 9309 subset: groups, Allow/Disallow, longest match, * and $)
// ---------------------------------------------------------------------------

export function robotsAllows(robotsTxt: string, path: string, agent = "prorezbot"): boolean {
  const groups: { agents: string[]; rules: { allow: boolean; pattern: string }[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  let lastWasAgent = false;
  for (const rawLine of robotsTxt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) groups.push((current = { agents: [], rules: [] }));
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ allow: key === "allow", pattern: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.startsWith(a)));
  const applicable = mine.length > 0 ? mine : groups.filter((g) => g.agents.includes("*"));
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of applicable.flatMap((g) => g.rules)) {
    const regex = new RegExp(`^${rule.pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$")}`);
    if (regex.test(path) && (!best || rule.pattern.length > best.length || (rule.pattern.length === best.length && rule.allow))) {
      best = { allow: rule.allow, length: rule.pattern.length };
    }
  }
  return best ? best.allow : true;
}

// ---------------------------------------------------------------------------
// Fetcher
// ---------------------------------------------------------------------------

interface RawResponse {
  status: number;
  location: string | null;
  contentType: string;
  body: string;
}

/**
 * DNS lookup for the socket: resolves once and hands it ONLY vetted public
 * addresses (so a rebinding DNS answer cannot redirect the connection).
 * Node calls it with { all: true } (Happy Eyeballs) and then expects an array.
 */
export function createVettedLookup(resolver: Resolver): net.LookupFunction {
  return ((hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
    resolver(hostname)
      .then((addresses) => {
        if (addresses.length === 0) return callback(Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: "ENOTFOUND" }));
        // Every address must be public; otherwise refuse (no partial trust).
        const bad = addresses.find((a) => !isPublicAddress(a.address));
        if (bad) return callback(Object.assign(new Error(`blocked address ${bad.address}`), { code: "PROREZ_BLOCKED_ADDRESS" }));
        const ordered = [...addresses].sort((a, b) => a.family - b.family); // IPv4 first
        if (options?.all) return callback(null, ordered.map((a) => ({ address: a.address, family: a.family })));
        callback(null, ordered[0].address, ordered[0].family);
      })
      .catch((error: Error) => callback(error));
  }) as unknown as net.LookupFunction;
}

function requestOnce(url: URL, resolver: Resolver, maxBytes: number, signal: AbortSignal): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const lookup = createVettedLookup(resolver);
    const req = https.request(
      url,
      {
        method: "GET",
        lookup,
        signal,
        headers: { "user-agent": SITE_USER_AGENT, accept: "text/html,application/xhtml+xml,text/plain;q=0.8", "accept-encoding": "identity" },
        maxHeaderSize: 32 * 1024,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === "string" ? res.headers.location : null;
        const contentType = String(res.headers["content-type"] ?? "").toLowerCase();
        if (status >= 300 && status < 400) {
          res.resume();
          return resolve({ status, location, contentType, body: "" });
        }
        const declared = Number(res.headers["content-length"] ?? "0");
        if (declared > maxBytes) {
          res.destroy();
          return reject(Object.assign(new Error("too large"), { code: "PROREZ_TOO_LARGE" }));
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            res.destroy(Object.assign(new Error("too large"), { code: "PROREZ_TOO_LARGE" }));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => resolve({ status, location, contentType, body: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function failure(url: string, error: unknown, timedOut: boolean): PageResult {
  const code = (error as { code?: string })?.code;
  if (code === "PROREZ_BLOCKED_ADDRESS") return { ok: false, url, failure: "blocked_address", message: (error as Error).message };
  if (code === "PROREZ_TOO_LARGE") return { ok: false, url, failure: "too_large", message: "Response exceeded the size limit." };
  if (timedOut) return { ok: false, url, failure: "timeout", message: `No response within ${PAGE_TIMEOUT_MS / 1000} s.` };
  return { ok: false, url, failure: "network", message: error instanceof Error ? error.message : "Network error." };
}

/** SSRF-safe fetcher for company websites. `resolver` is injectable for tests. */
export function createSafeSiteFetcher(options: { resolver?: Resolver; timeoutMs?: number } = {}): SiteFetcher {
  const resolver = options.resolver ?? systemResolver;
  const timeoutMs = options.timeoutMs ?? PAGE_TIMEOUT_MS;
  const robotsCache = new Map<string, string | null>();
  let requests = 0;

  /**
   * robots.txt per RFC 9309: up to 5 redirects followed (each re-validated by
   * the URL and address policy); 4xx = no rules; 5xx, network errors or too
   * many redirects = unreachable, which means "do not crawl".
   */
  async function robotsFor(origin: string, signal: AbortSignal): Promise<string | null> {
    if (robotsCache.has(origin)) return robotsCache.get(origin)!;
    let value: string | null = null;
    try {
      let target = new URL("/robots.txt", origin);
      for (let hop = 0; hop <= 5; hop++) {
        const checked = checkSiteUrl(target.toString());
        if (!checked.ok) break; // redirected somewhere unsafe: unreachable
        requests++;
        const res = await requestOnce(checked.url, resolver, MAX_ROBOTS_BYTES, signal);
        if (res.status >= 300 && res.status < 400 && res.location) {
          target = new URL(res.location, checked.url);
          continue;
        }
        if (res.status >= 200 && res.status < 300) value = res.body;
        else if (res.status >= 400 && res.status < 500) value = ""; // no robots.txt: allowed
        break;
      }
    } catch (error) {
      if ((error as { code?: string })?.code === "PROREZ_BLOCKED_ADDRESS") throw error;
      value = null;
    }
    robotsCache.set(origin, value);
    return value;
  }

  return {
    get requests() {
      return requests;
    },
    async fetchPage(input, outerSignal) {
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = outerSignal ? AbortSignal.any([outerSignal, timeout]) : timeout;
      const redirects: string[] = [];
      let current = input;
      try {
        for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
          const checked = checkSiteUrl(current);
          if (!checked.ok) return { ok: false, url: input, failure: "blocked_url", message: `${current}: ${checked.reason}` };
          const robots = await robotsFor(checked.url.origin, signal);
          if (robots === null) return { ok: false, url: input, failure: "robots_disallowed", message: `robots.txt for ${checked.url.host} was unreachable, so the site was not crawled.` };
          if (!robotsAllows(robots, checked.url.pathname + checked.url.search)) {
            return { ok: false, url: input, failure: "robots_disallowed", message: `robots.txt disallows ${checked.url.pathname}.` };
          }
          requests++;
          const res = await requestOnce(checked.url, resolver, MAX_PAGE_BYTES, signal);
          if (res.status >= 300 && res.status < 400 && res.location) {
            const next = new URL(res.location, checked.url).toString();
            redirects.push(next);
            if (recognizeAtsUrl(next)) {
              return { ok: true, url: input, finalUrl: checked.url.toString(), status: res.status, html: null, redirects, atsRedirect: next };
            }
            current = next;
            continue;
          }
          if (res.status < 200 || res.status >= 300) return { ok: false, url: input, failure: "http_error", message: `HTTP ${res.status} from ${checked.url.host}.` };
          if (!/^(text\/html|application\/xhtml\+xml)/.test(res.contentType)) {
            return { ok: false, url: input, failure: "not_html", message: `Not an HTML page (${res.contentType || "no content type"}).` };
          }
          return { ok: true, url: input, finalUrl: checked.url.toString(), status: res.status, html: res.body, redirects };
        }
        return { ok: false, url: input, failure: "too_many_redirects", message: `More than ${MAX_REDIRECTS} redirects.` };
      } catch (error) {
        return failure(input, error, timeout.aborted);
      }
    },
  };
}
