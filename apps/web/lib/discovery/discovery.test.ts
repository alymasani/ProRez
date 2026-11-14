import { describe, expect, it } from "vitest";
import { canTransition, CANDIDATE_STATUSES } from "./candidates";
import { DEFAULT_DISCOVERY_CONFIG, discoveryConfigFromEnv, searchUnavailableReason } from "./config";
import { crawlDate, parseImportLine } from "./import";
import { candidateDomains, extractLinks, findAtsLinks, isThirdPartyDomain } from "./links";
import { checkSiteUrl, createSafeSiteFetcher, createVettedLookup, isPublicAddress, robotsAllows } from "./net";
import { COOLDOWN_MS, generateQueries, isLowYield, selectQueries, type QueryStats } from "./queries";
import { createBraveSearchProvider, createBraveTransport, createTavilySearchProvider, domainsFromQuery, parseBraveResponse, parseTavilyResponse } from "./search";
import { nameFromDomain } from "./verify";

describe("query registry", () => {
  const all = generateQueries();
  it("is bounded, unique and covers every provider (ATS, Workday, company pages) and every focus area", () => {
    expect(all.length).toBeGreaterThan(100);
    expect(all.length).toBeLessThan(1000);
    expect(new Set(all.map((q) => q.text)).size).toBe(all.length);
    expect(new Set(all.map((q) => q.provider))).toEqual(new Set(["greenhouse", "lever", "ashby", "smartrecruiters", "workday", "company_site"]));
    expect(all.some((q) => q.provider === "workday" && q.text.startsWith("site:myworkdayjobs.com "))).toBe(true);
    for (const term of ["software engineer", "embedded software", "systems engineer", "cybersecurity", "machine learning", "co-op", "intern"]) {
      expect(all.some((q) => q.text.includes(`"${term}"`))).toBe(true);
    }
    // Every provider query is domain-restricted; generic careers queries are not (no host to restrict to).
    expect(all.filter((q) => q.provider !== "company_site").every((q) => /^site:[a-z.-]+ /.test(q.text))).toBe(true);
    expect(all.filter((q) => q.provider === "company_site").every((q) => !q.text.includes("site:"))).toBe(true);
  });

  const q = (over: Partial<QueryStats>): QueryStats => ({ id: over.text ?? "x", provider: "lever", text: "x", runs: 0, requests: 0, newCandidates: 0, verified: 0, exhausted: false, lastRunAt: null, ...over });
  const now = new Date("2026-11-20T00:00:00Z");

  it("tries never-run queries round-robin across providers", () => {
    const picked = selectQueries(
      [q({ text: "g1", provider: "greenhouse" }), q({ text: "g2", provider: "greenhouse" }), q({ text: "l1", provider: "lever" }), q({ text: "a1", provider: "ashby" })],
      3,
      now,
    );
    expect(picked.map((p) => p.provider)).toEqual(["greenhouse", "lever", "ashby"]);
  });

  it("prefers productive queries, cools down recent ones and pushes low-yield ones last", () => {
    const recent = q({ text: "recent", runs: 1, requests: 1, newCandidates: 9, lastRunAt: new Date(now.getTime() - 60_000) });
    const good = q({ text: "good", runs: 2, requests: 2, newCandidates: 6, verified: 2, lastRunAt: new Date(now.getTime() - COOLDOWN_MS) });
    const dud = q({ text: "dud", runs: 3, requests: 3, newCandidates: 0, lastRunAt: new Date(now.getTime() - 40 * 86_400_000) });
    const exhausted = q({ text: "done", runs: 1, requests: 1, exhausted: true, lastRunAt: null });
    expect(isLowYield(dud)).toBe(true);
    expect(selectQueries([recent, dud, good, exhausted], 5, now).map((p) => p.text)).toEqual(["good", "dud"]);
    expect(selectQueries([good], 0, now)).toEqual([]);
  });
});

describe("Brave search provider", () => {
  it("keeps only result URLs from a valid response; empty results are valid", () => {
    expect(parseBraveResponse({ web: { results: [{ url: "https://jobs.lever.co/a", title: "T", description: "S" }, { title: "no url" }] }, query: { more_results_available: true } })).toEqual({
      urls: ["https://jobs.lever.co/a"],
      moreAvailable: true,
    });
    expect(parseBraveResponse({ query: {} })).toEqual({ urls: [], moreAvailable: false });
  });

  it("rejects invalid responses", () => {
    expect(() => parseBraveResponse(null)).toThrow(/not an object/);
    expect(() => parseBraveResponse({ web: { results: "nope" } })).toThrow(/no results list/);
  });

  it("sends the key only to the Brave API host, as a header", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    const fetchImpl = (async (url: URL, init: RequestInit) => {
      calls.push({ url: String(url), headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ web: { results: [] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = createBraveTransport("secret-key", fetchImpl);
    await t.getJson("https://api.search.brave.com/res/v1/web/search?q=x", {});
    expect(calls[0].headers["x-subscription-token"]).toBe("secret-key");
    expect(calls[0].url).not.toContain("secret-key");
    await expect(t.getJson("https://evil.example/steal", {})).rejects.toMatchObject({ code: "blocked_host" });
    expect(calls).toHaveLength(1);
  });

  it("reports a rejected key and retries rate limits with backoff, counting every request", async () => {
    let n = 0;
    const statuses = [429, 200];
    const fetchImpl = (async () => {
      const status = statuses[n++] ?? 200;
      return new Response(JSON.stringify({ web: { results: [{ url: "https://jobs.ashbyhq.com/acme" }] } }), { status, headers: { "retry-after": "1" } });
    }) as unknown as typeof fetch;
    const provider = createBraveSearchProvider("k", { fetchImpl, minIntervalMs: 0, retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2_000 }, sleep: async () => undefined });
    const page = await provider.search('site:jobs.ashbyhq.com "software"', 0);
    expect(page.urls).toEqual(["https://jobs.ashbyhq.com/acme"]);
    expect(provider.requests).toBe(2);
    const denied = createBraveSearchProvider("bad", { fetchImpl: (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch, minIntervalMs: 0 });
    await expect(denied.search("x", 0)).rejects.toMatchObject({ code: "invalid_board" });
  });
});

describe("Tavily search provider", () => {
  it("parses empty and URL-only results and rejects invalid responses", () => {
    expect(parseTavilyResponse({ results: [], usage: { credits: 1 } })).toEqual({ urls: [], moreAvailable: false, credits: 1 });
    expect(parseTavilyResponse({ results: [{ url: "https://jobs.lever.co/acme", content: "discard me" }, { title: "missing" }] })).toEqual({
      urls: ["https://jobs.lever.co/acme"], moreAvailable: false, credits: 1,
    });
    expect(() => parseTavilyResponse({ results: "bad" })).toThrow(/results list/);
  });

  it("uses basic search, bearer auth and domain restrictions without putting the key in the URL", async () => {
    let call: { url: string; init: RequestInit } | undefined;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      call = { url, init };
      return new Response(JSON.stringify({ results: [{ url: "https://jobs.ashbyhq.com/acme" }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = createTavilySearchProvider("tvly-secret", { fetchImpl, minIntervalMs: 0 });
    await expect(provider.search('site:jobs.ashbyhq.com "software"', 0)).resolves.toMatchObject({ urls: ["https://jobs.ashbyhq.com/acme"], moreAvailable: false });
    expect(call?.url).not.toContain("tvly-secret");
    expect((call?.init.headers as Record<string, string>).authorization).toBe("Bearer tvly-secret");
    expect(JSON.parse(String(call?.init.body))).toMatchObject({ search_depth: "basic", include_domains: ["jobs.ashbyhq.com"], include_raw_content: false, include_usage: true });
    expect(provider).toMatchObject({ requests: 1, credits: 1 });
    expect(domainsFromQuery("site:boards.greenhouse.io x site:jobs.lever.co")).toEqual(["boards.greenhouse.io", "jobs.lever.co"]);
  });

  it.each([[429, "rate_limited"], [432, "quota_exhausted"], [433, "quota_exhausted"]] as const)("handles HTTP %i as %s", async (status, code) => {
    const provider = createTavilySearchProvider("k", {
      fetchImpl: (async () => new Response("{}", { status })) as unknown as typeof fetch,
      minIntervalMs: 0,
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    });
    await expect(provider.search("x", 0)).rejects.toMatchObject({ code });
  });

  it("does not retry past the caller's remaining request budget", async () => {
    const provider = createTavilySearchProvider("k", {
      fetchImpl: (async () => new Response("{}", { status: 429 })) as unknown as typeof fetch,
      minIntervalMs: 0,
      retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 },
      sleep: async () => undefined,
    });
    await expect(provider.search("x", 0, undefined, 1)).rejects.toMatchObject({ code: "rate_limited" });
    expect(provider.requests).toBe(1);
    expect(provider.credits).toBe(0);
  });

  it("retries a server error within bounds and charges only the successful basic search", async () => {
    let calls = 0;
    const provider = createTavilySearchProvider("k", {
      fetchImpl: (async () => ++calls === 1
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify({ results: [], usage: { credits: 1 } }), { status: 200 })) as unknown as typeof fetch,
      minIntervalMs: 0,
      retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 1 },
      sleep: async () => undefined,
    });
    await expect(provider.search("x", 0, undefined, 3)).resolves.toMatchObject({ requests: 2, credits: 1 });
    expect(provider).toMatchObject({ requests: 2, credits: 1 });
  });

  it("accounts for a charged response even when its results are malformed", async () => {
    const provider = createTavilySearchProvider("k", {
      fetchImpl: (async () => new Response(JSON.stringify({ results: "bad", usage: { credits: 1 } }), { status: 200 })) as unknown as typeof fetch,
      minIntervalMs: 0,
    });
    await expect(provider.search("x", 0)).rejects.toMatchObject({ code: "invalid_response" });
    expect(provider).toMatchObject({ requests: 1, credits: 1 });
  });

  it("uses provider-reported credit usage and rejects malformed accounting", () => {
    expect(parseTavilyResponse({ results: [], usage: { credits: 2 } })).toMatchObject({ credits: 2 });
    expect(() => parseTavilyResponse({ results: [], usage: { credits: -1 } })).toThrow(/credit usage/);
    expect(() => parseTavilyResponse({ results: [], usage: { credits: "one" } })).toThrow(/credit usage/);
  });
});

describe("configuration", () => {
  it("has conservative defaults and disables search without a key", () => {
    const config = discoveryConfigFromEnv({});
    expect(config).toEqual(DEFAULT_DISCOVERY_CONFIG);
    expect(config).toMatchObject({ searchProvider: "tavily", enabled: false, intervalHours: 24, maxQueriesPerRun: 10, maxRequestsPerDay: 30, maxCreditsPerMonth: 900, tavilyApiKey: null });
    expect(searchUnavailableReason(config)).toMatch(/TAVILY_API_KEY is not set/);
    expect(searchUnavailableReason(discoveryConfigFromEnv({ TAVILY_API_KEY: "k" }))).toBeNull();
    expect(searchUnavailableReason(discoveryConfigFromEnv({ PROREZ_SEARCH_PROVIDER: "brave", BRAVE_SEARCH_API_KEY: "k" }))).toBeNull();
    expect(searchUnavailableReason(discoveryConfigFromEnv({ TAVILY_API_KEY: "k", PROREZ_DISCOVERY_MAX_REQUESTS_PER_DAY: "0" }))).toMatch(/budget is 0/);
  });

  it("rejects invalid values at start-up", () => {
    expect(() => discoveryConfigFromEnv({ PROREZ_DISCOVERY_INTERVAL_HOURS: "0" })).toThrow(/between 1 and/);
    expect(() => discoveryConfigFromEnv({ PROREZ_DISCOVERY_ENABLED: "maybe" })).toThrow(/true or false/);
    expect(() => discoveryConfigFromEnv({ PROREZ_SEARCH_PROVIDER: "google" })).toThrow(/tavily or brave/);
    expect(discoveryConfigFromEnv({ PROREZ_DISCOVERY_ENABLED: "true", PROREZ_DISCOVERY_MAX_CANDIDATES_PER_RUN: "40" })).toMatchObject({ enabled: true, maxCandidatesPerRun: 40 });
  });
});

describe("candidate status transitions", () => {
  it("only allows the documented transitions; registered is terminal", () => {
    expect(canTransition("discovered", "validating")).toBe(true);
    expect(canTransition("validating", "verified")).toBe(true);
    expect(canTransition("verified", "registered")).toBe(true);
    expect(canTransition("pending_review", "registered")).toBe(true);
    expect(canTransition("rejected", "discovered")).toBe(true); // re-validate
    expect(canTransition("discovered", "registered")).toBe(false); // never without verification
    expect(canTransition("rejected", "registered")).toBe(false);
    for (const to of CANDIDATE_STATUSES) expect(canTransition("registered", to)).toBe(false);
  });
});

describe("SSRF policy", () => {
  it.each([
    ["127.0.0.1", false], ["10.1.2.3", false], ["172.16.0.1", false], ["192.168.1.1", false], ["169.254.169.254", false],
    ["100.64.0.1", false], ["0.0.0.0", false], ["224.0.0.1", false], ["::1", false], ["fc00::1", false], ["fe80::1", false],
    ["::ffff:127.0.0.1", false], ["::ffff:8.8.8.8", false], ["64:ff9b::7f00:1", false], ["2001:db8::1", false],
    ["8.8.8.8", true], ["151.101.1.140", true], ["2606:4700::6810:85e5", true], ["not-an-ip", false],
  ])("%s public=%s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });

  it.each([
    ["http://acme.com/", "scheme"],
    ["https://127.0.0.1/", "IP-address"],
    ["https://[::1]/", "IP-address"],
    ["https://localhost/", "internal"],
    ["https://intranet.corp/", "internal"],
    ["https://acme.com:8443/", "port"],
    ["https://user:pw@acme.com/", "credentials"],
    ["file:///etc/passwd", "scheme"],
    ["https://acme/", "hostname"],
  ])("refuses %s", (url, reason) => {
    const r = checkSiteUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(new RegExp(reason, "i"));
  });

  it("refuses hosts that RESOLVE to private addresses before any request is sent (DNS rebinding)", async () => {
    for (const address of ["127.0.0.1", "10.0.0.5", "169.254.169.254", "::1"]) {
      const fetcher = createSafeSiteFetcher({ resolver: async () => [{ address, family: address.includes(":") ? 6 : 4 }], timeoutMs: 2_000 });
      const result = await fetcher.fetchPage("https://looks-public.example.org/careers");
      expect(result).toMatchObject({ ok: false, failure: "blocked_address" });
    }
    // Any private address among several is enough to refuse.
    const mixed = createSafeSiteFetcher({ resolver: async () => [{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }], timeoutMs: 2_000 });
    expect(await mixed.fetchPage("https://mixed.example.org/")).toMatchObject({ ok: false, failure: "blocked_address" });
  });
});

describe("vetted DNS lookup", () => {
  const call = (lookup: ReturnType<typeof createVettedLookup>, all: boolean) =>
    new Promise<unknown[]>((resolve) => (lookup as unknown as (h: string, o: object, cb: (...a: unknown[]) => void) => void)("acme.com", { all }, (...args) => resolve(args)));
  const resolver = async () => [{ address: "2606:4700::1", family: 6 }, { address: "93.184.216.34", family: 4 }];

  // Regression: Node's Happy Eyeballs calls lookup with { all: true } and needs an array.
  it("returns all vetted addresses (IPv4 first) when asked for all, else one", async () => {
    expect(await call(createVettedLookup(resolver), true)).toEqual([null, [{ address: "93.184.216.34", family: 4 }, { address: "2606:4700::1", family: 6 }]]);
    expect(await call(createVettedLookup(resolver), false)).toEqual([null, "93.184.216.34", 4]);
  });

  it("refuses when any address is private, in both forms", async () => {
    const mixed = createVettedLookup(async () => [{ address: "93.184.216.34", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    for (const all of [true, false]) {
      const [error] = await call(mixed, all);
      expect(error).toMatchObject({ code: "PROREZ_BLOCKED_ADDRESS" });
    }
  });
});

describe("robots.txt", () => {
  const robots = "User-agent: *\nDisallow: /private\nAllow: /private/careers\n\nUser-agent: ProRezBot\nDisallow: /jobs$\n";
  it("applies our group, longest match and end anchors", () => {
    expect(robotsAllows(robots, "/jobs")).toBe(false);
    expect(robotsAllows(robots, "/jobs/123")).toBe(true);
    expect(robotsAllows(robots, "/private")).toBe(true); // our specific group replaces *
    expect(robotsAllows("User-agent: *\nDisallow: /private\nAllow: /private/careers", "/private/careers")).toBe(true);
    expect(robotsAllows("User-agent: *\nDisallow: /", "/careers")).toBe(false);
    expect(robotsAllows("", "/anything")).toBe(true);
  });
});

describe("link and domain extraction", () => {
  const html = `<html><head><meta http-equiv="refresh" content="0; url=https://jobs.ashbyhq.com/acme"></head><body>
    <a href="https://boards.greenhouse.io/acme/jobs/1?gh_src=x">Job</a>
    <a href='/careers'>Careers</a>
    <iframe src="https://boards.greenhouse.io/embed/job_board?for=acme&amp;b=x"></iframe>
    <script src="https://boards.greenhouse.io/embed/job_board/js?for=acme"></script>
    <a href="javascript:alert(1)">x</a><a href="https://jobs.lever.co.evil.example/acme">fake</a>
  </body></html>`;
  it("reads link attributes only, resolves relative URLs and ignores other schemes", () => {
    const links = extractLinks(html, "https://acme.com/");
    expect(links).toContain("https://acme.com/careers");
    expect(links.some((l) => l.startsWith("javascript:"))).toBe(false);
  });

  it("finds each ATS board once, including embeds and meta refresh", () => {
    const boards = findAtsLinks(html, "https://acme.com/").map((b) => `${b.provider}:${b.boardToken}`);
    expect(boards.sort()).toEqual(["ashby:acme", "greenhouse:acme"]);
  });

  it("takes company-domain hints from board content, excluding third-party sites", () => {
    const texts = ["Apply at https://www.acme-robotics.ca/careers or email jobs@acme-robotics.ca.", "Follow us on https://linkedin.com/company/acme and https://github.com/acme."];
    expect(candidateDomains(texts)).toEqual(["acme-robotics.ca"]);
    expect(isThirdPartyDomain("careers.greenhouse.io")).toBe(true);
    expect(isThirdPartyDomain("canada.ca")).toBe(true);
    expect(nameFromDomain("acme-robotics.ca")).toBe("Acme Robotics");
  });
});

describe("Common Crawl import parsing", () => {
  it("parses JSONL, CSV (with header) and plain lines", () => {
    expect(parseImportLine('{"url":"https://jobs.lever.co/acme","timestamp":"20250915123456","crawl":"CC-MAIN-2025-38"}')).toEqual({ url: "https://jobs.lever.co/acme", timestamp: "20250915123456", crawl: "CC-MAIN-2025-38" });
    expect(parseImportLine("url,timestamp")).toBeNull();
    expect(parseImportLine('"https://jobs.ashbyhq.com/acme",20240101000000')).toEqual({ url: "https://jobs.ashbyhq.com/acme", timestamp: "20240101000000", crawl: null });
    expect(parseImportLine("https://boards.greenhouse.io/acme")).toMatchObject({ url: "https://boards.greenhouse.io/acme" });
    expect(parseImportLine("   ")).toBeNull();
    expect(parseImportLine("{broken json")).toBeNull();
  });

  it("reads crawl timestamps", () => {
    expect(crawlDate("20250915123456")?.toISOString()).toBe("2025-09-15T12:34:56.000Z");
    expect(crawlDate("garbage")).toBeNull();
  });
});

describe("live search guard (Milestone 3D fix)", () => {
  it("never uses a real search key against a test or e2e database unless explicitly allowed", async () => {
    const { discoveryDepsFromEnv } = await import("./factory");
    const prisma = {} as never;
    const env = { TAVILY_API_KEY: "real-key", PROREZ_SEARCH_PROVIDER: "tavily" };
    expect(discoveryDepsFromEnv(prisma, { ...env, DATABASE_URL: "postgresql://u@h/prorez_e2e" })().search).toBeNull();
    expect(discoveryDepsFromEnv(prisma, { ...env, DATABASE_URL: "postgresql://u@h/prorez_test" })().search).toBeNull();
    expect(discoveryDepsFromEnv(prisma, { ...env, DATABASE_URL: "postgresql://u@h/prorez_e2e", PROREZ_ALLOW_LIVE_SEARCH_IN_TESTS: "1" })().search?.name).toBe("tavily");
    expect(discoveryDepsFromEnv(prisma, { ...env, DATABASE_URL: "postgresql://u@h/prorez_dev" })().search?.name).toBe("tavily");
  });
});

describe("Tavily request body (Milestone 3D fix)", () => {
  it("restricts site: queries to their domains and never sends an empty restriction", async () => {
    const { tavilyRequestBody } = await import("./search");
    expect(tavilyRequestBody('site:myworkdayjobs.com "intern"')).toMatchObject({ include_domains: ["myworkdayjobs.com"], include_domains_mode: "restrict" });
    const open = tavilyRequestBody('"software engineer" "intern" careers Canada');
    expect(open).not.toHaveProperty("include_domains");
    expect(open).not.toHaveProperty("include_domains_mode");
    expect(open.exclude_domains).toContain("linkedin.com");
  });
});
