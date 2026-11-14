/**
 * Evolving search-query registry (Milestone 3C). Queries are generated from
 * bounded dimensions (ATS host × role category × employment type × place) and
 * stored in `discovery_queries` with their yield. Each run picks queries by:
 *   1. never-run queries first, spread across providers;
 *   2. then the best yield per request (new candidates, verified boards);
 *   3. low-yield queries cool down for longer; exhausted queries are skipped.
 * Pure functions here; persistence is in lib/discovery/run.ts.
 */
import type { AtsProvider } from "../types";

export interface QuerySeed {
  provider: AtsProvider;
  category: string;
  text: string;
}

/**
 * Public board hosts searched per provider. Workday career sites live on
 * per-tenant subdomains, so the registrable domain is searched (Tavily's
 * domain restriction includes subdomains; results are still re-checked by
 * the label-exact recogniser). Generic company sites have no host: their
 * queries are unrestricted and only careers-page URLs are kept.
 */
const SITES: Record<AtsProvider, string[]> = {
  greenhouse: ["job-boards.greenhouse.io", "boards.greenhouse.io"],
  lever: ["jobs.lever.co"],
  ashby: ["jobs.ashbyhq.com"],
  smartrecruiters: ["jobs.smartrecruiters.com"],
  workday: ["myworkdayjobs.com"],
  company_site: [],
};

const CATEGORIES: Record<string, string[]> = {
  software: ["software engineer", "software developer"],
  embedded: ["embedded software", "firmware"],
  systems: ["systems engineer"],
  security: ["security engineer", "cybersecurity"],
  data_ml: ["machine learning", "data engineer"],
};
const EMPLOYMENT = ["intern", "co-op", "new grad", "junior"];
const PLACES = ["Canada", "Toronto", "Vancouver", "Montreal", "Waterloo", "Ottawa"];

/** Every query the registry can hold (deterministic order). */
export function generateQueries(): QuerySeed[] {
  const out: QuerySeed[] = [];
  for (const [provider, sites] of Object.entries(SITES) as [AtsProvider, string[]][]) {
    for (const site of sites) {
      for (const [category, terms] of Object.entries(CATEGORIES)) {
        for (const term of terms) {
          out.push({ provider, category, text: `site:${site} "${term}" "Canada"` });
          for (const employment of EMPLOYMENT) out.push({ provider, category: `${category}:${employment}`, text: `site:${site} "${term}" "${employment}" "Canada"` });
        }
      }
      for (const place of PLACES) out.push({ provider, category: "engineering:place", text: `site:${site} "engineering" "${place}"` });
      for (const employment of ["intern", "co-op"]) out.push({ provider, category: `engineering:${employment}`, text: `site:${site} "engineering" "${employment}"` });
    }
  }
  // Generic company career pages: no site restriction; careers-page URLs only are kept.
  for (const [category, terms] of Object.entries(CATEGORIES)) {
    for (const employment of ["intern", "co-op", "new grad"]) {
      out.push({ provider: "company_site", category: `${category}:${employment}`, text: `"${terms[0]}" "${employment}" careers Canada` });
    }
  }
  for (const place of PLACES) out.push({ provider: "company_site", category: "engineering:place", text: `company careers "engineering intern" ${place}` });
  return out;
}

export interface QueryStats {
  id: string;
  provider: AtsProvider;
  text: string;
  runs: number;
  requests: number;
  newCandidates: number;
  verified: number;
  exhausted: boolean;
  lastRunAt: Date | null;
}

const DAY = 86_400_000;
export const COOLDOWN_MS = 7 * DAY;
export const LOW_YIELD_COOLDOWN_MS = 30 * DAY;

export function queryScore(q: Pick<QueryStats, "requests" | "newCandidates" | "verified">): number {
  return (q.newCandidates + 5 * q.verified) / Math.max(1, q.requests);
}

/** A query that has cost requests and found nothing new. */
export function isLowYield(q: Pick<QueryStats, "requests" | "newCandidates">): boolean {
  return q.requests >= 3 && q.newCandidates === 0;
}

/** Picks up to `limit` queries for this run (see module comment). */
export function selectQueries<T extends QueryStats>(queries: readonly T[], limit: number, now: Date): T[] {
  if (limit <= 0) return [];
  const due = queries.filter((q) => {
    if (q.exhausted) return false;
    if (!q.lastRunAt) return true;
    const age = now.getTime() - q.lastRunAt.getTime();
    return age >= (isLowYield(q) ? LOW_YIELD_COOLDOWN_MS : COOLDOWN_MS);
  });
  // Never-run queries, round-robin across providers so no ATS is starved.
  const fresh = due.filter((q) => q.runs === 0);
  const byProvider = new Map<string, T[]>();
  for (const q of fresh) byProvider.set(q.provider, [...(byProvider.get(q.provider) ?? []), q]);
  const interleaved: T[] = [];
  for (let i = 0; interleaved.length < fresh.length; i++) {
    for (const list of byProvider.values()) if (list[i]) interleaved.push(list[i]);
  }
  const seasoned = due
    .filter((q) => q.runs > 0)
    .sort((a, b) => Number(isLowYield(a)) - Number(isLowYield(b)) || queryScore(b) - queryScore(a) || a.text.localeCompare(b.text));
  // Mostly exploit proven queries, but keep exploring: alternate when both exist.
  const picked: T[] = [];
  let i = 0;
  let j = 0;
  while (picked.length < limit && (i < seasoned.length || j < interleaved.length)) {
    const takeSeasoned = picked.length % 2 === 0 ? i < seasoned.length && !isLowYield(seasoned[i]) : j >= interleaved.length;
    if (takeSeasoned && i < seasoned.length) picked.push(seasoned[i++]);
    else if (j < interleaved.length) picked.push(interleaved[j++]);
    else picked.push(seasoned[i++]);
  }
  return picked;
}
