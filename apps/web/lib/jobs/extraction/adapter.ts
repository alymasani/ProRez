/**
 * Contract for FUTURE employer-specific job extraction. Not implemented in
 * Milestone 2C: no adapters are registered and nothing fetches URLs.
 *
 * ProRez never assumes an arbitrary URL can be parsed. An adapter may only be
 * added for a specific source whose terms allow automated access, and every
 * request must go through a `SafeFetcher` that enforces ALL of:
 *
 * 1. SSRF protection — resolve DNS first and refuse private, loopback,
 *    link-local, multicast and metadata addresses (IPv4 and IPv6, including
 *    IPv4-mapped forms); re-check after every redirect; pin the connection to
 *    the vetted address so DNS rebinding cannot swap it.
 * 2. Request limits — https only, allow-listed hosts per adapter, at most a
 *    few redirects, connect/read timeouts, a response-size cap, an allowed
 *    content-type list, and per-host rate limiting.
 * 3. Source authorization — each adapter declares the hosts it may contact and
 *    is enabled only for sources the user turned on in Settings.
 *
 * Extracted text is untrusted: it is stored as plain text, never rendered as
 * HTML, and never treated as instructions for any tool or model.
 */
import type { JobType, Province, WorkArrangement } from "../../types";

export interface SafeFetcher {
  /** Fetches an allow-listed https URL under the limits above. */
  fetchText(url: string, options: { allowedHosts: readonly string[]; maxBytes: number }): Promise<string>;
}

/** Fields an adapter can fill in; the user still reviews them before saving. */
export interface ExtractedJobDetails {
  company?: string;
  title?: string;
  description?: string;
  city?: string;
  province?: Province;
  arrangement?: WorkArrangement;
  jobType?: JobType;
  durationMonths?: number;
}

export interface JobExtractionAdapter {
  /** Stable identifier, e.g. "greenhouse-public-board". */
  id: string;
  /** Hosts this adapter may contact. */
  allowedHosts: readonly string[];
  /** Whether this adapter understands the (canonical) URL. Must not do I/O. */
  supports(canonicalUrl: string): boolean;
  extract(canonicalUrl: string, fetcher: SafeFetcher): Promise<ExtractedJobDetails>;
}

/** Registered adapters. Intentionally empty in Milestone 2C. */
export const JOB_EXTRACTION_ADAPTERS: readonly JobExtractionAdapter[] = [];

export function findExtractionAdapter(canonicalUrl: string): JobExtractionAdapter | null {
  return JOB_EXTRACTION_ADAPTERS.find((adapter) => adapter.supports(canonicalUrl)) ?? null;
}
