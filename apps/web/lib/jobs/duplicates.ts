/**
 * Duplicate classification for job intake. Pure: the service loads candidate
 * jobs (same URL, same ATS posting, or same company) and this decides how
 * strongly each one matches the submission.
 *
 *   exact    same canonical URL, or same ATS posting id        → blocked
 *   likely   same company + title + primary location (dedupe key) → blocked
 *   possible same company + title elsewhere, or a very similar
 *            title at the same company and location           → warn; the user may save anyway
 *
 * Blocked submissions never overwrite the existing job: the user can open it,
 * or record the new URL as another sighting of it.
 */
import { formatPrimaryLocation } from "../format";
import type { DiscoveryStatus, JobLocation } from "../types";
import { slugify } from "./dedupe";
import type { AtsPostingRef } from "./url";

export type DuplicateStrength = "exact" | "likely" | "possible";

export type DuplicateReasonKind =
  | "same_url"
  | "same_ats_posting"
  | "same_identity"
  | "same_company_title"
  | "similar_title";

export interface DuplicateReason {
  kind: DuplicateReasonKind;
  strength: DuplicateStrength;
  message: string;
}

/** What the service knows about an existing job. */
export interface DuplicateCandidate {
  jobId: string;
  company: string;
  title: string;
  locations: JobLocation[];
  discoveryStatus: DiscoveryStatus;
  dedupeKey: string;
  canonicalUrls: string[];
  atsPostings: AtsPostingRef[];
}

/** The incoming job, normalized. */
export interface DuplicateProbe {
  canonicalUrl: string | null;
  ats: AtsPostingRef | null;
  company: string;
  title: string;
  location: JobLocation | null;
  dedupeKey: string;
}

/** Serializable result shown to the user. */
export interface DuplicateMatch {
  jobId: string;
  company: string;
  title: string;
  location: string;
  discoveryStatus: DiscoveryStatus;
  strength: DuplicateStrength;
  reasons: DuplicateReason[];
}

const STRENGTH_ORDER: Record<DuplicateStrength, number> = { exact: 0, likely: 1, possible: 2 };
const STOP_WORDS = new Set(["a", "an", "and", "the", "of", "for", "to", "in", "at", "on", "with"]);
const SIMILAR_TITLE_THRESHOLD = 0.75;

function titleTokens(title: string): Set<string> {
  return new Set(
    slugify(title)
      .split("-")
      .filter((t) => t.length > 0 && !STOP_WORDS.has(t)),
  );
}

/** Jaccard similarity of title words (0–1). */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

const sameLocation = (a: JobLocation | null, b: JobLocation | undefined) =>
  a !== null && b !== undefined && slugify(`${a.city} ${a.province ?? "canada"}`) === slugify(`${b.city} ${b.province ?? "canada"}`);

export function classifyDuplicates(probe: DuplicateProbe, candidates: readonly DuplicateCandidate[]): DuplicateMatch[] {
  const company = slugify(probe.company);
  const title = slugify(probe.title);
  const matches: DuplicateMatch[] = [];

  for (const c of candidates) {
    const reasons: DuplicateReason[] = [];
    if (probe.canonicalUrl && c.canonicalUrls.includes(probe.canonicalUrl)) {
      reasons.push({ kind: "same_url", strength: "exact", message: "The same posting URL is already saved." });
    }
    if (
      probe.ats &&
      c.atsPostings.some(
        (a) => a.provider === probe.ats?.provider && a.boardToken === probe.ats.boardToken && a.postingId === probe.ats.postingId,
      )
    ) {
      reasons.push({
        kind: "same_ats_posting",
        strength: "exact",
        message: `The same ${probe.ats.provider} posting (id ${probe.ats.postingId}) is already saved.`,
      });
    }
    const sameCompany = slugify(c.company) === company;
    if (sameCompany && c.dedupeKey === probe.dedupeKey) {
      reasons.push({
        kind: "same_identity",
        strength: "likely",
        message: "Same company, title and location as a saved job.",
      });
    } else if (sameCompany && slugify(c.title) === title) {
      reasons.push({
        kind: "same_company_title",
        strength: "possible",
        message: `Same company and title, listed in ${formatPrimaryLocation(c.locations)}.`,
      });
    } else if (
      sameCompany &&
      (probe.location === null || c.locations.length === 0 || sameLocation(probe.location, c.locations[0])) &&
      titleSimilarity(probe.title, c.title) >= SIMILAR_TITLE_THRESHOLD
    ) {
      reasons.push({ kind: "similar_title", strength: "possible", message: "Very similar title at the same company." });
    }

    if (reasons.length === 0) continue;
    const strength = reasons.reduce<DuplicateStrength>(
      (best, r) => (STRENGTH_ORDER[r.strength] < STRENGTH_ORDER[best] ? r.strength : best),
      "possible",
    );
    matches.push({
      jobId: c.jobId,
      company: c.company,
      title: c.title,
      location: formatPrimaryLocation(c.locations),
      discoveryStatus: c.discoveryStatus,
      strength,
      reasons,
    });
  }

  return matches.sort((a, b) => STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] || a.jobId.localeCompare(b.jobId));
}

/** Exact and likely duplicates block saving; possible ones need explicit confirmation. */
export function isBlocking(match: DuplicateMatch): boolean {
  return match.strength !== "possible";
}
