/**
 * Universal career-URL importer (Milestone 3D, Boards page). The user pastes
 * any public careers URL; ProRez works out what it is:
 *
 *   ATS/Workday URL (board, posting, embed, API)  → that provider's adapter
 *   company careers page linking/redirecting to one → routed to that adapter
 *   any other careers page                          → generic extraction
 *
 * The preview is recomputed on the server at registration (the client's
 * preview is never trusted), and a source is registered only when the
 * extraction actually produced jobs (ATS boards may legitimately be empty).
 */
import { AtsError, type HttpTransport } from "../ats/http";
import { ATS_ADAPTERS } from "../ats/registry";
import { normalizePosting } from "../ats/normalize";
import type { ProviderPosting } from "../ats/types";
import { canonicalCareerUrl, recognizeAtsUrl, type RecognizedAtsUrl } from "../boards/board-url";
import { initialNextSyncAt } from "../boards/service";
import { POLL_INTERVAL } from "../boards/schema";
import { isThirdPartyDomain, registrableDomain, extractLinks } from "../discovery/links";
import { checkSiteUrl, type SiteFetcher } from "../discovery/net";
import { nameFromDomain } from "../discovery/verify";
import type { PrismaClient } from "../generated/prisma/client";
import { fail, prismaErrorCode, type MutationResult } from "../mutations/result";
import type { AtsProvider, ExtractionStrategy } from "../types";
import { extractCareerSite, toProviderPostings } from "./extract";
import { looksLikeJobDescription } from "./static";

export interface ImportPreview {
  inputUrl: string;
  provider: AtsProvider;
  sourceType: "ats" | "workday" | "generic";
  boardToken: string;
  region: "eu" | null;
  locale: string | null;
  canonicalUrl: string;
  /** Present when the pasted page led to an ATS/Workday board. */
  routedFrom: string | null;
  companyName: string | null;
  /** Domain whose ownership was confirmed (generic pages on the company's own site). */
  verifiedDomain: string | null;
  verification: "verified" | "unverified";
  verificationNote: string;
  extractionStrategy: ExtractionStrategy | null;
  jobsDetected: number;
  eligibleJobs: number;
  withFullDescription: number;
  /** Listing provably complete (ATS/Workday complete snapshot; generic only when exhaustive). */
  listingComplete: boolean;
  sampleJobs: { title: string; url: string | null; location: string | null }[];
  warnings: string[];
  existingBoardId: string | null;
  registrable: boolean;
  /** Why it cannot be registered (when not registrable). */
  blocker: string | null;
}

const PREVIEW_LIMITS = { maxListingPages: 2, maxDetailPages: 8, maxRenders: 0, minIntervalMs: 500 };
const WORKDAY_PREVIEW_LIMITS = { maxListingPages: 3, maxDetailPages: 8, minIntervalMs: 250 };

function summarize(postings: ProviderPosting[], employer: string) {
  let eligible = 0;
  for (const p of postings) if (normalizePosting(p, employer).ok) eligible++;
  return {
    jobsDetected: postings.length,
    eligibleJobs: eligible,
    withFullDescription: postings.filter((p) => looksLikeJobDescription(p.descriptionText)).length,
    sampleJobs: postings.slice(0, 8).map((p) => ({ title: p.title, url: p.url, location: p.locationTexts[0] ?? null })),
  };
}

async function previewAdapter(r: RecognizedAtsUrl, transport: HttpTransport, signal?: AbortSignal) {
  const adapter = ATS_ADAPTERS[r.provider];
  return adapter.fetchPostings(r.boardToken, {
    transport,
    signal,
    region: r.region,
    limits: r.provider === "workday" ? WORKDAY_PREVIEW_LIMITS : PREVIEW_LIMITS,
  });
}

export async function previewCareerUrl(
  prisma: PrismaClient,
  input: string,
  deps: { transport: HttpTransport; site?: SiteFetcher; signal?: AbortSignal },
): Promise<MutationResult<ImportPreview>> {
  const raw = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return fail("validation", "Enter a full web address, for example https://example.com/careers.", { fieldErrors: { url: "Not a valid URL." } });
  }
  if (url.protocol === "http:") url.protocol = "https:"; // public sources are read over https only
  const checked = checkSiteUrl(url.toString());
  if (!checked.ok && !recognizeAtsUrl(url.toString())) {
    return fail("validation", `This URL cannot be imported: ${checked.reason}.`, { fieldErrors: { url: checked.reason } });
  }

  let recognized = recognizeAtsUrl(url.toString());
  let routedFrom: string | null = null;
  const warnings: string[] = [];
  let generic: Awaited<ReturnType<typeof extractCareerSite>> | null = null;

  if (!recognized) {
    const site = deps.site ?? deps.transport.site?.();
    if (!site) return fail("unexpected", "Company career sites cannot be read in this mode.");
    generic = await extractCareerSite(checked.ok ? checked.url.toString() : url.toString(), site, { limits: PREVIEW_LIMITS, signal: deps.signal, allowRender: false });
    if (generic.status === "blocked") {
      return fail("validation", `ProRez could not read this page: ${generic.failure?.message ?? "blocked"}. Sites that block automated access, require a login or disallow crawling are not imported.`);
    }
    if (generic.routedTo.length > 0) {
      recognized = generic.routedTo[0];
      routedFrom = generic.finalUrl ?? url.toString();
      if (generic.routedTo.length > 1) warnings.push(`This page links to ${generic.routedTo.length} boards; previewing ${recognized.canonicalBoardUrl}. Import the others separately.`);
    }
  }

  // --- ATS / Workday
  if (recognized) {
    let fetched;
    try {
      fetched = await previewAdapter(recognized, deps.transport, deps.signal);
    } catch (error) {
      const message = error instanceof AtsError && error.code === "not_found" ? "The provider has no public board with this identifier." : error instanceof Error ? error.message : "The board could not be read.";
      return fail("validation", message);
    }
    const existing = await prisma.employerBoard.findUnique({ where: { provider_boardToken: { provider: recognized.provider, boardToken: recognized.boardToken } }, select: { id: true } });
    const routedDomain = routedFrom ? registrableDomain(new URL(routedFrom).hostname) : null;
    const s = summarize(fetched.postings, "Preview");
    if (!fetched.complete && fetched.incompleteReason) warnings.push(`Preview read part of the listing: ${fetched.incompleteReason}`);
    if (fetched.enrichmentDeferred) warnings.push(`${fetched.enrichmentDeferred} description(s) are loaded during regular syncs, not in this preview.`);
    return {
      ok: true,
      value: {
        inputUrl: raw,
        provider: recognized.provider,
        sourceType: recognized.provider === "workday" ? "workday" : "ats",
        boardToken: recognized.boardToken,
        region: recognized.region,
        locale: recognized.locale ?? null,
        canonicalUrl: recognized.canonicalBoardUrl,
        routedFrom,
        companyName: fetched.sourceCompanyName ?? (routedDomain && !isThirdPartyDomain(routedDomain) ? nameFromDomain(routedDomain) : null),
        verifiedDomain: routedDomain && !isThirdPartyDomain(routedDomain) ? routedDomain : null,
        verification: routedDomain && !isThirdPartyDomain(routedDomain) ? "verified" : "unverified",
        verificationNote: routedDomain && !isThirdPartyDomain(routedDomain)
          ? `${routedDomain}'s careers page leads to this board.`
          : "Added by you. The board is live, but which company owns it has not been confirmed automatically.",
        extractionStrategy: recognized.provider === "workday" ? "workday_cxs" : "ats_api",
        ...s,
        listingComplete: fetched.complete,
        warnings,
        existingBoardId: existing?.id ?? null,
        registrable: !existing,
        blocker: existing ? "This board is already registered." : null,
      },
    };
  }

  // --- Generic page
  const g = generic!;
  const canonical = canonicalCareerUrl(g.finalUrl ?? url.toString());
  if (!canonical) return fail("validation", "This page's address cannot be used as a career source.");
  const pageHost = new URL(canonical.url).hostname;
  const domain = registrableDomain(pageHost);
  let verifiedDomain: string | null = null;
  let note = "Added by you; the employer could not be confirmed automatically.";
  if (!isThirdPartyDomain(domain)) {
    if (pageHost === domain || pageHost === `www.${domain}`) {
      verifiedDomain = domain;
      note = `Served from ${domain}, the company's own site.`;
    } else {
      const site = deps.site ?? deps.transport.site?.();
      const home = site ? await site.fetchPage(`https://${domain}/`, deps.signal) : null;
      if (home?.ok && home.html && extractLinks(home.html, home.finalUrl).some((u) => new URL(u).hostname.toLowerCase() === pageHost)) {
        verifiedDomain = domain;
        note = `${domain} links to ${pageHost}.`;
      }
    }
  }
  const postings = toProviderPostings(g.jobs);
  const s = summarize(postings, "Preview");
  for (const d of g.diagnostics.slice(0, 5)) warnings.push(d);
  if (!g.complete && g.status === "ok") warnings.push(`Listing completeness is not proven (${g.incompleteReason ?? "generic page"}); jobs missing from a sync are never expired for this source.`);
  const existing = await prisma.employerBoard.findUnique({ where: { provider_boardToken: { provider: "company_site", boardToken: canonical.token } }, select: { id: true } });
  const blocker = existing
    ? "This careers page is already registered."
    : g.jobs.length === 0
      ? "No job postings could be extracted from this page, so it cannot be registered. Try the page that lists the jobs, or a single job page's listing."
      : null;
  return {
    ok: true,
    value: {
      inputUrl: raw,
      provider: "company_site",
      sourceType: "generic",
      boardToken: canonical.token,
      region: null,
      locale: null,
      canonicalUrl: canonical.url,
      routedFrom: null,
      companyName: g.companyName ?? (isThirdPartyDomain(domain) ? null : nameFromDomain(domain)),
      verifiedDomain,
      verification: verifiedDomain ? "verified" : "unverified",
      verificationNote: note,
      extractionStrategy: g.strategy,
      ...s,
      listingComplete: g.complete,
      warnings,
      existingBoardId: existing?.id ?? null,
      registrable: blocker === null,
      blocker,
    },
  };
}

/** Re-runs the preview server-side and registers the source when it qualifies. */
export async function importCareerUrl(
  prisma: PrismaClient,
  input: { url: string; employerName: string | null; now?: Date },
  deps: { transport: HttpTransport; site?: SiteFetcher; signal?: AbortSignal },
): Promise<MutationResult<{ boardId: string; preview: ImportPreview }>> {
  const previewed = await previewCareerUrl(prisma, input.url, deps);
  if (!previewed.ok) return previewed;
  const p = previewed.value;
  if (!p.registrable) return fail(p.existingBoardId ? "duplicate" : "validation", p.blocker ?? "This source cannot be registered.");
  const employerName = (input.employerName?.trim() || p.companyName || "").slice(0, 120);
  if (!employerName) return fail("validation", "Enter the employer's name.", { fieldErrors: { employerName: "Enter the employer's name." } });
  const now = input.now ?? new Date();
  try {
    const boardId = await prisma.$transaction(async (tx) => {
      let companyId: string | null = null;
      if (p.verifiedDomain) {
        await tx.$executeRaw`
          INSERT INTO "companies" ("id", "name", "domain", "origin", "created_at", "updated_at")
          VALUES (gen_random_uuid(), ${employerName}, ${p.verifiedDomain}, 'manual', ${now}, ${now})
          ON CONFLICT ("domain") DO NOTHING`;
        companyId = (await tx.company.findUniqueOrThrow({ where: { domain: p.verifiedDomain }, select: { id: true } })).id;
      }
      const board = await tx.employerBoard.create({
        data: {
          provider: p.provider,
          boardToken: p.boardToken,
          boardUrl: p.canonicalUrl,
          region: p.region,
          locale: p.locale,
          employerName,
          enabled: true,
          pollIntervalMinutes: POLL_INTERVAL.default,
          origin: "manual",
          companyId,
          extractionStrategy: p.extractionStrategy,
          nextSyncAt: initialNextSyncAt(true, false, now),
        },
        select: { id: true },
      });
      return board.id;
    });
    return { ok: true, value: { boardId, preview: p } };
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") return fail("duplicate", "This source is already registered.");
    throw error;
  }
}
