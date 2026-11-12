/**
 * Canonical public board URLs per ATS provider, and parsing pasted URLs back
 * into (provider, token). Pure; nothing here makes network requests.
 */
import type { AtsProvider } from "../types";

/** Letters, digits, dot, underscore, hyphen; must start alphanumeric; ≤ 100 chars. */
export const BOARD_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const BASES: Record<AtsProvider, string> = {
  greenhouse: "https://job-boards.greenhouse.io/",
  lever: "https://jobs.lever.co/",
  ashby: "https://jobs.ashbyhq.com/",
  smartrecruiters: "https://jobs.smartrecruiters.com/",
};

/** Hosts that identify each provider's public boards. */
const HOSTS: Record<string, AtsProvider> = {
  "boards.greenhouse.io": "greenhouse",
  "job-boards.greenhouse.io": "greenhouse",
  "job-boards.eu.greenhouse.io": "greenhouse",
  "boards-api.greenhouse.io": "greenhouse",
  "jobs.lever.co": "lever",
  "jobs.eu.lever.co": "lever",
  "api.lever.co": "lever",
  "jobs.ashbyhq.com": "ashby",
  "api.ashbyhq.com": "ashby",
  "jobs.smartrecruiters.com": "smartrecruiters",
  "careers.smartrecruiters.com": "smartrecruiters",
  "api.smartrecruiters.com": "smartrecruiters",
};

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

export function canonicalBoardUrl(provider: AtsProvider, token: string): string {
  return `${BASES[provider]}${encodeURIComponent(normalizeBoardToken(token))}`;
}

/** Extracts (provider, token) from a board or API URL; null if unrecognised. */
export function parseBoardUrl(input: string): { provider: AtsProvider; boardToken: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const provider = HOSTS[url.hostname.toLowerCase()];
  if (!provider) return null;

  const segments = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  let token: string | undefined;
  if (url.hostname.startsWith("boards-api.")) {
    // /v1/boards/{token}/jobs
    token = segments[0] === "v1" && segments[1] === "boards" ? segments[2] : undefined;
  } else if (url.hostname.startsWith("api.lever.")) {
    // /v0/postings/{token}
    token = segments[0] === "v0" && segments[1] === "postings" ? segments[2] : undefined;
  } else if (url.hostname === "api.ashbyhq.com") {
    // /posting-api/job-board/{token}
    token = segments[0] === "posting-api" && segments[1] === "job-board" ? segments[2] : undefined;
  } else if (url.hostname === "api.smartrecruiters.com") {
    // /v1/companies/{token}/postings
    token = segments[0] === "v1" && segments[1] === "companies" ? segments[2] : undefined;
  } else {
    token = segments[0];
  }

  if (!token || !isValidBoardToken(token)) return null;
  return { provider, boardToken: normalizeBoardToken(token) };
}
