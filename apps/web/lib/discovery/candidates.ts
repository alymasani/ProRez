/**
 * Discovery candidates and evidence persistence (Milestone 3C).
 *
 * A candidate is one possible ATS board, unique by (provider, board token), so
 * every URL variant of a board (board page, posting, embed, API) collapses
 * into one row. Repeated sightings only refresh `last_discovered_at` and add
 * deduplicated evidence.
 */
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { recognizeAtsUrl, type RecognizedAtsUrl } from "../boards/board-url";

export const CANDIDATE_STATUSES = ["discovered", "validating", "verified", "pending_review", "rejected", "registered"] as const;
export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

/**
 * Allowed status transitions. `registered` is terminal. Re-validation moves a
 * verified, pending or rejected candidate back to `discovered` (queued).
 */
const TRANSITIONS: Record<CandidateStatus, readonly CandidateStatus[]> = {
  discovered: ["validating", "rejected"],
  validating: ["verified", "pending_review", "rejected", "registered", "discovered"],
  verified: ["registered", "discovered", "rejected"],
  pending_review: ["registered", "rejected", "discovered"],
  rejected: ["discovered"],
  registered: [],
};

export function canTransition(from: CandidateStatus, to: CandidateStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export type CandidateSource = "search" | "common_crawl" | "existing_jobs" | "manual";
export type EvidenceType =
  | "ats_board_response"
  | "official_site_link"
  | "official_site_redirect"
  | "search_result"
  | "common_crawl"
  | "existing_job_url"
  | "existing_board"
  | "manual_review";
export type EvidenceStatus = "validated" | "unvalidated" | "failed";

/** Evidence types that can establish which company owns a board. */
export const OWNERSHIP_EVIDENCE: readonly EvidenceType[] = ["official_site_link", "official_site_redirect"];

type Db = PrismaClient | Prisma.TransactionClient;

export interface UpsertCandidateInput {
  recognized: RecognizedAtsUrl;
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
      ("id", "provider", "board_token", "region", "board_url", "discovered_url", "source", "first_discovered_at", "last_discovered_at", "updated_at")
    VALUES (gen_random_uuid(), ${r.provider}::"source_provider", ${r.boardToken}, ${r.region}, ${r.canonicalBoardUrl},
            ${input.discoveredUrl.slice(0, 2048)}, ${input.source}::"discovery_source", ${input.now}, ${input.now}, ${input.now})
    ON CONFLICT ("provider", "board_token") DO UPDATE
      SET "last_discovered_at" = GREATEST("discovery_candidates"."last_discovered_at", EXCLUDED."last_discovered_at"),
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
  },
): Promise<{ recognized: number; unique: number; newCandidates: number; candidateIds: string[] }> {
  const byBoard = new Map<string, { r: RecognizedAtsUrl; url: string }>();
  let recognized = 0;
  for (const url of urls) {
    const r = recognizeAtsUrl(url);
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
