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
import { isValidBoardToken, recognizeAtsUrl } from "../boards/board-url";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import type { AtsProvider } from "../types";
import { canTransition, recordEvidence, type CandidateStatus } from "./candidates";
import { candidateDomains, findAtsLinks, siteDomain } from "./links";
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
  };
  return { transport, count: () => requests };
}

/** Atomically claims candidates due for verification (and recovers expired leases). */
export async function claimCandidates(prisma: PrismaClient, input: { limit: number; now: Date; leaseMs: number }): Promise<string[]> {
  if (input.limit <= 0) return [];
  const until = new Date(input.now.getTime() + input.leaseMs);
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "discovery_candidates" SET "status" = 'validating', "validating_until" = ${until}, "updated_at" = ${input.now}
    WHERE "id" IN (
      SELECT "id" FROM "discovery_candidates"
      WHERE ("status" = 'discovered' AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${input.now}))
         OR ("status" = 'validating' AND "validating_until" < ${input.now})
      ORDER BY "first_discovered_at" ASC, "id" ASC
      LIMIT ${input.limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  return rows.map((r) => r.id);
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
  if (!adapter || !isValidBoardToken(c.boardToken)) {
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

  // 3. Validate the board through the provider's public API
  const ats = countingTransport(deps.atsTransport);
  let postingsText: string[] = [];
  let postingCount = 0;
  let complete = false;
  try {
    const fetched = await adapter.fetchPostings(c.boardToken, { transport: ats.transport, signal: deps.signal, region: c.region === "eu" ? "eu" : null });
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
  const hints = candidateDomains([info.content, ...postingsText], MAX_DOMAINS);

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
      const finalDomain = siteDomain(new URL(page.finalUrl).hostname);
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
