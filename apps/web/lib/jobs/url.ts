/**
 * Job posting URLs: validation, normalization for duplicate detection, and
 * recognition of ATS posting identities. Pure; NOTHING here fetches a URL.
 *
 * URLs are untrusted input. They are stored and displayed (as plain links with
 * rel="noopener noreferrer nofollow"), never requested by the server. Any
 * future extraction must go through lib/jobs/extraction (SSRF protection,
 * limits, per-source authorization) — see that module's contract.
 */
import type { AtsProvider } from "../types";

export const JOB_URL_MAX_LENGTH = 2048;

export type JobUrlError = "empty" | "too_long" | "malformed" | "unsupported_scheme" | "credentials" | "no_host";

export const JOB_URL_ERROR_MESSAGES: Record<JobUrlError, string> = {
  empty: "Enter a URL.",
  too_long: `URLs must be ${JOB_URL_MAX_LENGTH.toLocaleString("en-CA")} characters or fewer.`,
  malformed: "That isn't a valid URL. Paste the full address, starting with https://",
  unsupported_scheme: "Only http:// and https:// links are supported.",
  credentials: "Remove the username or password from the URL.",
  no_host: "The URL needs a website address (host name).",
};

export type ParsedJobUrl =
  | { ok: true; original: string; canonical: string; ats: AtsPostingRef | null }
  | { ok: false; error: JobUrlError };

export interface AtsPostingRef {
  provider: AtsProvider;
  /** Lowercase board / company identifier. */
  boardToken: string;
  /** Provider's posting identifier. */
  postingId: string;
}

/**
 * Query parameters that only track how someone arrived. Removed from the
 * canonical URL. Deliberately conservative: parameters that can identify the
 * posting itself (e.g. Greenhouse `gh_jid`, generic `id`, `jobId`) are kept.
 */
const TRACKING_PARAMS = new Set([
  "gclid",
  "gbraid",
  "wbraid",
  "dclid",
  "fbclid",
  "msclkid",
  "yclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "hsctatracking",
  "li_fat_id",
  "trk",
  "trackingid",
  "refid",
  "gh_src",
  "lever-source",
  "lever-source[]",
  "lever-origin",
  "ashby_jid_source",
]);

function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  return key.startsWith("utm_") || TRACKING_PARAMS.has(key);
}

/**
 * Parses an untrusted URL string. Accepts only absolute http(s) URLs with a
 * host and no embedded credentials.
 */
export function parseJobUrl(raw: string): ParsedJobUrl {
  const original = raw.trim();
  if (!original) return { ok: false, error: "empty" };
  if (original.length > JOB_URL_MAX_LENGTH) return { ok: false, error: "too_long" };
  // Reject whitespace/control characters inside the URL instead of letting the parser "fix" them.
  if (/[\s\u0000-\u001f\u007f]/.test(original)) return { ok: false, error: "malformed" };

  let url: URL;
  try {
    url = new URL(original);
  } catch {
    return { ok: false, error: "malformed" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: "unsupported_scheme" };
  if (url.username || url.password) return { ok: false, error: "credentials" };
  // A public posting needs a dotted host name ("localhost" or bare names are not job pages).
  if (!url.hostname.includes(".")) return { ok: false, error: "no_host" };

  const canonical = normalizeJobUrl(url);
  return { ok: true, original, canonical, ats: detectAtsPosting(canonical) };
}

/**
 * Canonical form for duplicate detection:
 * - lowercase host, drop a leading "www.", drop default ports
 * - https and http are treated as the same page (canonical scheme is https)
 * - remove the fragment and tracking parameters; sort remaining parameters
 * - remove a trailing slash (except for the root path)
 * Path case is preserved (paths can be case-sensitive).
 */
export function normalizeJobUrl(input: URL | string): string {
  const url = new URL(typeof input === "string" ? input : input.href);
  url.protocol = "https:";
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (url.port === "443" || url.port === "80") url.port = "";
  url.hash = "";

  const kept = [...url.searchParams.entries()]
    .filter(([name]) => !isTrackingParam(name))
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  url.search = "";
  for (const [name, value] of kept) url.searchParams.append(name, value);

  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.href;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * Recognises a posting on a supported ATS from its canonical URL (no network).
 * - Greenhouse:      boards.greenhouse.io/{board}/jobs/{id}, job-boards.greenhouse.io/{board}/jobs/{id}
 * - Lever:           jobs.lever.co/{company}/{uuid}
 * - Ashby:           jobs.ashbyhq.com/{company}/{uuid}
 * - SmartRecruiters: jobs.smartrecruiters.com/{Company}/{id}-{slug}
 */
export function detectAtsPosting(canonicalUrl: string): AtsPostingRef | null {
  let url: URL;
  try {
    url = new URL(canonicalUrl);
  } catch {
    return null;
  }
  const host = url.hostname;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponentSafe);
  const ref = (provider: AtsProvider, board: string | undefined, id: string | undefined): AtsPostingRef | null =>
    board && id && SEGMENT.test(board) && SEGMENT.test(id)
      ? { provider, boardToken: board.toLowerCase(), postingId: id.toLowerCase() }
      : null;

  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io") {
    if (parts[1] === "jobs" && /^\d+$/.test(parts[2] ?? "")) return ref("greenhouse", parts[0], parts[2]);
    return null;
  }
  if (host === "jobs.lever.co") {
    if (/^[0-9a-f-]{36}$/i.test(parts[1] ?? "")) return ref("lever", parts[0], parts[1]);
    return null;
  }
  if (host === "jobs.ashbyhq.com") {
    if (/^[0-9a-f-]{36}$/i.test(parts[1] ?? "")) return ref("ashby", parts[0], parts[1]);
    return null;
  }
  if (host === "jobs.smartrecruiters.com") {
    const id = /^(\d{6,})(?:-|$)/.exec(parts[1] ?? "")?.[1];
    return ref("smartrecruiters", parts[0], id);
  }
  return null;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
