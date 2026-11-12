/**
 * Builds discovery dependencies from the environment for the worker and CLI.
 * Recorded (fixture) search/site responses are allowed only against a
 * disposable *_e2e / *_test database, like ATS fixtures (lib/ats/http.ts).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "../generated/prisma/client";
import { isTestDatabase, resolveTransport } from "../ats/http";
import { discoveryConfigFromEnv } from "./config";
import { checkSiteUrl, createSafeSiteFetcher, type PageResult, type SiteFetcher } from "./net";
import { recognizeAtsUrl } from "../boards/board-url";
import type { DiscoveryDeps, DiscoveryLogger } from "./run";
import { createBraveSearchProvider, createTavilySearchProvider, type SearchProvider } from "./search";

type Env = Readonly<Record<string, string | undefined>>;

/** Site pages from `<dir>/<host><path>.html` (path "/" → "index"); `<file>.redirect` holds a Location. */
export function createFixtureSiteFetcher(dir: string): SiteFetcher {
  let requests = 0;
  return {
    get requests() {
      return requests;
    },
    async fetchPage(url): Promise<PageResult> {
      const checked = checkSiteUrl(url);
      if (!checked.ok) return { ok: false, url, failure: "blocked_url", message: checked.reason };
      requests++;
      const base = path.join(dir, checked.url.hostname, checked.url.pathname.replace(/\/$/, "") || "/index");
      try {
        const location = (await readFile(`${base}.redirect`, "utf8")).trim();
        return recognizeAtsUrl(location)
          ? { ok: true, url, finalUrl: url, status: 302, html: null, redirects: [location], atsRedirect: location }
          : { ok: false, url, failure: "http_error", message: "redirect" };
      } catch {
        /* not a redirect */
      }
      try {
        return { ok: true, url, finalUrl: url, status: 200, html: await readFile(`${base}.html`, "utf8"), redirects: [] };
      } catch {
        return { ok: false, url, failure: "http_error", message: "HTTP 404" };
      }
    },
  };
}

/** Search results from `<dir>/<slug of query>__<page>.json` ({ "urls": [...] }); missing file = no results. */
export function createFixtureSearchProvider(dir: string): SearchProvider {
  let requests = 0;
  return {
    name: "fixtures",
    get requests() {
      return requests;
    },
    get credits() {
      return 0;
    },
    async search(query, page) {
      requests++;
      const slug = query.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      try {
        const data = JSON.parse(await readFile(path.join(dir, `${slug}__${page}.json`), "utf8")) as { urls?: string[]; more?: boolean };
        return { urls: data.urls ?? [], moreAvailable: data.more === true, requests: 1, credits: 0 };
      } catch {
        return { urls: [], moreAvailable: false, requests: 1, credits: 0 };
      }
    },
  };
}

export function discoveryDepsFromEnv(prisma: PrismaClient, env: Env, log?: DiscoveryLogger): () => DiscoveryDeps {
  const config = discoveryConfigFromEnv(env);
  const testDb = isTestDatabase(env);
  const siteFixtures = env.PROREZ_DISCOVERY_SITE_FIXTURES;
  const searchFixtures = env.PROREZ_DISCOVERY_SEARCH_FIXTURES;
  if ((siteFixtures || searchFixtures) && !testDb) throw new Error("Discovery fixtures are only allowed against a *_e2e or *_test database.");
  const atsTransport = resolveTransport(env);
  return () => ({
    prisma,
    config: searchFixtures
      ? config.searchProvider === "tavily"
        ? { ...config, tavilyApiKey: config.tavilyApiKey ?? "fixtures" }
        : { ...config, braveApiKey: config.braveApiKey ?? "fixtures" }
      : config,
    atsTransport,
    // A fresh fetcher per run: robots.txt is re-read and request counts start at zero.
    siteFetcher: siteFixtures ? createFixtureSiteFetcher(siteFixtures) : createSafeSiteFetcher(),
    search: searchFixtures
      ? createFixtureSearchProvider(searchFixtures)
      : config.searchProvider === "tavily" && config.tavilyApiKey
        ? createTavilySearchProvider(config.tavilyApiKey, { minIntervalMs: config.searchMinIntervalMs })
        : config.searchProvider === "brave" && config.braveApiKey
          ? createBraveSearchProvider(config.braveApiKey, { minIntervalMs: config.searchMinIntervalMs })
          : null,
    log,
  });
}
