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

export function isValidBoardToken(token: string): boolean {
  return BOARD_TOKEN_PATTERN.test(token);
}

export function canonicalBoardUrl(provider: AtsProvider, token: string, region: BoardRegion | null = null): string {
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
  if (!host) return null;

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
