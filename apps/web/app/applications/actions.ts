"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireMutationAccess } from "@/lib/auth/server-actor";
import { getPrisma } from "@/lib/db/client";
import { changeSubmissionStatus, createApplication, recordInterview, updateApplicationNotes } from "@/lib/applications/service";
import { fail, type MutationResult } from "@/lib/mutations/result";
import { APPLICATION_MODES, INTERVIEW_STAGES, SUBMISSION_STATUSES, type Application } from "@/lib/types";

const id = z.string().min(1).max(200);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const notes = z.string().max(10_000);
async function run<T>(fn: () => Promise<MutationResult<T>>): Promise<MutationResult<T>> {
  const access = await requireMutationAccess(); if (!access.ok) return fail(access.code, access.message);
  try { const result = await fn(); if (result.ok) refresh(); return result; }
  catch (error) { console.error("[applications] mutation failed", error); return fail("unexpected", "The application could not be updated."); }
}

export async function createApplicationAction(input: unknown): Promise<MutationResult<Application>> {
  const parsed = z.strictObject({ jobId: id, mode: z.enum(APPLICATION_MODES), notes }).safeParse(input);
  if (!parsed.success) return fail("validation", "Invalid application details.");
  return run(() => createApplication(getPrisma(), parsed.data));
}

export async function changeApplicationStatusAction(input: unknown): Promise<MutationResult<Application>> {
  const parsed = z.strictObject({ applicationId: id, expectedStatus: z.enum(SUBMISSION_STATUSES), to: z.enum(SUBMISSION_STATUSES), submittedOn: z.string().max(10).nullable(), note: z.string().max(2000).nullable(), today: date }).safeParse(input);
  if (!parsed.success) return fail("validation", "Invalid status update.");
  return run(() => changeSubmissionStatus(getPrisma(), parsed.data));
}

export async function updateApplicationNotesAction(input: unknown): Promise<MutationResult<Application>> {
  const parsed = z.strictObject({ applicationId: id, expectedUpdatedAt: z.string().datetime(), notes }).safeParse(input);
  if (!parsed.success) return fail("validation", "Invalid notes update.");
  return run(() => updateApplicationNotes(getPrisma(), parsed.data));
}

export async function recordInterviewAction(input: unknown): Promise<MutationResult<Application>> {
  const parsed = z.strictObject({ applicationId: id, stage: z.enum(INTERVIEW_STAGES), occurredOn: date, notes: z.string().max(2000), today: date }).safeParse(input);
  if (!parsed.success) return fail("validation", "Invalid interview details.");
  return run(() => recordInterview(getPrisma(), parsed.data));
}
