"use server";
import { refresh } from "next/cache";
import { requireMutationAccess } from "@/lib/auth/server-actor";
import { getPrisma } from "@/lib/db/client";
import { changeDiscoveryStatus, createManualJob, updateJobNotes, type SavedJob } from "@/lib/jobs/service";
import { DISCOVERY_ACTIONS, NOTES_SCHEMA, parseManualJobInput } from "@/lib/jobs/schema";
import { fail, type MutationResult } from "@/lib/mutations/result";
import { DISCOVERY_STATUSES, type JobPosting } from "@/lib/types";
import { z } from "zod";

const id = z.string().min(1).max(200);

async function access() {
  const result = await requireMutationAccess();
  return result.ok ? null : fail(result.code, result.message);
}

export async function createManualJobAction(input: unknown): Promise<MutationResult<SavedJob>> {
  const access = await requireMutationAccess();
  if (!access.ok) return fail(access.code, access.message);
  const parsed = parseManualJobInput(input, "create");
  if (!parsed.ok) return fail("validation", "Please fix the highlighted fields.", { fieldErrors: parsed.fieldErrors, formErrors: parsed.formErrors });
  try {
    const result = await createManualJob(getPrisma(), parsed.job);
    if (result.ok) refresh();
    return result;
  } catch (error) {
    console.error("[jobs] manual submission failed", error);
    return fail("unexpected", "The job could not be saved. Nothing was changed; please try again.");
  }
}

export async function changeJobStatusAction(jobId: unknown, action: unknown, expected: unknown): Promise<MutationResult<JobPosting>> {
  const denied = await access(); if (denied) return denied;
  const parsed = z.tuple([id, z.enum(DISCOVERY_ACTIONS), z.enum(DISCOVERY_STATUSES)]).safeParse([jobId, action, expected]);
  if (!parsed.success) return fail("validation", "Invalid job status request.");
  try { const result = await changeDiscoveryStatus(getPrisma(), ...parsed.data); if (result.ok) refresh(); return result; }
  catch (error) { console.error("[jobs] status failed", error); return fail("unexpected", "The job status could not be changed."); }
}

export async function updateJobNotesAction(jobId: unknown, notes: unknown): Promise<MutationResult<JobPosting>> {
  const denied = await access(); if (denied) return denied;
  const parsed = z.tuple([id, NOTES_SCHEMA]).safeParse([jobId, notes]);
  if (!parsed.success) return fail("validation", "Notes are too long or invalid.");
  try { const result = await updateJobNotes(getPrisma(), parsed.data[0], parsed.data[1]); if (result.ok) refresh(); return result; }
  catch (error) { console.error("[jobs] notes failed", error); return fail("unexpected", "Notes could not be saved."); }
}
