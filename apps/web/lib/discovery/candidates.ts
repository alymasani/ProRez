/**
 * Discovery candidates and evidence persistence (Milestone 3C).
 *
 * A candidate is one possible career source — an ATS board, a Workday career
 * site or a company careers page — unique by (provider, board token), so
 * every URL variant of a board (board page, posting, embed, API) collapses
 * into one row. Repeated sightings only refresh `last_discovered_at` and add
 * deduplicated evidence.
 */
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { canonicalCareerUrl, recognizeAtsUrl, type RecognizedAtsUrl } from "../boards/board-url";
import { CAREER_PATH, JOB_SEGMENT } from "../careers/static";
import { isThirdPartyDomain, registrableDomain } from "./links";

/**
 * A company careers page found in search/crawl data (Milestone 3D): a URL on
 * a non-platform domain whose path is a careers landing page ("/careers",
 * "/jobs", "/join-us"…), a careers subdomain root ("careers.acme.com/"), or a
 * job page under one (truncated to the listing). A HINT only: the page must
 * still yield jobs and pass ownership checks.
 */
export function recognizeCareerPageUrl(input: string): RecognizedAtsUrl | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (isThirdPartyDomain(registrableDomain(host)) || recognizeAtsUrl(input)) return null;
  const segs = url.pathname.split("/").filter(Boolean);
  let path: string | null = null;
  if (CAREER_PATH.test(url.pathname)) {
    path = url.pathname;
  } else {
    const i = segs.findIndex((seg) => JOB_SEGMENT.test(seg) && /^(careers?|jobs|join-us|work-with-us|opportunities|open-positions)$/i.test(seg));
    if (i !== -1 && i <= 2) path = `/${segs.slice(0, i + 1).join("/")}`;
    else if (/^(careers?|jobs)\./.test(host) && segs.length <= 1) path = "/";
  }
  if (path === null) return null;
  const c = canonicalCareerUrl(`https://${host}${path}`);
  if (!c) return null;
  return { provider: "company_site", boardToken: c.token, region: null, kind: "board", postingId: null, canonicalBoardUrl: c.url };
}

/** ATS/Workday recognition first; careers pages only when allowed. */
export function recognizeSourceUrl(url: string, allowGeneric: boolean): RecognizedAtsUrl | null {
  return recognizeAtsUrl(url) ?? (allowGeneric ? recognizeCareerPageUrl(url) : null);
}

export const CANDIDATE_STATUSES = ["discovered", "validating", "verified", "pending_review", "rejected", "registered", "unsupported"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/**
 * Allowed status transitions. `registered` is terminal. Re-validation moves a
 * verified, pending or rejected candidate back to `discovered` (queued).
 */
const TRANSITIONS: Record<CandidateStatus, readonly CandidateStatus[]> = {
  discovered: ["validating", "rejected"],
  validating: ["verified", "pending_review", "rejected", "registered", "discovered", "unsupported"],
  verified: ["registered", "discovered", "rejected"],
  pending_review: ["registered", "rejected", "discovered"],
  rejected: ["discovered"],
  registered: [],
  // Live site without a reliable extraction method: kept with diagnostics, re-checkable.
  unsupported: ["discovered", "rejected"],
};

export function canTransition(from: CandidateStatus, to: CandidateStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type CandidateSource = "search" | "common_crawl" | "existing_jobs" | "manual" | "career_page" | "company_domain";
export type EvidenceType =
  | "ats_board_response"
  | "official_site_link"
  | "official_site_redirect"
  | "search_result"
  | "common_crawl"
  | "existing_job_url"
  | "existing_board"
  | "manual_review"
  | "career_page_extraction"
  | "routed_to_ats";
export type EvidenceStatus = "validated" | "unvalidated" | "failed";

/** Evidence types that can establish which company owns a board. */
export const OWNERSHIP_EVIDENCE: readonly EvidenceType[] = ["official_site_link", "official_site_redirect"];

type Db = PrismaClient | Prisma.TransactionClient;

export interface UpsertCandidateInput {
  recognized: RecognizedAtsUrl;
  /** Unverified company-domain hint (e.g. the careers page that linked to this board). */
  companyDomainHint?: string | null;
  /** The URL as observed. For search results pass the canonical board URL (results are not stored). */
  discoveredUrl: string;
  source: CandidateSource;
  now: Date;
}

/** Inserts or refreshes a candidate atomically; `isNew` is true only for the inserting call. */
export async function upsertCandidate(db: Db, input: UpsertCandidateInput): Promise<{ id: string; isNew: boolean; status: CandidateStatus }> {
  const r = input.recognized;
  const rows = await db.$queryRaw<{ id: string; inserted: boolean; status: CandidateStatus }[]>`
    INSERT INTO "discovery_candidates"
      ("id", "provider", "board_token", "region", "board_url", "discovered_url", "source", "locale", "company_domain", "first_discovered_at", "last_discovered_at", "updated_at")
    VALUES (gen_random_uuid(), ${r.provider}::"source_provider", ${r.boardToken}, ${r.region}, ${r.canonicalBoardUrl},
            ${input.discoveredUrl.slice(0, 2048)}, ${input.source}::"discovery_source", ${r.locale ?? null}, ${input.companyDomainHint ?? null},
            ${input.now}, ${input.now}, ${input.now})
    ON CONFLICT ("provider", "board_token") DO UPDATE
      SET "last_discovered_at" = GREATEST("discovery_candidates"."last_discovered_at", EXCLUDED."last_discovered_at"),
          "company_domain" = COALESCE("discovery_candidates"."company_domain", EXCLUDED."company_domain"),
          "updated_at" = EXCLUDED."updated_at"
    RETURNING "id", (xmax = 0) AS "inserted", "status"`;
  return { id: rows[0].id, isNew: rows[0].inserted, status: rows[0].status };
}

export interface EvidenceInput {
  type: EvidenceType;
  status: EvidenceStatus;
  sourceUrl?: string | null;
  /** Same key = same evidence; re-observing updates it instead of duplicating. */
  dedupeKey?: string;
  metadata?: Prisma.InputJsonObject;
  observedAt: Date;
}

export async function recordEvidence(db: Db, candidateId: string, e: EvidenceInput): Promise<void> {
  const dedupeKey = (e.dedupeKey ?? `${e.type}|${e.sourceUrl ?? ""}`).slice(0, 500);
  await db.discoveryEvidence.upsert({
    where: { candidateId_dedupeKey: { candidateId, dedupeKey } },
    create: { candidateId, type: e.type, status: e.status, sourceUrl: e.sourceUrl ?? null, dedupeKey, observedAt: e.observedAt, metadata: e.metadata },
    update: { status: e.status, observedAt: e.observedAt, metadata: e.metadata },
  });
}

/**
 * Records every recognised ATS URL from a batch as candidates (deduplicated
 * within the batch by board identity). Unrecognised URLs are ignored.
 */
export async function ingestUrls(
  prisma: PrismaClient,
  urls: readonly string[],
  context: {
    source: CandidateSource;
    now: Date;
    evidence: (r: RecognizedAtsUrl, url: string) => Omit<EvidenceInput, "observedAt"> | null;
    /** Store the observed URL (false for search results, which may not be stored). */
    keepObservedUrl: boolean;
    /** Also accept company careers-page URLs (Milestone 3D). */
    allowGeneric?: boolean;
  },
): Promise<{ recognized: number; unique: number; newCandidates: number; candidateIds: string[] }> {
  const byBoard = new Map<string, { r: RecognizedAtsUrl; url: string }>();
  let recognized = 0;
  for (const url of urls) {
    const r = recognizeSourceUrl(url, context.allowGeneric ?? false);
    if (!r) continue;
    recognized++;
    const key = `${r.provider}:${r.boardToken}`;
    if (!byBoard.has(key)) byBoard.set(key, { r, url });
  }
  let newCandidates = 0;
  const candidateIds: string[] = [];
  for (const { r, url } of byBoard.values()) {
    const { id, isNew } = await upsertCandidate(prisma, {
      recognized: r,
      discoveredUrl: context.keepObservedUrl ? url : r.canonicalBoardUrl,
      source: context.source,
      now: context.now,
    });
    if (isNew) newCandidates++;
    candidateIds.push(id);
    const evidence = context.evidence(r, url);
    if (evidence) await recordEvidence(prisma, id, { ...evidence, observedAt: context.now });
  }
  return { recognized, unique: byBoard.size, newCandidates, candidateIds };
}
