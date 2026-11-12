/**
 * Application tracking persistence. Expects parsed input and an authorised
 * actor (app/applications/actions.ts).
 *
 * - One application per job (unique job_id); creating one for a job that
 *   already has one returns the existing id instead of a second record.
 * - Status changes are compare-and-swap on the status the user saw, validated
 *   by ./transitions.ts, and always append an application event. History is
 *   append-only (a database trigger rejects edits to events).
 * - Preparation status is never changed here: recording progress with the
 *   employer and generating materials are separate lifecycles.
 */
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { fail, prismaErrorCode, type MutationResult } from "../mutations/result";
import { toApplication } from "../repositories/prisma-mappers";
import type { Application, ApplicationMode, InterviewStage, SubmissionStatus } from "../types";
import {
  planInterviewStatus,
  planSubmissionChange,
  planSubmissionDateCorrection,
  validateInterviewDate,
  type PlannedEvent,
} from "./transitions";

type Tx = Prisma.TransactionClient;

const CHANGED_ELSEWHERE = "This application was changed elsewhere. The page now shows the latest version; nothing was saved.";

async function load(tx: Tx, id: string): Promise<Application> {
  return toApplication(await tx.application.findUniqueOrThrow({ where: { id } }));
}

async function addEvents(tx: Tx, applicationId: string, events: readonly PlannedEvent[], now: Date) {
  if (events.length === 0) return;
  await tx.applicationEvent.createMany({
    data: events.map((e, i) => ({
      applicationId,
      type: e.type,
      fromValue: e.fromValue,
      toValue: e.toValue,
      message: e.message,
      // Keep a stable order for events written together.
      occurredAt: new Date(now.getTime() + i),
    })),
  });
}

/**
 * Starts tracking an application for a job. Also saves the job (discovered →
 * saved) so it stays easy to find; the job event says so.
 */
export async function createApplication(
  prisma: PrismaClient,
  input: { jobId: string; mode: ApplicationMode; notes: string },
  now: Date = new Date(),
): Promise<MutationResult<Application>> {
  try {
    return await prisma.$transaction(async (tx) => {
      const job = await tx.jobPosting.findUnique({
        where: { id: input.jobId },
        select: { discoveryStatus: true, application: { select: { id: true } } },
      });
      if (!job) return fail("not_found", "This job no longer exists.");
      if (job.application) {
        return fail("duplicate", "You're already tracking an application for this job.", { existingId: job.application.id });
      }
      if (job.discoveryStatus === "dismissed") {
        return fail("invalid_transition", "Restore this job before tracking an application for it.");
      }

      const id = `app-${randomUUID()}`;
      await tx.application.create({
        data: { id, jobId: input.jobId, mode: input.mode, notes: input.notes, createdAt: now, updatedAt: now },
      });
      await addEvents(tx, id, [{ type: "created", fromValue: null, toValue: input.mode, message: "Started tracking this application." }], now);
      if (job.discoveryStatus === "discovered") {
        await tx.jobPosting.update({ where: { id: input.jobId }, data: { discoveryStatus: "saved" } });
        await tx.jobEvent.create({
          data: {
            jobId: input.jobId,
            type: "discovery_status_changed",
            fromValue: "discovered",
            toValue: "saved",
            message: "Saved automatically when you started tracking an application.",
            occurredAt: now,
          },
        });
      }
      return { ok: true as const, value: await load(tx, id) };
    });
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") {
      const existing = await prisma.application.findUnique({ where: { jobId: input.jobId }, select: { id: true } });
      return fail("duplicate", "You're already tracking an application for this job.", { existingId: existing?.id });
    }
    throw error;
  }
}

export async function changeSubmissionStatus(
  prisma: PrismaClient,
  input: {
    applicationId: string;
    expectedStatus: SubmissionStatus;
    to: SubmissionStatus;
    submittedOn: string | null;
    note: string | null;
    today: string;
  },
  now: Date = new Date(),
): Promise<MutationResult<Application>> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.application.findUnique({ where: { id: input.applicationId } });
    if (!current) return fail("not_found", "This application no longer exists.");
    if (current.submissionStatus !== input.expectedStatus) return fail("version_conflict", CHANGED_ELSEWHERE);

    const plan = planSubmissionChange(
      { status: current.submissionStatus, submittedAt: current.submittedAt?.toISOString() ?? null },
      { to: input.to, submittedOn: input.submittedOn, note: input.note },
      input.today,
    );
    if (!plan.ok) {
      return fail(plan.field === "submittedOn" ? "validation" : "invalid_transition", plan.message, {
        fieldErrors: plan.field ? { [plan.field]: plan.message } : undefined,
      });
    }

    const updated = await tx.application.updateMany({
      where: { id: input.applicationId, submissionStatus: input.expectedStatus },
      data: { submissionStatus: plan.status, submittedAt: plan.submittedAt ? new Date(plan.submittedAt) : null },
    });
    if (updated.count !== 1) return fail("version_conflict", CHANGED_ELSEWHERE);
    await addEvents(tx, input.applicationId, plan.events, now);
    return { ok: true as const, value: await load(tx, input.applicationId) };
  });
}

export async function correctSubmissionDate(
  prisma: PrismaClient,
  input: { applicationId: string; submittedOn: string; today: string },
  now: Date = new Date(),
): Promise<MutationResult<Application>> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.application.findUnique({ where: { id: input.applicationId } });
    if (!current) return fail("not_found", "This application no longer exists.");
    const plan = planSubmissionDateCorrection(current.submittedAt?.toISOString() ?? null, input.submittedOn, input.today);
    if (!plan.ok) return fail("validation", plan.message, { fieldErrors: { submittedOn: plan.message } });
    const updated = await tx.application.updateMany({
      where: { id: input.applicationId, submittedAt: current.submittedAt },
      data: { submittedAt: new Date(plan.submittedAt) },
    });
    if (updated.count !== 1) return fail("version_conflict", CHANGED_ELSEWHERE);
    await addEvents(tx, input.applicationId, [plan.event], now);
    return { ok: true as const, value: await load(tx, input.applicationId) };
  });
}

/** Notes use the last-updated time as a concurrency token so an edit never silently overwrites another. */
export async function updateApplicationNotes(
  prisma: PrismaClient,
  input: { applicationId: string; expectedUpdatedAt: string; notes: string },
  now: Date = new Date(),
): Promise<MutationResult<Application>> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.application.findUnique({ where: { id: input.applicationId } });
    if (!current) return fail("not_found", "This application no longer exists.");
    if (current.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString()) {
      return fail("version_conflict", CHANGED_ELSEWHERE);
    }
    const notes = input.notes.replace(/\r\n?/g, "\n").trim();
    if (notes === current.notes) return { ok: true as const, value: toApplication(current) };
    const updated = await tx.application.updateMany({
      where: { id: input.applicationId, updatedAt: current.updatedAt },
      data: { notes },
    });
    if (updated.count !== 1) return fail("version_conflict", CHANGED_ELSEWHERE);
    await addEvents(tx, input.applicationId, [{ type: "note_updated", fromValue: current.notes, toValue: notes, message: null }], now);
    return { ok: true as const, value: await load(tx, input.applicationId) };
  });
}

export async function recordInterview(
  prisma: PrismaClient,
  input: { applicationId: string; stage: InterviewStage; occurredOn: string; notes: string; today: string },
  now: Date = new Date(),
): Promise<MutationResult<Application>> {
  const dateError = validateInterviewDate(input.occurredOn, input.today);
  if (dateError) return fail("validation", dateError, { fieldErrors: { occurredOn: dateError } });

  return prisma.$transaction(async (tx) => {
    const current = await tx.application.findUnique({ where: { id: input.applicationId } });
    if (!current) return fail("not_found", "This application no longer exists.");
    const plan = planInterviewStatus(current.submissionStatus);
    if (!plan.ok) return fail("invalid_transition", plan.message);

    const events: PlannedEvent[] = [
      { type: "interview_recorded", fromValue: null, toValue: input.stage, message: `On ${input.occurredOn}.` },
    ];
    // Status first: if it changed concurrently, nothing has been written yet.
    if (plan.moveTo) {
      const updated = await tx.application.updateMany({
        where: { id: input.applicationId, submissionStatus: current.submissionStatus },
        data: { submissionStatus: plan.moveTo },
      });
      if (updated.count !== 1) return fail("version_conflict", CHANGED_ELSEWHERE);
      events.push({
        type: "submission_status_changed",
        fromValue: current.submissionStatus,
        toValue: plan.moveTo,
        message: "Moved to Interviewing when the first interview was recorded.",
      });
    } else {
      // Touch updatedAt so other open editors notice the change.
      await tx.application.update({ where: { id: input.applicationId }, data: { updatedAt: now } });
    }
    await tx.applicationInterview.create({
      data: {
        applicationId: input.applicationId,
        stage: input.stage,
        occurredOn: new Date(`${input.occurredOn}T00:00:00Z`),
        notes: input.notes.trim(),
      },
    });
    await addEvents(tx, input.applicationId, events, now);
    return { ok: true as const, value: await load(tx, input.applicationId) };
  });
}
