/**
 * ATS URL recognition: canonical public board URLs per provider, and parsing
 * any supported board, posting, embed or API URL back into
 * (provider, board token, region). Pure; nothing here makes network requests.
 *
 * Rules (Milestone 3C):
 * - parsed with the WHATWG URL parser — never substring matching on the URL;
 * - an explicit hostname allow-list per provider (exact match, case-insensitive);
 * - http(s) only, no credentials, default port only;
 * - query strings, fragments, capitalisation and trailing slashes are ignored,
 *   except where the provider puts the board in the query (Greenhouse embeds);
 * - the board token must match BOARD_TOKEN_PATTERN and not be a reserved path.
 * A recognised URL says nothing about which company owns the board.
 */
import type { AtsProvider } from "../types";

/** Letters, digits, dot, underscore, hyphen; must start alphanumeric; ≤ 100 chars. */
export const BOARD_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** Data regions with their own public hosts. Only Lever EU is supported today. */
export type BoardRegion = "eu";

type HostRole = "board" | "api";
interface HostInfo {
  provider: AtsProvider;
  role: HostRole;
  region: BoardRegion | null;
}

/** Exact hosts that identify each provider's public boards and public APIs. */
const HOSTS: Record<string, HostInfo> = {
  "boards.greenhouse.io": { provider: "greenhouse", role: "board", region: null },
  "job-boards.greenhouse.io": { provider: "greenhouse", role: "board", region: null },
  // Recognised for parsing only; its jobs are served from the default Greenhouse API.
  "job-boards.eu.greenhouse.io": { provider: "greenhouse", role: "board", region: null },
  "boards-api.greenhouse.io": { provider: "greenhouse", role: "api", region: null },
  "jobs.lever.co": { provider: "lever", role: "board", region: null },
  "api.lever.co": { provider: "lever", role: "api", region: null },
  "jobs.eu.lever.co": { provider: "lever", role: "board", region: "eu" },
  "api.eu.lever.co": { provider: "lever", role: "api", region: "eu" },
  "jobs.ashbyhq.com": { provider: "ashby", role: "board", region: null },
  "api.ashbyhq.com": { provider: "ashby", role: "api", region: null },
  "jobs.smartrecruiters.com": { provider: "smartrecruiters", role: "board", region: null },
  "careers.smartrecruiters.com": { provider: "smartrecruiters", role: "board", region: null },
  "api.smartrecruiters.com": { provider: "smartrecruiters", role: "api", region: null },
};

/** First path segments that are site pages, never board tokens. */
const RESERVED = new Set(["embed", "api", "assets", "static", "favicon.ico", "robots.txt", "sitemap.xml", "search", "v0", "v1", "oneclick-ui", "sr-jobs", "jobs"]);

/**
 * Tokens are compared case-insensitively (the database enforces this too), so
 * they are stored lowercase.
 */
export function normalizeBoardToken(token: string): string {
  return token.trim().toLowerCase();
}

/** Valid identifier for the provider (ATS token, Workday "host/site" or generic "host/path"). */
export function isValidBoardToken(token: string, provider?: AtsProvider): boolean {
  if (provider === "workday") return workdayEndpoints(token) !== null;
  if (provider === "company_site") return parseCareerToken(token) !== null;
  return BOARD_TOKEN_PATTERN.test(token);
}

export function canonicalBoardUrl(provider: AtsProvider, token: string, region: BoardRegion | null = null): string {
  if (provider === "workday") return workdayEndpoints(token)?.boardUrl ?? `https://${token}`;
  if (provider === "company_site") return `https://${token}`;
  const t = encodeURIComponent(normalizeBoardToken(token));
  switch (provider) {
    case "greenhouse":
      return `https://job-boards.greenhouse.io/${t}`;
    case "lever":
      return region === "eu" ? `https://jobs.eu.lever.co/${t}` : `https://jobs.lever.co/${t}`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${t}`;
    case "smartrecruiters":
      return `https://jobs.smartrecruiters.com/${t}`;
  }
}

export interface RecognizedAtsUrl {
  provider: AtsProvider;
  boardToken: string;
  region: BoardRegion | null;
  /** "board" for board/API/embed URLs, "posting" when a specific job is identified. */
  kind: "board" | "posting";
  postingId: string | null;
  canonicalBoardUrl: string;
  /** Locale segment in the URL (Workday), when present. Not part of identity. */
  locale?: string | null;
}

const POSTING_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

function safeDecode(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** Recognises any supported ATS URL; null for anything else (never throws). */
export function recognizeAtsUrl(input: string): RecognizedAtsUrl | null {
  if (typeof input !== "string" || input.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const host = HOSTS[url.hostname.toLowerCase()];
  if (!host) return recognizeWorkdayUrl(url);

  const raw = url.pathname.split("/").filter(Boolean).map(safeDecode);
  if (raw.some((s) => s === null)) return null;
  const segments = raw as string[];
  let token: string | undefined;
  let postingId: string | undefined;

  if (host.role === "api") {
    switch (host.provider) {
      case "greenhouse": // /v1/boards/{token}[/jobs[/{id}]]
        if (segments[0] === "v1" && segments[1] === "boards") [token, postingId] = [segments[2], segments[3] === "jobs" ? segments[4] : undefined];
        break;
      case "lever": // /v0/postings/{token}[/{id}]
        if (segments[0] === "v0" && segments[1] === "postings") [token, postingId] = [segments[2], segments[3]];
        break;
      case "ashby": // /posting-api/job-board/{token}
        if (segments[0] === "posting-api" && segments[1] === "job-board") token = segments[2];
        break;
      case "smartrecruiters": // /v1/companies/{token}[/postings[/{id}]]
        if (segments[0] === "v1" && segments[1] === "companies") [token, postingId] = [segments[2], segments[3] === "postings" ? segments[4] : undefined];
        break;
    }
  } else if (host.provider === "greenhouse" && segments[0] === "embed") {
    // /embed/job_board?for={token}  ·  /embed/job_app?for={token}&token={jobId}
    token = url.searchParams.get("for") ?? undefined;
    postingId = segments[1] === "job_app" ? (url.searchParams.get("token") ?? undefined) : undefined;
  } else {
    token = segments[0];
    if (RESERVED.has((token ?? "").toLowerCase())) return null;
    switch (host.provider) {
      case "greenhouse": // /{token}/jobs/{id}
        postingId = segments[1] === "jobs" ? segments[2] : undefined;
        break;
      case "lever": // /{token}/{postingId}[/apply]
      case "ashby": // /{token}/{postingId}[/application]
        postingId = segments[1];
        break;
      case "smartrecruiters": // /{Company}/{id}-{slug}
        postingId = segments[1] ? segments[1].split("-")[0] : undefined;
        break;
    }
  }

  if (!token || !isValidBoardToken(token)) return null;
  const validPosting = postingId && POSTING_ID.test(postingId) ? postingId : null;
  const boardToken = normalizeBoardToken(token);
  return {
    provider: host.provider,
    boardToken,
    region: host.region,
    kind: validPosting ? "posting" : "board",
    postingId: validPosting,
    canonicalBoardUrl: canonicalBoardUrl(host.provider, boardToken, host.region),
  };
}

// ---------------------------------------------------------------------------
// Workday (Milestone 3D)
// ---------------------------------------------------------------------------
//
// Public Workday career sites live on per-tenant hosts:
//   https://{tenant}.wd{N}.myworkdayjobs.com/[{locale}/]{site}[/job/{location}/{slug}_{req}]
//   https://{tenant}.myworkdayjobs.com/[{locale}/]{site}/...
//   https://wd{N}.myworkdaysite.com/[{locale}/]recruiting/{tenant}/{site}/...
// and the browser-facing JSON ("CXS") under /wday/cxs/{tenant}/{site}/.
// Hosts are matched label by label against these domains — never by substring —
// and the cluster list is NOT assumed to be exhaustive (any wd<digits>).
//
// Identity: one career SITE of one tenant (a tenant can publish several).
// Token: "{tenant}[.wdN]/{site}" for myworkdayjobs.com, or
// "wdN.myworkdaysite/{tenant}/{site}"; lowercase (Workday treats site ids
// case-insensitively). The locale is presentation only, never identity.

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CLUSTER = /^wd\d{1,3}$/;
const SITE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,120}$/;
const LOCALE = /^[a-z]{2}-[a-z]{2}$/i;
const WORKDAY_RESERVED = new Set(["wday", "job", "details", "apply", "login", "userhome", "recruiting", "robots.txt", "sitemap.xml", "favicon.ico", "assets"]);

export interface WorkdayEndpoints {
  host: string;
  tenant: string;
  site: string;
  /** Public career-site URL (no locale). */
  boardUrl: string;
  /** CXS base: `${cxsBase}/jobs` lists, `${cxsBase}${externalPath}` details. */
  cxsBase: string;
}

/** Resolves a Workday token to its hosts and endpoints; null when malformed. */
export function workdayEndpoints(token: string): WorkdayEndpoints | null {
  const parts = token.toLowerCase().split("/");
  if (parts.length === 2) {
    const [prefix, site] = parts;
    const labels = prefix.split(".");
    if (labels.length > 2 || !labels.every((l) => LABEL.test(l)) || (labels[1] !== undefined && !CLUSTER.test(labels[1]))) return null;
    if (!SITE_ID.test(site) || WORKDAY_RESERVED.has(site)) return null;
    const host = `${prefix}.myworkdayjobs.com`;
    const tenant = labels[0];
    return { host, tenant, site, boardUrl: `https://${host}/${site}`, cxsBase: `https://${host}/wday/cxs/${tenant}/${site}` };
  }
  if (parts.length === 3) {
    const [prefix, tenant, site] = parts;
    const m = /^(wd\d{1,3})\.myworkdaysite$/.exec(prefix);
    if (!m || !LABEL.test(tenant) || !SITE_ID.test(site) || WORKDAY_RESERVED.has(site)) return null;
    const host = `${m[1]}.myworkdaysite.com`;
    return { host, tenant, site, boardUrl: `https://${host}/recruiting/${tenant}/${site}`, cxsBase: `https://${host}/wday/cxs/${tenant}/${site}` };
  }
  return null;
}

/** True for hosts Workday serves public career sites from (label-exact). */
export function isWorkdayHost(hostname: string): boolean {
  const labels = hostname.toLowerCase().split(".");
  if (labels.length >= 3 && labels.slice(-2).join(".") === "myworkdayjobs.com") {
    const sub = labels.slice(0, -2);
    return (sub.length === 1 || (sub.length === 2 && CLUSTER.test(sub[1]))) && sub.every((l) => LABEL.test(l));
  }
  return labels.length === 3 && labels[1] === "myworkdaysite" && labels[2] === "com" && CLUSTER.test(labels[0]);
}

function recognizeWorkdayUrl(url: URL): RecognizedAtsUrl | null {
  const hostname = url.hostname.toLowerCase();
  if (!isWorkdayHost(hostname)) return null;
  const raw = url.pathname.split("/").filter(Boolean).map(safeDecode);
  if (raw.some((s) => s === null)) return null;
  let segs = raw as string[];
  let locale: string | null = null;
  let tenant: string;
  let site: string | undefined;
  const mws = hostname.endsWith(".myworkdaysite.com");
  if (segs[0] === "wday" && segs[1] === "cxs") {
    // /wday/cxs/{tenant}/{site}/...
    tenant = (segs[2] ?? "").toLowerCase();
    site = segs[3];
    segs = segs.slice(4);
    if (!mws && tenant !== hostname.split(".")[0]) return null;
  } else {
    if (segs[0] && LOCALE.test(segs[0])) {
      locale = segs[0];
      segs = segs.slice(1);
    }
    if (mws) {
      if (segs[0] !== "recruiting") return null;
      tenant = (segs[1] ?? "").toLowerCase();
      site = segs[2];
      segs = segs.slice(3);
    } else {
      tenant = hostname.split(".")[0];
      site = segs[0];
      segs = segs.slice(1);
    }
  }
  if (!site || !SITE_ID.test(site) || WORKDAY_RESERVED.has(site.toLowerCase()) || !LABEL.test(tenant)) return null;
  const prefix = mws ? `${hostname.split(".")[0]}.myworkdaysite/${tenant}` : hostname.replace(/\.myworkdayjobs\.com$/, "");
  const token = `${prefix}/${site}`.toLowerCase();
  const endpoints = workdayEndpoints(token);
  if (!endpoints) return null;
  // Posting: .../job/{location}/{slug}_{req} (the last segment is the posting id).
  let postingId: string | null = null;
  if (segs[0] === "job" && segs.length >= 2) {
    const last = segs[segs.length - 1];
    if (/^[A-Za-z0-9_~()-][A-Za-z0-9._~()-]{0,199}$/.test(last)) postingId = last;
  }
  return {
    provider: "workday",
    boardToken: token,
    region: null,
    kind: postingId ? "posting" : "board",
    postingId,
    canonicalBoardUrl: endpoints.boardUrl,
    locale,
  };
}

// ---------------------------------------------------------------------------
// Generic company career pages (Milestone 3D)
// ---------------------------------------------------------------------------

/**
 * Canonical identity of a generic career page: lowercase host (no "www."
 * stripping — a different host may be a different site) plus the path without
 * a trailing slash; query and fragment dropped. https only.
 */
export function canonicalCareerUrl(input: string): { token: string; url: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  const host = url.hostname.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) return null;
  const path = url.pathname.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  if (!/^(\/[A-Za-z0-9._~%!$&'()*+,;=:@-]*)*$/.test(path)) return null;
  const token = `${host}${path}`;
  if (token.length > 500) return null;
  return { token, url: `https://${token}` };
}

function parseCareerToken(token: string): { host: string; path: string } | null {
  const c = canonicalCareerUrl(`https://${token}`);
  if (!c || c.token !== token) return null;
  const i = token.indexOf("/");
  return i === -1 ? { host: token, path: "" } : { host: token.slice(0, i), path: token.slice(i) };
}

/** Extracts (provider, token[, region]) from a board or API URL; null if unrecognised. */
export function parseBoardUrl(input: string): { provider: AtsProvider; boardToken: string; region?: BoardRegion } | null {
  const r = recognizeAtsUrl(input);
  if (!r) return null;
  return r.region ? { provider: r.provider, boardToken: r.boardToken, region: r.region } : { provider: r.provider, boardToken: r.boardToken };
}

/** Stable identity of a logical board (URL variants of the same board share it). */
export function boardIdentity(r: { provider: AtsProvider; boardToken: string }): string {
  return `${r.provider}:${normalizeBoardToken(r.boardToken)}`;
}
