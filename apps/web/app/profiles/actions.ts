"use server";

/**
 * Search-profile mutations. Server Actions are reachable by direct POST, so
 * EVERY action re-checks access (requireMutationAccess) and parses its input
 * strictly; nothing from the client is trusted.
 */
import { refresh } from "next/cache";
import { z } from "zod";
import { requireMutationAccess } from "@/lib/auth/server-actor";
import { getPrisma } from "@/lib/db/client";
import { reevaluateAllJobs } from "@/lib/matching/persist";
import { fail, type MutationResult } from "@/lib/mutations/result";
import { parseProfileDraft } from "@/lib/profiles/schema";
import {
  createProfile,
  deleteProfile,
  duplicateProfile,
  setProfileEnabled,
  updateProfile,
  type DeleteOutcome,
} from "@/lib/profiles/service";
import type { SearchProfile } from "@/lib/types";

const idSchema = z.string().min(1).max(200);
const versionSchema = z.number().int().min(1);

export interface SavedProfile {
  profile: SearchProfile;
  /** Set if the profile saved but matches could not be refreshed. */
  warning: string | null;
}

async function run<T>(action: () => Promise<MutationResult<T>>): Promise<MutationResult<T>> {
  const access = await requireMutationAccess();
  if (!access.ok) return fail(access.code, access.message);
  try {
    return await action();
  } catch (error) {
    console.error("[profiles] mutation failed", error);
    return fail("unexpected", "Something went wrong while saving. Nothing was changed — please try again.");
  }
}

/** Re-runs matching after a committed change; a failure here never undoes the save. */
async function afterChange(): Promise<string | null> {
  try {
    await reevaluateAllJobs(getPrisma());
    return null;
  } catch (error) {
    console.error("[profiles] re-evaluation failed", error);
    return "Saved, but job matches could not be refreshed. They will update on the next change.";
  } finally {
    refresh();
  }
}

function invalid(parsed: { fieldErrors: Record<string, string>; formErrors: string[] }) {
  return fail("validation", "Please fix the highlighted fields.", {
    fieldErrors: parsed.fieldErrors,
    formErrors: parsed.formErrors,
  });
}

export async function createProfileAction(input: unknown): Promise<MutationResult<SavedProfile>> {
  return run(async () => {
    const parsed = parseProfileDraft(input);
    if (!parsed.ok) return invalid(parsed);
    const result = await createProfile(getPrisma(), parsed.draft);
    if (!result.ok) return result;
    return { ok: true, value: { profile: result.value, warning: await afterChange() } };
  });
}

export async function updateProfileAction(
  id: unknown,
  expectedVersion: unknown,
  input: unknown,
): Promise<MutationResult<SavedProfile>> {
  return run(async () => {
    const pid = idSchema.safeParse(id);
    const version = versionSchema.safeParse(expectedVersion);
    if (!pid.success || !version.success) return fail("validation", "Invalid profile reference.");
    const parsed = parseProfileDraft(input);
    if (!parsed.ok) return invalid(parsed);
    const result = await updateProfile(getPrisma(), pid.data, version.data, parsed.draft);
    if (!result.ok) return result;
    return { ok: true, value: { profile: result.value, warning: await afterChange() } };
  });
}

export async function setProfileEnabledAction(id: unknown, enabled: unknown): Promise<MutationResult<SavedProfile>> {
  return run(async () => {
    const pid = idSchema.safeParse(id);
    const flag = z.boolean().safeParse(enabled);
    if (!pid.success || !flag.success) return fail("validation", "Invalid request.");
    const result = await setProfileEnabled(getPrisma(), pid.data, flag.data);
    if (!result.ok) return result;
    return { ok: true, value: { profile: result.value, warning: await afterChange() } };
  });
}

export async function duplicateProfileAction(id: unknown): Promise<MutationResult<SavedProfile>> {
  return run(async () => {
    const pid = idSchema.safeParse(id);
    if (!pid.success) return fail("validation", "Invalid profile reference.");
    const result = await duplicateProfile(getPrisma(), pid.data);
    if (!result.ok) return result;
    // The copy is disabled, so matches are unaffected; just refresh the UI.
    refresh();
    return { ok: true, value: { profile: result.value, warning: null } };
  });
}

export async function deleteProfileAction(id: unknown): Promise<MutationResult<DeleteOutcome>> {
  return run(async () => {
    const pid = idSchema.safeParse(id);
    if (!pid.success) return fail("validation", "Invalid profile reference.");
    const result = await deleteProfile(getPrisma(), pid.data);
    if (!result.ok) return result;
    await afterChange();
    return result;
  });
}
