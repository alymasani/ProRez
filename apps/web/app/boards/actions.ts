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
