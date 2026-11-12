/**
 * Registration of discovered boards (Milestone 3C) through the existing board
 * model and scheduling rule, so new boards enter the Milestone 3B worker queue
 * exactly like boards the user adds.
 *
 * Safety:
 * - One transaction; the candidate row is locked (SELECT … FOR UPDATE), so
 *   concurrent registrations of the same candidate serialise; uniqueness on
 *   (provider, board token), board URL, company domain and the candidate's
 *   registered board is the final backstop.
 * - Idempotent: a registered candidate returns its board; nothing new is made.
 * - An existing board (manual or discovered) is LINKED, never modified.
 * - A company is matched only by VERIFIED domain — never by name — so similar
 *   names are never merged; one company can own several boards.
 * - Automatic registration requires status `verified` (ownership evidence).
 *   Manual approval (pending review) re-validates the board first and does not
 *   attach an unverified domain to a company.
 */
import type { PrismaClient } from "../generated/prisma/client";
import { AtsError, type HttpTransport } from "../ats/http";
import { ATS_ADAPTERS } from "../ats/registry";
import type { AtsProvider } from "../types";
import { initialNextSyncAt } from "../boards/service";
import { POLL_INTERVAL } from "../boards/schema";
import { fail, prismaErrorCode, type MutationResult } from "../mutations/result";
import { canTransition, recordEvidence, type CandidateStatus } from "./candidates";

export interface RegisterInput {
  candidateId: string;
  mode: "automatic" | "manual_approval";
  /** Required for manual approval when the candidate has no name. */
  employerName?: string | null;
  now?: Date;
}

export async function registerCandidate(prisma: PrismaClient, input: RegisterInput): Promise<MutationResult<{ boardId: string; created: boolean }>> {
  const now = input.now ?? new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "discovery_candidates" WHERE "id" = ${input.candidateId}::uuid FOR UPDATE`;
      if (locked.length === 0) return fail("not_found", "This candidate no longer exists.");
      const c = await tx.discoveryCandidate.findUniqueOrThrow({ where: { id: input.candidateId } });
      const status = c.status as CandidateStatus;

      if (status === "registered" && c.registeredBoardId) return { ok: true, value: { boardId: c.registeredBoardId, created: false } };
      const allowed = input.mode === "automatic" ? status === "verified" : status === "verified" || status === "pending_review";
      if (!allowed || !canTransition(status, "registered")) {
        return fail("invalid_transition", input.mode === "automatic" ? "Only verified candidates are registered automatically." : `A ${status.replace("_", " ")} candidate cannot be approved.`);
      }

      // Equivalent board already registered: link it, change nothing on it.
      const existing = await tx.employerBoard.findUnique({ where: { provider_boardToken: { provider: c.provider, boardToken: c.boardToken } }, select: { id: true } });
      if (existing) {
        await tx.discoveryCandidate.update({ where: { id: c.id }, data: { status: "registered", registeredBoardId: existing.id, statusReason: "Already registered.", updatedAt: now } });
        await recordEvidence(tx, c.id, { type: "existing_board", status: "validated", observedAt: now, metadata: { boardId: existing.id } });
        return { ok: true, value: { boardId: existing.id, created: false } };
      }

      const verifiedDomain = status === "verified" ? c.companyDomain : null;
      const employerName = (input.employerName?.trim() || c.companyName?.trim() || "").slice(0, 120);
      if (!employerName) return fail("validation", "Enter the employer's name to approve this board.", { fieldErrors: { employerName: "Enter the employer's name." } });

      // Company by verified domain only; created if new. Never merged by name.
      // INSERT … ON CONFLICT is atomic: concurrent registrations of two boards
      // of the same company (verified in parallel) share one company row.
      // (Prisma's upsert is read-then-insert and races on the unique domain.)
      let company: { id: string } | null = null;
      if (verifiedDomain) {
        await tx.$executeRaw`
          INSERT INTO "companies" ("id", "name", "domain", "origin", "created_at", "updated_at")
          VALUES (gen_random_uuid(), ${employerName}, ${verifiedDomain}, 'discovered', ${now}, ${now})
          ON CONFLICT ("domain") DO NOTHING`;
        company = await tx.company.findUniqueOrThrow({ where: { domain: verifiedDomain }, select: { id: true } });
      }

      const board = await tx.employerBoard.create({
        data: {
          provider: c.provider,
          boardToken: c.boardToken,
          region: c.region,
          boardUrl: c.boardUrl,
          employerName,
          enabled: true,
          pollIntervalMinutes: POLL_INTERVAL.default,
          origin: "discovered",
          companyId: company?.id ?? null,
          nextSyncAt: initialNextSyncAt(true, false, now),
        },
        select: { id: true },
      });
      await tx.discoveryCandidate.update({
        where: { id: c.id },
        data: {
          status: "registered",
          registeredBoardId: board.id,
          statusReason: input.mode === "automatic" ? "Registered automatically after ownership verification." : "Approved by you.",
          updatedAt: now,
        },
      });
      if (input.mode === "manual_approval") {
        await recordEvidence(tx, c.id, { type: "manual_review", status: "validated", dedupeKey: "manual_review|approved", observedAt: now, metadata: { decision: "approved", employerName } });
      }
      return { ok: true, value: { boardId: board.id, created: true } };
    });
  } catch (error) {
    // A concurrent registration won the race on a unique constraint: link to its board.
    if (prismaErrorCode(error) === "P2002") {
      const c = await prisma.discoveryCandidate.findUnique({ where: { id: input.candidateId } });
      const board = c ? await prisma.employerBoard.findUnique({ where: { provider_boardToken: { provider: c.provider, boardToken: c.boardToken } }, select: { id: true } }) : null;
      if (c && board) {
        await prisma.discoveryCandidate.updateMany({ where: { id: c.id, status: { not: "registered" } }, data: { status: "registered", registeredBoardId: board.id, statusReason: "Already registered." } });
        return { ok: true, value: { boardId: board.id, created: false } };
      }
    }
    throw error;
  }
}

export async function rejectCandidate(prisma: PrismaClient, candidateId: string, reason: string, now = new Date()): Promise<MutationResult<{ id: string }>> {
  const c = await prisma.discoveryCandidate.findUnique({ where: { id: candidateId }, select: { status: true } });
  if (!c) return fail("not_found", "This candidate no longer exists.");
  if (!canTransition(c.status as CandidateStatus, "rejected")) return fail("invalid_transition", `A ${c.status.replace("_", " ")} candidate cannot be rejected.`);
  await prisma.$transaction(async (tx) => {
    await tx.discoveryCandidate.updateMany({ where: { id: candidateId, status: c.status }, data: { status: "rejected", statusReason: reason.slice(0, 300) || "Rejected by you." } });
    await recordEvidence(tx, candidateId, { type: "manual_review", status: "validated", dedupeKey: "manual_review|rejected", observedAt: now, metadata: { decision: "rejected", reason } });
  });
  return { ok: true, value: { id: candidateId } };
}

/** Queues a candidate for verification again (re-validate). */
export async function requeueCandidate(prisma: PrismaClient, candidateId: string, now = new Date()): Promise<MutationResult<{ id: string }>> {
  const c = await prisma.discoveryCandidate.findUnique({ where: { id: candidateId }, select: { status: true } });
  if (!c) return fail("not_found", "This candidate no longer exists.");
  if (!canTransition(c.status as CandidateStatus, "discovered")) return fail("invalid_transition", `A ${c.status.replace("_", " ")} candidate cannot be re-validated.`);
  await prisma.discoveryCandidate.updateMany({ where: { id: candidateId, status: c.status }, data: { status: "discovered", attempts: 0, nextAttemptAt: now, statusReason: "Queued for re-validation." } });
  return { ok: true, value: { id: candidateId } };
}

/**
 * Manual approval of a pending (or verified) candidate. The board's identity is
 * re-validated against the live provider first, so approval can never register
 * a board that does not exist; deduplication is enforced by registerCandidate.
 */
export async function approveCandidate(
  prisma: PrismaClient,
  input: { candidateId: string; employerName: string | null; transport: HttpTransport; now?: Date },
): Promise<MutationResult<{ boardId: string; created: boolean }>> {
  const c = await prisma.discoveryCandidate.findUnique({ where: { id: input.candidateId } });
  if (!c) return fail("not_found", "This candidate no longer exists.");
  if (c.status === "registered" && c.registeredBoardId) return { ok: true, value: { boardId: c.registeredBoardId, created: false } };
  if (c.status !== "pending_review" && c.status !== "verified") return fail("invalid_transition", `A ${c.status.replace("_", " ")} candidate cannot be approved.`);
  try {
    await ATS_ADAPTERS[c.provider as AtsProvider].fetchPostings(c.boardToken, { transport: input.transport, region: c.region === "eu" ? "eu" : null });
  } catch (error) {
    const message = error instanceof AtsError && error.code === "not_found" ? "The provider no longer has a public board with this identifier." : `Could not confirm the board with the provider: ${error instanceof Error ? error.message : "error"}`;
    return fail("validation", message);
  }
  await recordEvidence(prisma, c.id, { type: "ats_board_response", status: "validated", sourceUrl: c.boardUrl, observedAt: input.now ?? new Date(), metadata: { confirmedForApproval: true } });
  return registerCandidate(prisma, { candidateId: c.id, mode: "manual_approval", employerName: input.employerName, now: input.now });
}
