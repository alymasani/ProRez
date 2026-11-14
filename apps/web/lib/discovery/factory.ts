/**
 * Builds discovery dependencies from the environment for the worker and CLI.
 * Recorded (fixture) search/site responses are allowed only against a
 * disposable *_e2e / *_test database, like ATS fixtures (lib/ats/http.ts).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
export { createFixtureSiteFetcher } from "./net";
import type { PrismaClient } from "../generated/prisma/client";
import { isTestDatabase, resolveTransport } from "../ats/http";
import { discoveryConfigFromEnv } from "./config";
import { createFixtureSiteFetcher, createSafeSiteFetcher } from "./net";
import { rendererFromEnv } from "../careers/render";
import type { DiscoveryDeps, DiscoveryLogger } from "./run";
import { createBraveSearchProvider, createTavilySearchProvider, type SearchProvider } from "./search";

type Env = Readonly<Record<string, string | undefined>>;

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
  // Test and e2e databases never spend real search credits: live search needs an explicit opt-in there.
  const liveSearchBlocked = testDb && !searchFixtures && env.PROREZ_ALLOW_LIVE_SEARCH_IN_TESTS !== "1";
  return () => ({
    prisma,
    config: searchFixtures
      ? config.searchProvider === "tavily"
        ? { ...config, tavilyApiKey: config.tavilyApiKey ?? "fixtures" }
        : { ...config, braveApiKey: config.braveApiKey ?? "fixtures" }
      : config,
    atsTransport,
    // A fresh fetcher per run: robots.txt is re-read and request counts start at zero.
    siteFetcher: siteFixtures ? createFixtureSiteFetcher(siteFixtures) : createSafeSiteFetcher({ renderer: rendererFromEnv(env) }),
    search: searchFixtures
      ? createFixtureSearchProvider(searchFixtures)
      : liveSearchBlocked
        ? null
        : config.searchProvider === "tavily" && config.tavilyApiKey
        ? createTavilySearchProvider(config.tavilyApiKey, { minIntervalMs: config.searchMinIntervalMs })
        : config.searchProvider === "brave" && config.braveApiKey
          ? createBraveSearchProvider(config.braveApiKey, { minIntervalMs: config.searchMinIntervalMs })
          : null,
    log,
  });
}
