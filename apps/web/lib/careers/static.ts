/**
 * Strategy 3 — static HTML heuristics. Pure text processing (no DOM, nothing
 * executed). Reusable signals only; no site-specific selectors live here —
 * per-site hints belong in an extraction profile (board `source_config`).
 *
 *  - findJobLinks: anchors on a listing page that look like job-detail links
 *    (job-like path with a further segment or an id, title-like text), on the
 *    same site, excluding navigation/marketing/article links.
 *  - findNextPage: rel="next" / "Next" / ?page=N+1 pagination.
 *  - extractDetail: title, description, location, apply link from a job page.
 */
import { decodeEntities, htmlToText } from "../ats/html";
import { registrableDomain } from "../discovery/links";

const ANCHOR = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
const HREF = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/** Path segments that introduce job listings or postings. */
export const JOB_SEGMENT = /^(jobs?|careers?|career-opportunities|positions?|open-positions|openings?|opportunit(?:y|ies)|vacanc(?:y|ies)|roles?|postings?|job-?details?|job-?posting|requisitions?|join-us|work-with-us|apply)$/i;
/** Common careers-page paths (discovery hints only — not proof of jobs). */
export const CAREER_PATH = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(careers?|jobs|join-us|work-with-us|opportunities|open-positions|about\/careers|company\/careers)\/?$/i;

const ROLE_WORD = /\b(engineer|engineering|developer|intern(ship)?|co-?op|analyst|manager|designer|scientist|specialist|technician|technologist|coordinator|associate|lead|architect|consultant|administrator|officer|representative|assistant|programmer|student|researcher|director|operator|advisor|accountant|agent|supervisor|nurse|teacher|graduate|apprentice|trainee|planner|tester|writer|editor|strategist|head of|vp\b)/i;
const NAV_TEXT = /^(home|about( us)?|blog|news|press|contact( us)?|login|log in|sign in|sign up|register|privacy|terms|cookies?|careers?|jobs|all jobs|view all( jobs| openings| positions)?|see all|open positions|search jobs|join us|life at .*|benefits|culture|our team|teams?|students?|graduates?|internships?|faq|learn more|read more|apply( now)?|next|previous|back|menu|skip to .*|english|français|francais)$/i;
const ASSET = /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3|css|js|ico|xml|json|rss)$/i;
const ARTICLE = /\/(blog|news|press|stories|story|articles?|insights|events?|webinars?|podcasts?|resources|tag|category|author)\//i;

function hrefOf(attrs: string): string | null {
  const m = HREF.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

export function anchorText(inner: string): string {
  return decodeEntities(inner.replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

export function sameSite(a: string, b: string): boolean {
  return registrableDomain(a) === registrableDomain(b);
}

/** Canonical form for comparing job URLs: no fragment, no tracking params, no trailing slash. */
export function canonicalJobUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|gclid|fbclid|ref$|source$|src$|lang$|locale$)/i.test(k)) u.searchParams.delete(k);
    u.searchParams.sort();
    u.protocol = "https:";
    u.hostname = u.hostname.toLowerCase();
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return null;
  }
}

/** Does this URL look like an individual job posting (not a listing or article)? */
export function isJobDetailUrl(raw: string, listingUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (ASSET.test(u.pathname) || ARTICLE.test(u.pathname)) return false;
  const listing = new URL(listingUrl);
  if (u.hostname === listing.hostname && u.pathname.replace(/\/+$/, "") === listing.pathname.replace(/\/+$/, "") && !hasJobIdParam(u)) return false;
  if (hasJobIdParam(u)) return true;
  const segs = u.pathname.split("/").filter(Boolean);
  const i = segs.findIndex((s) => JOB_SEGMENT.test(s));
  if (i === -1) {
    // Under the listing's own path (e.g. /careers → /careers/backend-intern).
    const base = listing.pathname.replace(/\/+$/, "");
    return base.length > 1 && u.pathname.startsWith(`${base}/`) && segs.length > base.split("/").filter(Boolean).length && !JOB_SEGMENT.test(segs[segs.length - 1]);
  }
  const rest = segs.slice(i + 1);
  if (rest.length === 0) return false;
  const last = rest[rest.length - 1];
  // "/jobs/search", "/careers/students", "/jobs/teams" are sections, not postings.
  if (/^(search|results|all|teams?|departments?|locations?|students?|graduates?|benefits|culture|faq|apply|login|alerts?|saved|page|\d{1,2})$/i.test(last)) return false;
  return true;
}

function hasJobIdParam(u: URL): boolean {
  return [...u.searchParams.keys()].some((k) => /^(gh_jid|jobid|job_id|jid|job|posting|postingid|reqid|requisitionid|id|vacancyid|pid)$/i.test(k)) && [...u.searchParams.values()].some((v) => /^[A-Za-z0-9-]{3,64}$/.test(v));
}

export interface JobLink {
  url: string;
  text: string;
}

/** Job-detail links on a listing page, deduplicated by canonical URL, in page order. */
export function findJobLinks(html: string, pageUrl: string, limit = 500): JobLink[] {
  const out: JobLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(ANCHOR)) {
    if (out.length >= limit) break;
    const href = hrefOf(m[1]);
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href.trim())) continue;
    let abs: string;
    try {
      abs = new URL(decodeEntities(href.trim()), pageUrl).toString();
    } catch {
      continue;
    }
    if (!sameSite(new URL(abs).hostname, new URL(pageUrl).hostname)) continue;
    const text = anchorText(m[2]).slice(0, 300);
    if (NAV_TEXT.test(text)) continue;
    if (!isJobDetailUrl(abs, pageUrl)) continue;
    // Title-like text: a role word, or (for id-style URLs) at least a few words.
    const firstLine = text.split(/ {2,}|\n/)[0] ?? text;
    if (!(ROLE_WORD.test(text) || (/\d{3,}|[0-9a-f]{8}-/i.test(abs) && firstLine.split(" ").length >= 2 && firstLine.length <= 120))) continue;
    const canonical = canonicalJobUrl(abs);
    if (!canonical || seen.has(canonical)) continue;
    seen.add(canonical);
    out.push({ url: canonical, text });
  }
  return out;
}

/** The next listing page, when the page paginates (same site). */
export function findNextPage(html: string, pageUrl: string): string | null {
  const rel = /<(?:a|link)\b[^>]*\brel\s*=\s*["']?next["']?[^>]*>/i.exec(html);
  const candidates: string[] = [];
  if (rel) {
    const h = hrefOf(rel[0]);
    if (h) candidates.push(h);
  }
  for (const m of html.matchAll(ANCHOR)) {
    const t = anchorText(m[2]).toLowerCase();
    if (/^(next|next page|suivant|›|»|>)$/.test(t) || /\baria-label\s*=\s*["']next/i.test(m[1])) {
      const h = hrefOf(m[1]);
      if (h) candidates.push(h);
    }
  }
  const current = new URL(pageUrl);
  for (const c of candidates) {
    try {
      const u = new URL(decodeEntities(c), pageUrl);
      if (!sameSite(u.hostname, current.hostname) || u.toString() === current.toString()) continue;
      if (u.hash && u.toString().split("#")[0] === pageUrl.split("#")[0]) continue;
      return u.toString();
    } catch {
      /* skip */
    }
  }
  return null;
}

/** Does the page offer pagination we could not follow (numbered links / load more)? */
export function hasUnfollowablePagination(html: string): boolean {
  return /\bload more\b|\bshow more (jobs|results|positions)\b|data-page=|class=["'][^"']*pagination/i.test(html);
}

export interface DetailExtraction {
  title: string | null;
  description: string;
  location: string | null;
  applyUrl: string | null;
}

const MAIN = /<(main|article)\b[^>]*>([\s\S]*?)<\/\1>/i;
const ROLE_MAIN = /<(div|section)\b[^>]*role\s*=\s*["']main["'][^>]*>([\s\S]*)/i;

/** Title, description, location and apply link from a job page without structured data. */
export function extractDetail(html: string, pageUrl: string): DetailExtraction {
  const og = /<meta[^>]+property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html) ?? /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*property\s*=\s*["']og:title["']/i.exec(html);
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = (h1 ? anchorText(h1[1]) : null) || (og ? decodeEntities(og[1]).trim() : null);
  const body = (MAIN.exec(html)?.[2] ?? ROLE_MAIN.exec(html)?.[2] ?? html)
    .replace(/<(header|nav|footer|aside|form)\b[\s\S]*?<\/\1>/gi, " ");
  const description = htmlToText(body).slice(0, 60_000);
  const loc = /(?:^|\n)\s*(?:location|locations|lieu|office|based in)\s*[:\-–]\s*([^\n]{2,120})/i.exec(description);
  let applyUrl: string | null = null;
  for (const m of html.matchAll(ANCHOR)) {
    if (/\bapply\b|postuler/i.test(anchorText(m[2]))) {
      const h = hrefOf(m[1]);
      try {
        if (h) {
          const u = new URL(decodeEntities(h), pageUrl);
          if (u.protocol === "https:" || u.protocol === "http:") {
            applyUrl = u.toString();
            break;
          }
        }
      } catch {
        /* skip */
      }
    }
  }
  return { title: title ? title.slice(0, 200) : null, description, location: loc ? loc[1].trim() : null, applyUrl };
}

/** Enough evidence that a page's text is a job description (not marketing copy). */
export function looksLikeJobDescription(text: string): boolean {
  if (text.length < 300) return false;
  const signals = [/responsibilit|what you('|’)ll do|you will|duties|your role|the role/i, /qualification|requirement|what you bring|you have|skills|experience with|must have/i, /apply|application|candidate|hiring|position/i];
  return signals.filter((r) => r.test(text)).length >= 2;
}

/**
 * Category, team and programme pages ("Software Engineers", "Interns &
 * Graduates", "Join our Internships Team - Careers at X") look like jobs to
 * naive heuristics; observed live on real careers sites. Rejected here.
 */
const CATEGORY_TITLE = /\b(team|teams|careers? at|join (our|us|the)|life at|programs?|programmes?|opportunities|positions|openings|roles|jobs|students|graduates|interns|internships|engineers|developers|managers|analysts|designers|scientists|specialists|leaders)\b\s*[-–|:]?\s*$|&|\b(join our|careers at|life at|working at|work with us|meet the)\b/i;

export function looksLikeJobTitle(text: string): boolean {
  return text.length >= 3 && text.length <= 150 && ROLE_WORD.test(text) && !NAV_TEXT.test(text) && !CATEGORY_TITLE.test(text);
}
