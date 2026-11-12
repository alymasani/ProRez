/** Employer-board registry persistence. No polling happens here. */
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
    const row = await prisma.employerBoard.create({ data: { ...board, isDemo: options.isDemo ?? false } });
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
  const updated = await prisma.employerBoard.updateMany({ where: { id }, data: { enabled } });
  if (updated.count === 0) return fail("not_found", "This board no longer exists.");
  return { ok: true, value: toEmployerBoard(await prisma.employerBoard.findUniqueOrThrow({ where: { id } })) };
}

/** Observations keep their source; only the board link is cleared (FK ON DELETE SET NULL). */
export async function deleteBoard(prisma: PrismaClient, id: string): Promise<MutationResult<{ id: string }>> {
  const deleted = await prisma.employerBoard.deleteMany({ where: { id } });
  return deleted.count === 0 ? fail("not_found", "This board no longer exists.") : { ok: true, value: { id } };
}
