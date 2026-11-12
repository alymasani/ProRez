/**
 * Link and domain extraction for discovery. Pure text processing — HTML is
 * never parsed into a DOM or executed; only URL-bearing attributes are read.
 */
import { recognizeAtsUrl, type RecognizedAtsUrl } from "../boards/board-url";
import { decodeEntities } from "../ats/html";

const ATTR = /\b(?:href|src|data-src|data-href|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const META_REFRESH = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'>\s]+)/gi;
const MAX_LINKS = 5_000;

/** Absolute http(s) URLs referenced by link-like attributes, in document order. */
export function extractLinks(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    if (!raw || out.length >= MAX_LINKS) return;
    try {
      const url = new URL(decodeEntities(raw.trim()), baseUrl);
      if (url.protocol !== "https:" && url.protocol !== "http:") return;
      const s = url.toString();
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    } catch {
      /* not a URL */
    }
  };
  for (const m of html.matchAll(ATTR)) add(m[1] ?? m[2] ?? m[3]);
  for (const m of html.matchAll(META_REFRESH)) add(m[1]);
  return out;
}

/** Recognised ATS boards linked from a page (deduplicated by board identity). */
export function findAtsLinks(html: string, baseUrl: string): RecognizedAtsUrl[] {
  const byBoard = new Map<string, RecognizedAtsUrl>();
  for (const link of extractLinks(html, baseUrl)) {
    const r = recognizeAtsUrl(link);
    if (r && !byBoard.has(`${r.provider}:${r.boardToken}`)) byBoard.set(`${r.provider}:${r.boardToken}`, r);
  }
  return [...byBoard.values()];
}

/** Lowercase host without a leading "www.". */
export function siteDomain(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/** Third-party domains that are never a company's own site. */
const NOT_COMPANY = [
  "greenhouse.io", "lever.co", "ashbyhq.com", "smartrecruiters.com", "linkedin.com", "twitter.com", "x.com", "facebook.com",
  "instagram.com", "youtube.com", "youtu.be", "tiktok.com", "glassdoor.com", "glassdoor.ca", "indeed.com", "indeed.ca", "google.com",
  "goo.gl", "forms.gle", "bit.ly", "t.co", "medium.com", "wikipedia.org", "github.com", "gitlab.com", "notion.site", "notion.so",
  "eeoc.gov", "dol.gov", "canada.ca", "gc.ca", "apple.com", "microsoft.com", "workday.com", "myworkdayjobs.com", "icims.com",
  "builtin.com", "wellfound.com", "angel.co", "crunchbase.com", "calendly.com", "zoom.us", "typeform.com", "hubspot.com",
  "mailchimp.com", "cloudflare.com", "amazonaws.com", "cloudfront.net", "googleapis.com", "gstatic.com", "w3.org", "schema.org",
  "adobe.com", "bamboohr.com", "jobvite.com", "breezy.hr", "recruitee.com", "workable.com", "teamtailor.com", "ycombinator.com",
];

export function isThirdPartyDomain(domain: string): boolean {
  const d = siteDomain(domain);
  return NOT_COMPANY.some((n) => d === n || d.endsWith(`.${n}`)) || /\.(gov|edu|mil)(\.[a-z]{2})?$/.test(d);
}

const URL_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`)\]]+/gi;
const BARE_DOMAIN_IN_TEXT = /\b(?:www\.)?([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.(?:com|ca|io|ai|co|net|org|tech|dev|app))\b/gi;

/**
 * Candidate company domains mentioned in a board's own content (posting
 * descriptions, board intro), most frequent first. A HINT only — never proof
 * of ownership; verification must find the site linking back to the board.
 */
export function candidateDomains(texts: readonly string[], limit = 3): string[] {
  const counts = new Map<string, number>();
  const bump = (host: string) => {
    const d = siteDomain(host);
    if (!d.includes(".") || isThirdPartyDomain(d)) return;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  };
  for (const text of texts) {
    for (const m of text.matchAll(URL_IN_TEXT)) {
      try {
        bump(new URL(m[0].replace(/[.,;:!?]+$/, "")).hostname);
      } catch {
        /* ignore */
      }
    }
    // Bare domains, including e-mail domains (jobs@acme.com) — still only hints.
    for (const m of text.matchAll(BARE_DOMAIN_IN_TEXT)) bump(m[1]);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([d]) => d);
}
