/**
 * Candidate verification (Milestone 3C).
 *
 *  1. The identifier must be valid and the provider supported.
 *  2. An equivalent registered board is detected and linked (never modified).
 *  3. The board is validated through the EXISTING ATS adapter (permitted public
 *     API, allow-listed hosts, structure validation): 404 → rejected.
 *  4. Company-domain HINTS are taken from the board's own content (posting
 *     descriptions; Greenhouse board intro). Hints are not proof.
 *  5. Ownership is established only when the company's own website links to,
 *     or its careers page redirects to, THIS board (provider + token + region),
 *     fetched with the SSRF-safe site fetcher and robots.txt respected.
 *     Search results, Common Crawl rows, name similarity or an ATS identifier
 *     alone never establish ownership.
 *  6. Result: verified (ownership evidence) · pending_review (live board,
 *     identity uncertain) · rejected (no such board / invalid response) ·
 *     registered (already registered) · or a bounded retry on temporary failure.
 */
import { AtsError, isTransientError, type HttpTransport } from "../ats/http";
import { ATS_ADAPTERS } from "../ats/registry";
import type { AtsAdapter } from "../ats/types";
import { isValidBoardToken, recognizeAtsUrl, workdayEndpoints } from "../boards/board-url";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type { AtsProvider } from "../types";
import { canTransition, recordEvidence, type CandidateStatus } from "./candidates";
import { candidateDomains, extractLinks as findAllLinks, findAtsLinks, isThirdPartyDomain, registrableDomain } from "./links";
import { extractCareerSite } from "../careers/extract";
import { upsertCandidate } from "./candidates";
import type { SiteFetcher } from "./net";

export interface VerifyDeps {
  prisma: PrismaClient;
  atsTransport: HttpTransport;
  siteFetcher: SiteFetcher;
  now?: () => Date;
  signal?: AbortSignal;
  adapterFor?: (provider: AtsProvider) => AtsAdapter | undefined;
  maxAttempts?: number;
  /** Retry delay base for temporary failures (doubles per attempt). */
  retryBaseMs?: number;
  random?: () => number;
}

export interface VerifyOutcome {
  status: CandidateStatus;
  reason: string | null;
  temporary: boolean;
  atsRequests: number;
  siteRequests: number;
  companyDomain: string | null;
}

/** Pages checked per hinted domain, in order. */
const SITE_PATHS = ["/", "/careers", "/jobs", "/careers/"];
const MAX_DOMAINS = 3;

function countingTransport(inner: HttpTransport) {
  let requests = 0;
  const transport: HttpTransport = {
    async getJson(url, options) {
      requests++;
      return inner.getJson(url, options);
    },
    ...(inner.postJson
      ? {
          async postJson(url: string, body: unknown, options: { signal?: AbortSignal; timeoutMs?: number }) {
            requests++;
            return inner.postJson!(url, body, options);
          },
        }
      : {}),
  };
  return { transport, count: () => requests };
}

/** Atomically claims candidates due for verification (and recovers expired leases). */
export async function claimCandidates(prisma: PrismaClient, input: { limit: number; now: Date; leaseMs: number }): Promise<string[]> {
  if (input.limit <= 0) return [];
  const until = new Date(input.now.getTime() + input.leaseMs);
  const rows = await prisma.$queryRaw<{ id: string; priority: number; first: Date }[]>`
    UPDATE "discovery_candidates" SET "status" = 'validating', "validating_until" = ${until}, "updated_at" = ${input.now}
    WHERE "id" IN (
      SELECT "id" FROM "discovery_candidates"
      WHERE ("status" = 'discovered' AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${input.now}))
         OR ("status" = 'validating' AND "validating_until" < ${input.now})
      -- Priority (Milestone 3D): careers pages of verified company domains,
      -- Workday sites, retries of temporary failures, other careers pages, the rest.
      ORDER BY CASE
                 WHEN "source" = 'company_domain' THEN 0
                 WHEN "provider" = 'workday' THEN 1
                 WHEN "attempts" > 0 THEN 2
                 WHEN "provider" = 'company_site' THEN 3
                 ELSE 4
               END, "first_discovered_at" ASC, "id" ASC
      LIMIT ${input.limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", (CASE WHEN "source" = 'company_domain' THEN 0 WHEN "provider" = 'workday' THEN 1 WHEN "attempts" > 0 THEN 2
                          WHEN "provider" = 'company_site' THEN 3 ELSE 4 END)::int AS "priority", "first_discovered_at" AS "first"`;
  // RETURNING order is unspecified: process in priority order too.
  return rows.sort((a, b) => a.priority - b.priority || a.first.getTime() - b.first.getTime() || a.id.localeCompare(b.id)).map((r) => r.id);
}

async function setStatus(
  prisma: PrismaClient,
  id: string,
  from: CandidateStatus,
  to: CandidateStatus,
  data: Omit<Prisma.DiscoveryCandidateUncheckedUpdateManyInput, "status">,
): Promise<void> {
  if (!canTransition(from, to)) throw new Error(`Invalid discovery status transition ${from} → ${to}.`);
  await prisma.discoveryCandidate.updateMany({ where: { id, status: from }, data: { ...data, status: to } });
}

/** Greenhouse exposes the board's display name and intro; others do not. */
async function greenhouseBoardInfo(transport: HttpTransport, token: string, signal?: AbortSignal): Promise<{ name: string | null; content: string }> {
  try {
    const data = (await transport.getJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`, { signal })) as { name?: unknown; content?: unknown };
    return { name: typeof data?.name === "string" ? data.name.trim().slice(0, 120) || null : null, content: typeof data?.content === "string" ? data.content.slice(0, 20_000) : "" };
  } catch {
    return { name: null, content: "" };
  }
}

/**
 * Verifies one claimed (status = validating) candidate. Never throws for
 * provider/site problems: they become statuses and evidence.
 */
export async function verifyCandidate(deps: VerifyDeps, candidateId: string): Promise<VerifyOutcome> {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());
  const c = await prisma.discoveryCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  const provider = c.provider as AtsProvider;
  const result = (status: CandidateStatus, reason: string | null, extra: Partial<VerifyOutcome> = {}): VerifyOutcome => ({
    status, reason, temporary: false, atsRequests: 0, siteRequests: 0, companyDomain: null, ...extra,
  });

  // 1. Identifier and provider
  const adapter = deps.adapterFor?.(provider) ?? ATS_ADAPTERS[provider];
  if (!adapter || !isValidBoardToken(c.boardToken, provider)) {
    await setStatus(prisma, c.id, "validating", "rejected", { statusReason: "Unsupported provider or invalid board identifier.", validatingUntil: null, lastVerifiedAt: now() });
    return result("rejected", "Unsupported provider or invalid board identifier.");
  }

  // 2. Already registered (by the user or an earlier discovery)
  const existing = await prisma.employerBoard.findUnique({ where: { provider_boardToken: { provider, boardToken: c.boardToken } }, select: { id: true, discovery: { select: { id: true } } } });
  if (existing) {
    await recordEvidence(prisma, c.id, { type: "existing_board", status: "validated", observedAt: now(), metadata: { boardId: existing.id } });
    const linkable = !existing.discovery || existing.discovery.id === c.id;
    await setStatus(prisma, c.id, "validating", linkable ? "registered" : "rejected", {
      registeredBoardId: linkable ? existing.id : null,
      statusReason: linkable ? "Already registered." : "Already registered through another candidate.",
      validatingUntil: null,
      lastVerifiedAt: now(),
    });
    return result(linkable ? "registered" : "rejected", "Already registered.");
  }

  // Generic company careers pages: extraction-based verification (Milestone 3D).
  if (provider === "company_site") return verifyCareerPage(deps, c);

  // 3. Validate the board through the provider's public API
  const ats = countingTransport(deps.atsTransport);
  let postingsText: string[] = [];
  let postingCount = 0;
  let complete = false;
  try {
    const fetched = await adapter.fetchPostings(c.boardToken, {
      transport: ats.transport,
      signal: deps.signal,
      region: c.region === "eu" ? "eu" : null,
      // Verification needs a live board and some posting text, not the whole catalogue.
      limits: provider === "workday" ? { maxListingPages: 3, maxDetailPages: 8, minIntervalMs: 250 } : undefined,
    });
    postingCount = fetched.postings.length;
    complete = fetched.complete;
    postingsText = fetched.postings.slice(0, 50).map((p) => `${p.descriptionText}`);
  } catch (error) {
    const atsError = error instanceof AtsError ? error : null;
    if (isTransientError(error) || !atsError) {
      return temporaryFailure(deps, c.id, c.attempts, atsError?.message ?? "Unexpected error while contacting the provider.", ats.count());
    }
    const reason = atsError.code === "not_found" ? "The provider has no public board with this identifier." : `The provider's response was not a valid board (${atsError.message})`;
    await recordEvidence(prisma, c.id, { type: "ats_board_response", status: "failed", sourceUrl: c.boardUrl, observedAt: now(), metadata: { code: atsError.code } });
    await setStatus(prisma, c.id, "validating", "rejected", { statusReason: reason, validatingUntil: null, lastVerifiedAt: now() });
    return result("rejected", reason, { atsRequests: ats.count() });
  }
  await recordEvidence(prisma, c.id, {
    type: "ats_board_response",
    status: "validated",
    sourceUrl: c.boardUrl,
    observedAt: now(),
    metadata: { postings: postingCount, complete },
  });

  // 4. Employer metadata and domain hints from the board's own content
  const info = provider === "greenhouse" ? await greenhouseBoardInfo(ats.transport, c.boardToken, deps.signal) : { name: null, content: "" };
  // A careers page that linked here (routing) is the first domain to check.
  // Workday postings rarely name a website: the tenant name gives lookup HINTS
  // ("motorolasolutions" → motorolasolutions.com). Never proof — the site must
  // still link to this exact board.
  const tenantHints = provider === "workday" ? workdayTenantHints(c.boardToken) : [];
  const hints = [...new Set([...(c.companyDomain && !isThirdPartyDomain(c.companyDomain) ? [c.companyDomain] : []), ...candidateDomains([info.content, ...postingsText], MAX_DOMAINS), ...tenantHints])].slice(0, MAX_DOMAINS + tenantHints.length);

  // 5. Ownership: the company's website must point at THIS board
  const siteBefore = deps.siteFetcher.requests;
  let ownership: { type: "official_site_link" | "official_site_redirect"; pageUrl: string; domain: string } | null = null;
  outer: for (const domain of hints) {
    const attempts: { url: string; result: string }[] = [];
    for (const path of SITE_PATHS) {
      const page = await deps.siteFetcher.fetchPage(`https://${domain}${path}`, deps.signal);
      if (!page.ok) {
        attempts.push({ url: page.url, result: page.failure });
        // Blocked or disallowed hosts are not retried on other paths.
        if (page.failure === "blocked_url" || page.failure === "blocked_address" || page.failure === "robots_disallowed") break;
        continue;
      }
      // Companies are keyed by registrable domain ("jobs.acme.com" → "acme.com").
      const finalDomain = registrableDomain(new URL(page.finalUrl).hostname);
      if (page.html === null) {
        const target = recognizeAtsUrl(page.atsRedirect);
        if (target && sameBoard(target, c)) {
          ownership = { type: "official_site_redirect", pageUrl: page.finalUrl, domain: finalDomain };
          break outer;
        }
        attempts.push({ url: page.finalUrl, result: "redirects elsewhere" });
        continue;
      }
      if (findAtsLinks(page.html, page.finalUrl).some((l) => sameBoard(l, c))) {
        ownership = { type: "official_site_link", pageUrl: page.finalUrl, domain: finalDomain };
        break outer;
      }
      attempts.push({ url: page.finalUrl, result: "no link to this board" });
    }
    await recordEvidence(prisma, c.id, {
      type: "official_site_link",
      status: "failed",
      dedupeKey: `official_site_link|${domain}|checked`,
      sourceUrl: `https://${domain}/`,
      observedAt: now(),
      metadata: { domain, attempts },
    });
  }
  const siteRequests = deps.siteFetcher.requests - siteBefore;
  const companyName = info.name ?? c.companyName ?? null;

  if (ownership) {
    await recordEvidence(prisma, c.id, { type: ownership.type, status: "validated", sourceUrl: ownership.pageUrl, observedAt: now(), metadata: { domain: ownership.domain } });
    await setStatus(prisma, c.id, "validating", "verified", {
      companyDomain: ownership.domain,
      companyName: companyName ?? nameFromDomain(ownership.domain),
      postingCount,
      statusReason: `${ownership.type === "official_site_redirect" ? "Redirected to" : "Linked from"} ${ownership.pageUrl}.`,
      validatingUntil: null,
      lastVerifiedAt: now(),
      attempts: 0,
      nextAttemptAt: null,
    });
    return result("verified", null, { atsRequests: ats.count(), siteRequests, companyDomain: ownership.domain });
  }

  const reason =
    hints.length === 0
      ? "The board is live, but its postings name no company website to check ownership against."
      : `The board is live, but none of ${hints.join(", ")} links to it. Review before registering.`;
  await setStatus(prisma, c.id, "validating", "pending_review", {
    companyName,
    // A hint, not verified: kept for the reviewer.
    companyDomain: hints[0] ?? null,
    postingCount,
    statusReason: reason,
    validatingUntil: null,
    lastVerifiedAt: now(),
    attempts: 0,
    nextAttemptAt: null,
  });
  return result("pending_review", reason, { atsRequests: ats.count(), siteRequests });
}

function workdayTenantHints(token: string): string[] {
  const tenant = workdayEndpoints(token)?.tenant;
  if (!tenant || tenant.length < 3 || !/^[a-z0-9-]+$/.test(tenant)) return [];
  return [`${tenant}.com`, `${tenant}.ca`].filter((d) => !isThirdPartyDomain(d));
}

function sameBoard(link: { provider: string; boardToken: string; region: string | null }, c: { provider: string; boardToken: string; region: string | null }) {
  return link.provider === c.provider && link.boardToken === c.boardToken && (link.region ?? null) === (c.region ?? null);
}

/** "acme-robotics.ca" → "Acme Robotics" (display fallback only; never used to match). */
export function nameFromDomain(domain: string): string {
  const label = domain.split(".")[0] ?? domain;
  return label.split(/[-_]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || domain;
}

async function temporaryFailure(deps: VerifyDeps, id: string, attempts: number, message: string, atsRequests: number): Promise<VerifyOutcome> {
  const now = (deps.now ?? (() => new Date()))();
  const max = deps.maxAttempts ?? 3;
  const next = attempts + 1;
  if (next >= max) {
    const reason = `Could not reach the provider after ${next} attempts (${message}). Re-validate to try again.`;
    await setStatus(deps.prisma, id, "validating", "rejected", { attempts: next, statusReason: reason, validatingUntil: null, lastVerifiedAt: now, nextAttemptAt: null });
    return { status: "rejected", reason, temporary: true, atsRequests, siteRequests: 0, companyDomain: null };
  }
  const base = deps.retryBaseMs ?? 60 * 60_000;
  const delay = Math.round(base * 2 ** attempts * (0.9 + (deps.random ?? Math.random)() * 0.2));
  await setStatus(deps.prisma, id, "validating", "discovered", {
    attempts: next,
    statusReason: `Temporary failure: ${message} Retrying later.`,
    validatingUntil: null,
    nextAttemptAt: new Date(now.getTime() + delay),
  });
  return { status: "discovered", reason: message, temporary: true, atsRequests, siteRequests: 0, companyDomain: null };
}

// ---------------------------------------------------------------------------
// Generic company careers pages (Milestone 3D)
// ---------------------------------------------------------------------------

/** Verification-time extraction budget (a sync reads more). */
const VERIFY_LIMITS = { maxListingPages: 2, maxDetailPages: 10, maxRenders: 2, minIntervalMs: 1000 };

/**
 * 1. Extract the careers page (safe fetcher, robots.txt, strategies 1–4).
 * 2. Links/redirects to supported ATS or Workday boards → those boards become
 *    candidates (with this site's domain as their first ownership hint) and
 *    this page is NOT scraped as a generic source (routed).
 * 3. No reliable jobs → `unsupported`, with diagnostics kept as evidence.
 * 4. Ownership: the page must be served from the company's own registrable
 *    domain (not a third-party platform); a careers SUBDOMAIN additionally
 *    needs the main site to link to it. Otherwise → pending review.
 */
async function verifyCareerPage(deps: VerifyDeps, c: { id: string; boardUrl: string; boardToken: string; attempts: number; companyName: string | null }): Promise<VerifyOutcome> {
  const { prisma } = deps;
  const now = deps.now ?? (() => new Date());
  const before = deps.siteFetcher.requests;
  const siteRequests = () => deps.siteFetcher.requests - before;
  const base = { temporary: false, atsRequests: 0, companyDomain: null as string | null };
  const x = await extractCareerSite(c.boardUrl, deps.siteFetcher, { limits: VERIFY_LIMITS, signal: deps.signal });
  await recordEvidence(prisma, c.id, {
    type: "career_page_extraction",
    status: x.status === "ok" ? "validated" : "failed",
    sourceUrl: c.boardUrl,
    dedupeKey: "career_page_extraction|latest",
    observedAt: now(),
    metadata: { status: x.status, jobs: x.jobs.length, strategy: x.strategy, complete: x.complete, pagesFetched: x.pagesFetched, rendered: x.rendered, diagnostics: x.diagnostics.slice(0, 10), sampleTitles: x.jobs.slice(0, 5).map((j) => j.title) },
  });

  if (x.status === "blocked") {
    const f = x.failure?.failure;
    if (f === "timeout" || f === "network") {
      const out = await temporaryFailure(deps, c.id, c.attempts, x.failure?.message ?? "Network error.", 0);
      return { ...out, siteRequests: siteRequests() };
    }
    const reason = `The careers page could not be read: ${x.failure?.message ?? "blocked"}.`;
    await setStatus(prisma, c.id, "validating", "rejected", { statusReason: reason.slice(0, 300), validatingUntil: null, lastVerifiedAt: now() });
    return { ...base, status: "rejected", reason, siteRequests: siteRequests() };
  }

  const pageHost = new URL(x.finalUrl ?? c.boardUrl).hostname.toLowerCase();
  const domain = registrableDomain(pageHost);

  // Route to dedicated adapters.
  if (x.routedTo.length > 0) {
    for (const target of x.routedTo.slice(0, 5)) {
      const { id } = await upsertCandidate(prisma, { recognized: target, discoveredUrl: c.boardUrl, source: "career_page", now: now(), companyDomainHint: isThirdPartyDomain(domain) ? null : domain });
      await recordEvidence(prisma, id, { type: "routed_to_ats", status: "unvalidated", sourceUrl: c.boardUrl, observedAt: now(), metadata: { from: c.boardUrl } });
    }
    await recordEvidence(prisma, c.id, { type: "routed_to_ats", status: "validated", sourceUrl: c.boardUrl, observedAt: now(), metadata: { target: x.routedTo.map((t) => t.canonicalBoardUrl).join(", ") } });
    {
      const reason = `Routed to ${x.routedTo.map((t) => t.canonicalBoardUrl).join(", ")}; the dedicated adapter is used instead of scraping this page.`;
      await setStatus(prisma, c.id, "validating", "rejected", { statusReason: reason.slice(0, 300), companyDomain: domain, validatingUntil: null, lastVerifiedAt: now() });
      return { ...base, status: "rejected", reason, siteRequests: siteRequests() };
    }
  }

  if (x.status !== "ok") {
    const reason = `No reliable job extraction: ${x.diagnostics.slice(-1)[0] ?? "no jobs found"}`.slice(0, 300);
    await setStatus(prisma, c.id, "validating", "unsupported", { statusReason: reason, companyDomain: domain, validatingUntil: null, lastVerifiedAt: now(), postingCount: 0 });
    return { ...base, status: "unsupported", reason, siteRequests: siteRequests() };
  }

  // Ownership of a company-hosted careers page.
  let ownership: { type: "official_site_link"; pageUrl: string; detail: string } | null = null;
  if (isThirdPartyDomain(domain)) {
    ownership = null;
  } else if (pageHost === domain || pageHost === `www.${domain}`) {
    ownership = { type: "official_site_link", pageUrl: x.finalUrl ?? c.boardUrl, detail: "Served from the company's own domain." };
  } else {
    const home = await deps.siteFetcher.fetchPage(`https://${domain}/`, deps.signal);
    const linked = home.ok && home.html !== null && extractLinksSafe(home.html, home.finalUrl).some((u) => new URL(u).hostname.toLowerCase() === pageHost);
    if (linked && home.ok) ownership = { type: "official_site_link", pageUrl: home.finalUrl, detail: `${domain} links to ${pageHost}.` };
  }
  const companyName = (x.companyName ?? c.companyName ?? nameFromDomain(domain)).slice(0, 120);
  const fields = { companyName, companyDomain: domain, postingCount: x.jobs.length, extractionStrategy: x.strategy, validatingUntil: null, lastVerifiedAt: now(), attempts: 0, nextAttemptAt: null };
  if (ownership) {
    await recordEvidence(prisma, c.id, { type: ownership.type, status: "validated", sourceUrl: ownership.pageUrl, observedAt: now(), metadata: { domain, detail: ownership.detail } });
    await setStatus(prisma, c.id, "validating", "verified", { ...fields, statusReason: `${x.jobs.length} job${x.jobs.length === 1 ? "" : "s"} extracted (${x.strategy}); ${ownership.detail}` });
    return { ...base, status: "verified", reason: null, siteRequests: siteRequests(), companyDomain: domain };
  }
  const reason = isThirdPartyDomain(domain)
    ? `Jobs extracted, but ${domain} is a third-party platform, so the employer is unconfirmed. Review before registering.`
    : `Jobs extracted, but ${domain} does not link to ${pageHost}. Review before registering.`;
  await setStatus(prisma, c.id, "validating", "pending_review", { ...fields, statusReason: reason });
  return { ...base, status: "pending_review", reason, siteRequests: siteRequests() };
}

function extractLinksSafe(html: string, base: string): string[] {
  return findAllLinks(html, base);
}
