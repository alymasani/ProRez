import type { AtsProvider, WorkArrangement } from "../types";
import type { StructuredLocation } from "./canada";
import type { HttpTransport } from "./http";

export type PublishedAtKind = "none" | "first_published" | "last_published" | "updated";

/**
 * One published posting as reported by a provider, minimally normalized.
 * Missing values are null/empty — never guessed. Interpretation (Canada,
 * employment type, duration) happens later in ./normalize.ts.
 */
export interface ProviderPosting {
  /** Provider's posting id, as a string. */
  postingId: string;
  title: string;
  /** Public posting page, if the provider gives one. Display only; never fetched. */
  url: string | null;
  /** Plain text (HTML already converted). Empty when the provider gave none. */
  descriptionText: string;
  locationTexts: string[];
  structuredLocations: StructuredLocation[];
  /** Workplace type the provider states, or null when not stated. */
  workplace: WorkArrangement | null;
  /** Provider's own employment classification, verbatim (e.g. "Intern", "Full-time"). */
  employmentType: string | null;
  department: string | null;
  publishedAt: string | null;
  /** What `publishedAt` means for this provider; only first_published supports latency. */
  publishedAtKind: PublishedAtKind;
  /** Original provider metadata worth keeping (bounded; descriptions excluded). */
  metadata: Record<string, unknown>;
  /**
   * False when the provider needs a separate request for the description and it
   * was not made this run (request cap or failure). The stored description is
   * then kept and the posting is not treated as changed. Default true.
   */
  descriptionFetched?: boolean;
}

export interface FetchOptions {
  transport: HttpTransport;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Board data region from the stored board (Lever "eu"); never inferred from the user. */
  region?: "eu" | null;
  /**
   * Posting ids whose descriptions are already stored. Adapters that fetch
   * descriptions per posting (SmartRecruiters) enrich the others first, so a
   * capped run resumes where the previous one stopped.
   */
  enrichedPostingIds?: ReadonlySet<string>;
}

export interface FetchResult {
  postings: ProviderPosting[];
  /** Malformed items that were skipped, and other non-fatal problems. */
  warnings: string[];
  requests: number;
  /**
   * True only when the adapter can vouch that `postings` is the board's ENTIRE
   * published catalogue (every page read, no item dropped for lacking an id,
   * counts consistent). A successful HTTP response alone is not proof. Only a
   * complete snapshot may mark absent postings missing/inactive.
   */
  complete: boolean;
  /** Why the catalogue is not provably complete (null when complete). */
  incompleteReason: string | null;
  /** Provider items dropped as unreadable (no id/title); not in `postings`. */
  invalidItems?: number;
  /** Postings whose description was deliberately not loaded this run (request cap). */
  enrichmentDeferred?: number;
}

/** Builds the completeness fields: any reason makes the snapshot incomplete. */
export function completeness(...reasons: (string | null | false | undefined)[]): Pick<FetchResult, "complete" | "incompleteReason"> {
  const found = reasons.filter((r): r is string => typeof r === "string" && r.length > 0);
  return found.length === 0 ? { complete: true, incompleteReason: null } : { complete: false, incompleteReason: found.join(" ") };
}

/** Items skipped for lacking an id could be any posting, so absence proves nothing. */
export const MALFORMED_REASON = (count: number) =>
  count > 0 ? `${count} listing${count === 1 ? " was" : "s were"} unreadable, so absent postings cannot be confirmed.` : null;

/** Shared connector contract. Adapters throw AtsError for whole-board failures. */
export interface AtsAdapter {
  provider: AtsProvider;
  /** Official documentation the adapter follows. */
  documentation: string;
  fetchPostings(boardToken: string, options: FetchOptions): Promise<FetchResult>;
}
