/** Read model for the Discovery section of the Boards page (Milestone 3C). */
import type { PrismaClient } from "../generated/prisma/client";
import { discoveryConfigFromEnv, searchUnavailableReason } from "./config";
import { SCHEDULE_ID, searchRequestsLast24h, tavilyCreditsThisMonth } from "./run";
import type { AtsProvider } from "../types";

export interface DiscoveryEvidenceView {
  id: string;
  type: string;
  status: "validated" | "unvalidated" | "failed";
  sourceUrl: string | null;
  observedAt: string;
  summary: string | null;
}

export interface DiscoveryCandidateView {
  id: string;
  provider: AtsProvider;
  boardToken: string;
  region: "eu" | null;
  boardUrl: string;
  companyName: string | null;
  companyDomain: string | null;
  source: string;
  status: "discovered" | "validating" | "verified" | "pending_review" | "rejected" | "registered" | "unsupported";
  extractionStrategy: string | null;
  statusReason: string | null;
  postingCount: number | null;
  firstDiscoveredAt: string;
  lastVerifiedAt: string | null;
  registeredBoardId: string | null;
  evidence: DiscoveryEvidenceView[];
}

export interface DiscoveryRunView {
  id: string;
  source: string;
  trigger: "manual" | "scheduled";
  status: "running" | "succeeded" | "partial" | "failed";
  startedAt: string;
  finishedAt: string | null;
  searchRequests: number;
  searchProvider: string | null;
  searchCredits: number;
  candidateUrls: number;
  uniqueCandidates: number;
  newCandidates: number;
  validated: number;
  registered: number;
  pendingReview: number;
  rejected: number;
  apiErrors: number;
  atsRequests: number;
  siteRequests: number;
  errorMessage: string | null;
}

export interface DiscoveryDashboard {
  counts: Record<DiscoveryCandidateView["status"], number> & { total: number; autoRegistered: number };
  runs: DiscoveryRunView[];
  nextRunAt: string | null;
  runRequested: boolean;
  scheduledEnabled: boolean;
  intervalHours: number;
  searchStatus: string | null;
  searchRequests24h: number;
  maxRequestsPerDay: number;
  tavilyCreditsThisMonth: number;
  maxCreditsPerMonth: number;
  candidates: DiscoveryCandidateView[];
}

const iso = (d: Date) => d.toISOString();

function evidenceSummary(type: string, metadata: unknown): string | null {
  const m = (metadata ?? {}) as Record<string, unknown>;
  switch (type) {
    case "ats_board_response":
      return typeof m.postings === "number" ? `${m.postings} published posting${m.postings === 1 ? "" : "s"}${m.complete === false ? " (listing incomplete)" : ""}` : "Board confirmed by the provider";
    case "official_site_link":
    case "official_site_redirect":
      return Array.isArray(m.attempts) ? `Checked ${String(m.domain)}: ${(m.attempts as { url: string; result: string }[]).map((a) => `${a.url} → ${a.result}`).join("; ")}` : `Company site ${String(m.domain ?? "")}`;
    case "search_result":
      return typeof m.query === "string" ? `Search query: ${m.query}` : null;
    case "common_crawl":
      return `Common Crawl ${String(m.crawl ?? "")} ${String(m.timestamp ?? "")}`.trim();
    case "manual_review":
      return `${String(m.decision ?? "")}${m.reason ? `: ${String(m.reason)}` : ""}`;
    case "career_page_extraction":
      return `${typeof m.jobs === "number" ? `${m.jobs} job${m.jobs === 1 ? "" : "s"} extracted` : "Extraction attempted"}${m.strategy ? ` via ${String(m.strategy)}` : ""}${m.complete === true ? " (listing complete)" : m.complete === false ? " (listing not provably complete)" : ""}${Array.isArray(m.diagnostics) && m.diagnostics.length ? ` — ${String(m.diagnostics[0])}` : ""}`;
    case "routed_to_ats":
      return `Careers page leads to ${String(m.target ?? "a supported ATS board")}`;
    default:
      return null;
  }
}

export async function loadDiscoveryDashboard(prisma: PrismaClient, env: Readonly<Record<string, string | undefined>> = process.env): Promise<DiscoveryDashboard> {
  let config;
  try {
    config = discoveryConfigFromEnv(env);
  } catch {
    config = null;
  }
  const now = new Date();
  const [groups, autoRegistered, runs, schedule, used, monthlyCredits, candidates] = await Promise.all([
    prisma.discoveryCandidate.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.employerBoard.count({ where: { origin: "discovered" } }),
    prisma.discoveryRun.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
    prisma.discoverySchedule.findUnique({ where: { id: SCHEDULE_ID } }),
    searchRequestsLast24h(prisma, now),
    tavilyCreditsThisMonth(prisma, now),
    prisma.discoveryCandidate.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 200,
      include: { evidence: { orderBy: { observedAt: "desc" }, take: 12 } },
    }),
  ]);
  const counts = { discovered: 0, validating: 0, verified: 0, pending_review: 0, rejected: 0, registered: 0, unsupported: 0, total: 0, autoRegistered };
  for (const g of groups) {
    counts[g.status] = g._count._all;
    counts.total += g._count._all;
  }
  const order: Record<string, number> = { pending_review: 0, verified: 1, validating: 2, discovered: 3, registered: 4, unsupported: 5, rejected: 6 };
  return {
    counts,
    runs: runs.map((r) => ({
      ...r,
      startedAt: iso(r.startedAt),
      finishedAt: r.finishedAt ? iso(r.finishedAt) : null,
    })),
    nextRunAt: schedule?.nextRunAt ? iso(schedule.nextRunAt) : null,
    runRequested: !!schedule?.requestedAt,
    scheduledEnabled: config?.enabled ?? false,
    intervalHours: config?.intervalHours ?? 24,
    searchStatus: config ? searchUnavailableReason(config) : "Discovery settings are invalid; see the worker log.",
    searchRequests24h: used,
    maxRequestsPerDay: config?.maxRequestsPerDay ?? 0,
    tavilyCreditsThisMonth: monthlyCredits,
    maxCreditsPerMonth: config?.maxCreditsPerMonth ?? 0,
    candidates: candidates
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9))
      .map((c) => ({
        id: c.id,
        provider: c.provider as AtsProvider,
        boardToken: c.boardToken,
        region: c.region === "eu" ? "eu" : null,
        boardUrl: c.boardUrl,
        companyName: c.companyName,
        companyDomain: c.companyDomain,
        source: c.source,
        status: c.status,
        extractionStrategy: c.extractionStrategy,
        statusReason: c.statusReason,
        postingCount: c.postingCount,
        firstDiscoveredAt: iso(c.firstDiscoveredAt),
        lastVerifiedAt: c.lastVerifiedAt ? iso(c.lastVerifiedAt) : null,
        registeredBoardId: c.registeredBoardId,
        evidence: c.evidence.map((e) => ({
          id: e.id,
          type: e.type,
          status: e.status,
          sourceUrl: e.sourceUrl,
          observedAt: iso(e.observedAt),
          summary: evidenceSummary(e.type, e.metadata),
        })),
      })),
  };
}
