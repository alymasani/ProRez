/**
 * Strategy 2 — sitemaps. Parses <urlset> and <sitemapindex> documents as text
 * (no XML entity expansion, no DTDs: a regex over <loc> elements only), and
 * reads `Sitemap:` lines from robots.txt. Bounded in size and count.
 */
import { decodeEntities } from "../ats/html";

export interface ParsedSitemap {
  kind: "urlset" | "index" | "unknown";
  urls: string[];
}

const LOC = /<loc>\s*([\s\S]*?)\s*<\/loc>/gi;
export const MAX_SITEMAP_URLS = 50_000;

export function parseSitemap(xml: string): ParsedSitemap {
  const head = xml.slice(0, 2000).toLowerCase();
  const kind = head.includes("<sitemapindex") ? "index" : head.includes("<urlset") ? "urlset" : "unknown";
  const urls: string[] = [];
  for (const m of xml.matchAll(LOC)) {
    if (urls.length >= MAX_SITEMAP_URLS) break;
    const raw = decodeEntities(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, "").trim());
    try {
      const u = new URL(raw);
      if (u.protocol === "https:" || u.protocol === "http:") urls.push(u.toString());
    } catch {
      /* skip */
    }
  }
  return { kind, urls };
}

/** `Sitemap:` URLs declared in robots.txt (absolute only). */
export function sitemapsFromRobots(robots: string): string[] {
  const out: string[] = [];
  for (const line of robots.split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (m) {
      try {
        out.push(new URL(m[1]).toString());
      } catch {
        /* skip */
      }
    }
  }
  return out.slice(0, 20);
}
