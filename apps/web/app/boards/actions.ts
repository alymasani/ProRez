"use server";

/** Employer-board registry mutations. Same access rules as profiles. */
import { refresh } from "next/cache";
import { z } from "zod";
import { requireMutationAccess } from "@/lib/auth/server-actor";
import { parseBoardInput } from "@/lib/boards/schema";
import { createBoard, deleteBoard, setBoardEnabled } from "@/lib/boards/service";
import { resolveTransport } from "@/lib/ats/http";
import { syncBoard, type SyncSummary } from "@/lib/ats/sync";
import { getPrisma } from "@/lib/db/client";
import { fail, type MutationResult } from "@/lib/mutations/result";
import type { EmployerBoard } from "@/lib/types";
import { approveCandidate, rejectCandidate, requeueCandidate } from "@/lib/discovery/register";
import { requestDiscoveryRun } from "@/lib/discovery/run";

const idSchema = z.uuid();

async function run<T>(action: () => Promise<MutationResult<T>>): Promise<MutationResult<T>> {
  const access = await requireMutationAccess();
  if (!access.ok) return fail(access.code, access.message);
  try {
    const result = await action();
    if (result.ok) refresh();
    return result;
  } catch (error) {
    console.error("[boards] mutation failed", error);
    return fail("unexpected", "Something went wrong while saving. Nothing was changed — please try again.");
  }
}

export async function createBoardAction(input: unknown): Promise<MutationResult<EmployerBoard>> {
  return run(async () => {
    const parsed = parseBoardInput(input);
    if (!parsed.ok) {
      return fail("validation", "Please fix the highlighted fields.", {
        fieldErrors: parsed.fieldErrors,
        formErrors: parsed.formErrors,
      });
    }
    return createBoard(getPrisma(), parsed.board);
  });
}

export async function setBoardEnabledAction(id: unknown, enabled: unknown): Promise<MutationResult<EmployerBoard>> {
  return run(async () => {
    const bid = idSchema.safeParse(id);
    const flag = z.boolean().safeParse(enabled);
    if (!bid.success || !flag.success) return fail("validation", "Invalid request.");
    return setBoardEnabled(getPrisma(), bid.data, flag.data);
  });
}

export async function deleteBoardAction(id: unknown): Promise<MutationResult<{ id: string }>> {
  return run(async () => {
    const bid = idSchema.safeParse(id);
    if (!bid.success) return fail("validation", "Invalid request.");
    return deleteBoard(getPrisma(), bid.data);
  });
}

/**
 * Manually synchronizes one registered board: fetches its published postings
 * from the provider's official public API and ingests them. Same local-only
 * access rules as every other write. The request target is derived from the
 * stored provider + validated board token only (lib/ats/http.ts allow-list).
 */
export async function syncBoardAction(id: unknown): Promise<MutationResult<SyncSummary>> {
  return run(async () => {
    const bid = idSchema.safeParse(id);
    if (!bid.success) return fail("validation", "Invalid request.");
    return syncBoard(getPrisma(), bid.data, { transport: resolveTransport() });
  });
}

// ---------------------------------------------------------------------------
// Discovery (Milestone 3C). Same local-only access rules. Discovery runs only
// in the worker process; these actions record requests and review decisions.
// ---------------------------------------------------------------------------

/** Asks the worker to run discovery as soon as it next checks (within its poll interval). */
export async function requestDiscoveryRunAction(): Promise<MutationResult<{ requested: true }>> {
  return run(async () => {
    await requestDiscoveryRun(getPrisma());
    return { ok: true, value: { requested: true } };
  });
}

/** Approves a pending candidate after re-validating the board with its provider. */
export async function approveCandidateAction(id: unknown, employerName: unknown): Promise<MutationResult<{ boardId: string; created: boolean }>> {
  return run(async () => {
    const cid = idSchema.safeParse(id);
    const name = z.string().max(120).nullable().safeParse(employerName ?? null);
    if (!cid.success || !name.success) return fail("validation", "Invalid request.");
    return approveCandidate(getPrisma(), { candidateId: cid.data, employerName: name.data, transport: resolveTransport() });
  });
}

export async function rejectCandidateAction(id: unknown, reason: unknown): Promise<MutationResult<{ id: string }>> {
  return run(async () => {
    const cid = idSchema.safeParse(id);
    const why = z.string().max(300).safeParse(typeof reason === "string" ? reason.trim() : "");
    if (!cid.success || !why.success) return fail("validation", "Invalid request.");
    return rejectCandidate(getPrisma(), cid.data, why.data || "Rejected by you.");
  });
}

/** Queues a candidate for verification again (performed by the worker's next discovery run). */
export async function revalidateCandidateAction(id: unknown): Promise<MutationResult<{ id: string }>> {
  return run(async () => {
    const cid = idSchema.safeParse(id);
    if (!cid.success) return fail("validation", "Invalid request.");
    const result = await requeueCandidate(getPrisma(), cid.data);
    if (result.ok) await requestDiscoveryRun(getPrisma());
    return result;
  });
}
