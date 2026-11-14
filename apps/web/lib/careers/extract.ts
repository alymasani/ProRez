/**
 * Generic career-site extraction (Milestone 3D). Progressive strategies:
 *
 *   1. JSON-LD JobPosting on the careers page (and on each job page)
 *   2. Sitemaps (robots.txt `Sitemap:` and /sitemap.xml) when the page lists nothing
 *   3. Static HTML: job-detail links + pagination, then each job page
 *   4. Browser rendering (optional, bounded) only when 1–3 found nothing
 *   5. Otherwise: "unsupported" — explicit diagnostics, no invented jobs
 *
 * Every request goes through the SSRF-safe SiteFetcher (robots.txt honoured,
 * private addresses refused, size/time caps). Pages are read as text only.
 *
 * Completeness (whether absent jobs may be counted missing) is FALSE unless
 * the enumeration was demonstrably exhaustive: listing page(s) fetched, all
 * pagination followed with no unfollowable pagination left, no cap reached,
 * every job page fetched, no job page rejected, and every job backed by
 * structured JobPosting data. Static-heuristic, sitemap and rendered
 * enumerations are never treated as complete.
 */
import { createHash } from "node:crypto";
import { recognizeAtsUrl, type RecognizedAtsUrl } from "../boards/board-url";
import { findAtsLinks } from "../discovery/links";
import type { PageResult, SiteFetcher } from "../discovery/net";
import type { ExtractionStrategy, WorkArrangement } from "../types";
import type { ExtractionLimits, ProviderPosting } from "../ats/types";
import { extractJsonLd, type StructuredJob } from "./jsonld";
import { parseSitemap, sitemapsFromRobots } from "./sitemap";
import { canonicalJobUrl, extractDetail, findJobLinks, findNextPage, hasUnfollowablePagination, isJobDetailUrl, looksLikeJobDescription, looksLikeJobTitle, sameSite } from "./static";

export const GENERIC_DEFAULT_LIMITS: ExtractionLimits = { maxListingPages: 5, maxDetailPages: 40, maxRenders: 3, minIntervalMs: 1000 };

export interface ExtractedJob {
  postingId: string;
  title: string;
  url: string;
  description: string;
  locations: string[];
  countries: string[];
  remote: boolean;
  employmentType: string | null;
  identifier: string | null;
  datePosted: string | null;
  salary: string | null;
  applyUrl: string | null;
  /** Evidence-based signals (review prioritisation only — not a verification threshold). */
  signals: string[];
  /** structured = JSON-LD; static = heuristics. */
  source: "structured" | "static";
}

export interface CareerExtraction {
  status: "ok" | "empty" | "unsupported" | "blocked" | "routed";
  strategy: ExtractionStrategy | null;
  jobs: ExtractedJob[];
  complete: boolean;
  incompleteReason: string | null;
  /** ATS/Workday boards the page links or redirects to (route to their adapters). */
  routedTo: RecognizedAtsUrl[];
  companyName: string | null;
  finalUrl: string | null;
  pagesFetched: number;
  rendered: number;
  diagnostics: string[];
  /** Candidate links rejected as not being jobs (navigation, articles, invalid pages). */
  rejectedCandidates: number;
  /** First fetch failure when status is blocked. */
  failure: { failure: string; message: string } | null;
}

const MAX_DIAG = 30;

function postingIdFor(job: { identifier: string | null; url: string }, usedIds: Set<string>): string {
  const ident = job.identifier && /^[A-Za-z0-9][A-Za-z0-9._:~-]{0,120}$/.test(job.identifier) ? `id:${job.identifier}` : null;
  if (ident && !usedIds.has(ident)) return ident;
  // Stable URL identity (canonical, tracking parameters removed).
  const u = new URL(job.url);
  const key = `${u.pathname}${u.search}`;
  return key.length <= 180 ? `u:${key}` : `h:${createHash("sha256").update(key).digest("hex").slice(0, 32)}`;
}

function fromStructured(s: StructuredJob, fallbackUrl: string): Omit<ExtractedJob, "postingId"> | null {
  const url = canonicalJobUrl(s.url ?? fallbackUrl);
  if (!url) return null;
  const signals = ["json_ld_jobposting"];
  if (s.identifier) signals.push("identifier");
  if (looksLikeJobDescription(s.description)) signals.push("full_description");
  return {
    title: s.title.slice(0, 200), url, description: s.description, locations: s.locations, countries: s.countries, remote: s.remote,
    employmentType: s.employmentType, identifier: s.identifier, datePosted: s.datePosted, salary: s.salary, applyUrl: null, signals, source: "structured",
  };
}

export async function extractCareerSite(
  startUrl: string,
  site: SiteFetcher,
  options: { limits?: Partial<ExtractionLimits>; signal?: AbortSignal; allowRender?: boolean } = {},
): Promise<CareerExtraction> {
  const lim = { ...GENERIC_DEFAULT_LIMITS, ...options.limits };
  const signal = options.signal;
  const r: CareerExtraction = {
    status: "unsupported", strategy: null, jobs: [], complete: false, incompleteReason: null, routedTo: [], companyName: null,
    finalUrl: null, pagesFetched: 0, rendered: 0, diagnostics: [], rejectedCandidates: 0, failure: null,
  };
  const diag = (m: string) => r.diagnostics.length < MAX_DIAG && r.diagnostics.push(m);
  const incomplete: string[] = [];
  const fetch = async (url: string, xml = false): Promise<PageResult> => {
    r.pagesFetched++;
    return site.fetchPage(url, signal, xml ? { accept: "xml" } : undefined);
  };

  // --- Listing page
  const first = await fetch(startUrl);
  if (!first.ok) {
    r.status = "blocked";
    r.failure = { failure: first.failure, message: first.message };
    r.incompleteReason = first.message;
    diag(`Careers page: ${first.message}`);
    return r;
  }
  if (first.html === null) {
    const target = recognizeAtsUrl(first.atsRedirect);
    if (target) r.routedTo.push(target);
    r.status = "routed";
    r.finalUrl = first.finalUrl;
    diag(`Redirects to ${first.atsRedirect}.`);
    return r;
  }
  r.finalUrl = first.finalUrl;
  let listingHtml = first.html;
  r.routedTo = findAtsLinks(listingHtml, first.finalUrl);

  const byUrl = new Map<string, Omit<ExtractedJob, "postingId">>();
  const detailQueue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (url: string) => {
    const c = canonicalJobUrl(url);
    if (c && !queued.has(c) && !byUrl.has(c)) {
      queued.add(c);
      detailQueue.push(c);
    }
  };
  let strategy: ExtractionStrategy | null = null;
  const absorbListing = (html: string, pageUrl: string) => {
    const ld = extractJsonLd(html, pageUrl);
    r.companyName ??= ld.organization;
    if (ld.malformedBlocks) diag(`${ld.malformedBlocks} malformed JSON-LD block(s) on ${pageUrl}.`);
    for (const s of ld.jobs) {
      r.companyName ??= s.hiringOrganization;
      const j = fromStructured(s, pageUrl);
      if (!j) continue;
      // Listing JSON-LD often has a short summary: load the job page for the full text.
      if (j.url !== canonicalJobUrl(pageUrl) && !j.signals.includes("full_description")) enqueue(j.url);
      byUrl.set(j.url, j);
      strategy ??= "json_ld";
    }
    for (const link of findJobLinks(html, pageUrl)) enqueue(link.url);
  };

  // --- Strategies 1 + 3 on the listing, with pagination
  absorbListing(listingHtml, first.finalUrl);
  let pageUrl = first.finalUrl;
  for (let page = 1; ; page++) {
    const next = findNextPage(listingHtml, pageUrl);
    if (!next) {
      if (hasUnfollowablePagination(listingHtml)) incomplete.push("The careers page has pagination ProRez cannot follow.");
      break;
    }
    if (page >= lim.maxListingPages) {
      incomplete.push(`Stopped after ${lim.maxListingPages} listing pages.`);
      break;
    }
    const res = await fetch(next);
    if (!res.ok || res.html === null) {
      incomplete.push(`Listing page ${next} could not be read.`);
      break;
    }
    listingHtml = res.html;
    pageUrl = res.finalUrl;
    absorbListing(res.html, res.finalUrl);
  }

  // --- Strategy 2: sitemaps, only when the page itself listed nothing
  if (byUrl.size === 0 && detailQueue.length === 0 && r.routedTo.length === 0) {
    const fromSitemaps = await sitemapJobUrls(first.finalUrl, fetch, lim);
    if (fromSitemaps.length > 0) {
      strategy = "sitemap";
      incomplete.push("Jobs were enumerated from a sitemap, which may be stale or partial.");
      for (const u of fromSitemaps) enqueue(u);
    }
  }

  // --- Strategy 4: render the listing, only when nothing else worked
  let renderedListing = false;
  // Not when the page already routes to a supported board (its adapter is used instead).
  if (byUrl.size === 0 && detailQueue.length === 0 && r.routedTo.length === 0 && options.allowRender !== false && site.render && lim.maxRenders > 0) {
    r.rendered++;
    const res = await site.render(first.finalUrl, signal);
    if (res.ok && res.html) {
      renderedListing = true;
      absorbListing(res.html, res.finalUrl);
      for (const t of findAtsLinks(res.html, res.finalUrl)) if (!r.routedTo.some((x) => x.provider === t.provider && x.boardToken === t.boardToken)) r.routedTo.push(t);
      if (byUrl.size > 0 || detailQueue.length > 0) {
        strategy = "rendered";
        incomplete.push("Jobs were found only after browser rendering; the snapshot is not treated as complete.");
      }
    } else if (!res.ok) {
      diag(`Rendering failed: ${res.message}`);
    }
  }

  // --- Job pages (strategy 1 per page, else 3; render as a last resort)
  let detailFailures = 0;
  const pending = detailQueue.slice(0, lim.maxDetailPages);
  if (detailQueue.length > lim.maxDetailPages) incomplete.push(`Read ${lim.maxDetailPages} of ${detailQueue.length} job pages (per-sync limit).`);
  for (const url of pending) {
    if (signal?.aborted) break;
    let res = await fetch(url);
    if (res.ok && res.html === null) {
      const t = recognizeAtsUrl(res.atsRedirect);
      if (t && !r.routedTo.some((x) => x.provider === t.provider && x.boardToken === t.boardToken)) r.routedTo.push(t);
      r.rejectedCandidates++;
      continue;
    }
    if (!res.ok) {
      detailFailures++;
      diag(`Job page ${url}: ${res.message}`);
      continue;
    }
    let ld = extractJsonLd(res.html, res.finalUrl);
    r.companyName ??= ld.jobs[0]?.hiringOrganization ?? ld.organization;
    let extracted = pickJob(ld.jobs, res.finalUrl, url);
    if (!extracted) {
      const d = extractDetail(res.html, res.finalUrl);
      if ((!d.title || !looksLikeJobDescription(d.description)) && site.render && renderedListing && r.rendered < lim.maxRenders) {
        r.rendered++;
        const rr = await site.render(url, signal);
        if (rr.ok && rr.html) {
          res = rr;
          ld = extractJsonLd(rr.html, rr.finalUrl);
          extracted = pickJob(ld.jobs, rr.finalUrl, url);
        }
      }
      if (!extracted && res.ok && res.html) {
        const d2 = extractDetail(res.html, res.finalUrl);
        const listed = byUrl.get(url);
        const title = d2.title && looksLikeJobTitle(d2.title) ? d2.title : listed?.title && looksLikeJobTitle(listed.title) ? listed.title : null;
        if (title && looksLikeJobDescription(d2.description)) {
          extracted = {
            title, url, description: d2.description, locations: d2.location ? [d2.location] : (listed?.locations ?? []), countries: listed?.countries ?? [],
            remote: /\bremote\b/i.test(d2.location ?? ""), employmentType: listed?.employmentType ?? null, identifier: null, datePosted: null, salary: null,
            applyUrl: d2.applyUrl, signals: ["job_detail_url", "full_description", ...(d2.applyUrl ? ["apply_link"] : [])], source: "static",
          };
          strategy ??= "static_html";
        }
      }
    } else {
      strategy ??= "json_ld";
    }
    if (!extracted) {
      // Kept from the listing's JSON-LD if it had one; otherwise not a job we can vouch for.
      if (!byUrl.has(url)) {
        r.rejectedCandidates++;
        diag(`Not a recognisable job page: ${url}`);
      }
      continue;
    }
    const prior = byUrl.get(url);
    byUrl.set(extracted.url === url ? url : url, { ...extracted, url, description: extracted.description || prior?.description || "" });
  }
  if (detailFailures > 0) incomplete.push(`${detailFailures} job page${detailFailures === 1 ? "" : "s"} could not be read.`);
  if (r.rejectedCandidates > 0 && strategy !== "json_ld") incomplete.push(`${r.rejectedCandidates} linked page(s) could not be confirmed as jobs.`);

  // --- Result
  const used = new Set<string>();
  for (const [url, j] of byUrl) {
    const postingId = postingIdFor({ identifier: j.identifier, url }, used);
    if (used.has(postingId)) continue; // the same posting reached by two URLs
    used.add(postingId);
    r.jobs.push({ ...j, postingId });
  }
  r.strategy = strategy;
  if (r.jobs.length > 0) {
    r.status = "ok";
  } else if (r.routedTo.length > 0) {
    r.status = "routed";
  } else {
    r.status = "unsupported";
    diag("No job postings could be extracted (no JobPosting data, no recognisable job links, nothing after rendering).");
  }
  // Only structured data can prove a listing exhaustive: heuristic (static),
  // sitemap and rendered enumerations may silently miss postings.
  if (r.jobs.some((j) => j.source === "static")) incomplete.push("Some jobs were recognised heuristically from HTML, so the listing cannot be proven complete.");
  r.complete = r.status === "ok" && incomplete.length === 0 && strategy === "json_ld";
  r.incompleteReason = r.complete ? null : incomplete.join(" ") || (r.status === "ok" ? null : "No jobs were extracted.");
  if (r.status === "ok" && !r.complete && !r.incompleteReason) r.incompleteReason = "Listing completeness could not be demonstrated.";
  return r;
}

function pickJob(jobs: StructuredJob[], pageUrl: string, requested: string): Omit<ExtractedJob, "postingId"> | null {
  if (jobs.length === 0) return null;
  // A job page should describe one posting; prefer the one whose URL is this page.
  const match = jobs.find((j) => j.url && canonicalJobUrl(j.url) === requested) ?? (jobs.length === 1 ? jobs[0] : null);
  return match ? fromStructured(match, pageUrl) : null;
}

async function sitemapJobUrls(listingUrl: string, fetch: (url: string, xml?: boolean) => Promise<PageResult>, lim: ExtractionLimits): Promise<string[]> {
  const origin = new URL(listingUrl).origin;
  const sitemaps: string[] = [];
  const robots = await fetch(`${origin}/robots.txt`, true);
  if (robots.ok && robots.html) sitemaps.push(...sitemapsFromRobots(robots.html).filter((u) => sameSite(new URL(u).hostname, new URL(listingUrl).hostname)));
  if (sitemaps.length === 0) sitemaps.push(`${origin}/sitemap.xml`);
  const out = new Set<string>();
  const visited = new Set<string>();
  const queue = [...sitemaps];
  // Bounded: at most 4 sitemap documents; career-looking child sitemaps first.
  while (queue.length > 0 && visited.size < 4 && out.size < lim.maxDetailPages * 5) {
    queue.sort((a, b) => Number(/job|career|position|opening/i.test(b)) - Number(/job|career|position|opening/i.test(a)));
    const url = queue.shift()!;
    if (visited.has(url)) continue;
    visited.add(url);
    const res = await fetch(url, true);
    if (!res.ok || !res.html) continue;
    const parsed = parseSitemap(res.html);
    if (parsed.kind === "index") {
      for (const u of parsed.urls) if (sameSite(new URL(u).hostname, new URL(listingUrl).hostname)) queue.push(u);
      continue;
    }
    for (const u of parsed.urls) {
      if (sameSite(new URL(u).hostname, new URL(listingUrl).hostname) && isJobDetailUrl(u, listingUrl)) out.add(u);
    }
  }
  return [...out];
}

/** Extraction → provider postings for the 3B sync pipeline. */
export function toProviderPostings(jobs: readonly ExtractedJob[]): ProviderPosting[] {
  return jobs.map((j) => {
    const workplace: WorkArrangement | null = j.remote ? "remote" : null;
    const locationTexts = [...j.locations];
    if (j.remote && j.countries.length > 0) locationTexts.push(...j.countries.map((c) => `Remote, ${c}`));
    return {
      postingId: j.postingId,
      title: j.title,
      url: j.url,
      descriptionText: j.description,
      locationTexts: locationTexts.slice(0, 20),
      structuredLocations: j.countries.slice(0, 10).map((country) => ({ country, region: null, city: null, remote: j.remote, hybrid: null })),
      workplace,
      employmentType: j.employmentType,
      department: null,
      publishedAt: j.datePosted && !Number.isNaN(Date.parse(j.datePosted)) ? new Date(j.datePosted).toISOString() : null,
      publishedAtKind: j.datePosted && !Number.isNaN(Date.parse(j.datePosted)) ? "last_published" : "none",
      metadata: { identifier: j.identifier, salary: j.salary, applyUrl: j.applyUrl, extraction: j.source, signals: j.signals },
    };
  });
}
