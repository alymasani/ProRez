/**
 * Serializable outcome of every mutation. Server Actions return these instead
 * of throwing so the UI can show precise, recoverable states.
 */
import type { DuplicateMatch } from "../jobs/duplicates";

export type MutationErrorCode =
  | "validation"
  | "name_taken"
  | "duplicate"
  | "possible_duplicate"
  | "not_editable"
  | "invalid_transition"
  | "sync_in_progress"
  | "version_conflict"
  | "not_found"
  | "archived"
  | "read_only"
  | "forbidden"
  | "unexpected";

export type MutationFailure = {
  ok: false;
  code: MutationErrorCode;
  message: string;
  fieldErrors?: Record<string, string>;
  formErrors?: string[];
  /** For version conflicts: the version currently stored. */
  currentVersion?: number;
  /** For job intake: the existing jobs this submission matches. */
  duplicates?: DuplicateMatch[];
  /** For duplicates: id of the existing record. */
  existingId?: string;
};

export type MutationResult<T> = { ok: true; value: T } | MutationFailure;

export const fail = (code: MutationErrorCode, message: string, extra: Partial<MutationFailure> = {}): MutationFailure => ({
  ok: false,
  code,
  message,
  ...extra,
});

/** Prisma known-request error codes, without importing runtime classes into pure code. */
export function prismaErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : null;
}
