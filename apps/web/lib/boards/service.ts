/**
 * Employer-board registry persistence. Registering or enabling a real board
 * schedules it for the background worker immediately (next_sync_at = now);
 * disabling unschedules it. Demo boards are never scheduled.
 */
import type { PrismaClient } from "../generated/prisma/client";
import { fail, prismaErrorCode, type MutationResult } from "../mutations/result";
import { toEmployerBoard } from "../repositories/prisma-mappers";
import type { EmployerBoard } from "../types";
import type { ParsedBoard } from "./schema";

const DUPLICATE = "This board is already registered.";

export async function createBoard(
  prisma: PrismaClient,
  board: ParsedBoard,
  options: { isDemo?: boolean } = {},
): Promise<MutationResult<EmployerBoard>> {
  try {
    const isDemo = options.isDemo ?? false;
    const row = await prisma.employerBoard.create({
      data: { ...board, isDemo, nextSyncAt: board.enabled && !isDemo ? new Date() : null },
    });
    return { ok: true, value: toEmployerBoard(row) };
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") return fail("duplicate", DUPLICATE, { fieldErrors: { boardToken: DUPLICATE } });
    throw error;
  }
}

export async function setBoardEnabled(
  prisma: PrismaClient,
  id: string,
  enabled: boolean,
): Promise<MutationResult<EmployerBoard>> {
  const current = await prisma.employerBoard.findUnique({ where: { id }, select: { isDemo: true } });
  if (!current) return fail("not_found", "This board no longer exists.");
  // Enabling (re)schedules now — this is also how a board paused by a
  // configuration error is resumed; disabling stops automatic syncs.
  const updated = await prisma.employerBoard.updateMany({
    where: { id },
    data: { enabled, nextSyncAt: enabled && !current.isDemo ? new Date() : null },
  });
  if (updated.count === 0) return fail("not_found", "This board no longer exists.");
  return { ok: true, value: toEmployerBoard(await prisma.employerBoard.findUniqueOrThrow({ where: { id } })) };
}

/** Observations keep their source; only the board link is cleared (FK ON DELETE SET NULL). */
export async function deleteBoard(prisma: PrismaClient, id: string): Promise<MutationResult<{ id: string }>> {
  const deleted = await prisma.employerBoard.deleteMany({ where: { id } });
  return deleted.count === 0 ? fail("not_found", "This board no longer exists.") : { ok: true, value: { id } };
}
