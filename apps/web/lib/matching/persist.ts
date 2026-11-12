/**
 * Runs the matching engine over stored jobs and saves ONE canonical evaluation
 * per job (job_profile_evaluations + ranked job_profile_matches).
 *
 * History rules:
 * - Each match records the profile VERSION it was evaluated against; version
 *   snapshots are immutable, so results stay explainable after later edits.
 * - Evaluations that already produced a notification (`notified_at` set) are
 *   frozen and never recomputed, so a job is never re-announced and the record
 *   of why it was announced is preserved.
 * - Un-notified evaluations are live and are recomputed after profile and job
 *   changes. Whenever the set of matching profiles (or their status) changes,
 *   an `evaluation_changed` job event records before/after, so matching
 *   history is preserved even though the live result is replaced.
 */
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { jobInclude, profileInclude, toJobPosting, toSearchProfile } from "../repositories/prisma-mappers";
import type { IsoDateTime, ProfileMatchEntry } from "../types";
import { MATCHING_ENGINE_VERSION, type JobEvaluation } from "./engine";
import { evaluateJobs } from "./evaluate";

/**
 * Arbitrary constant key for pg_advisory_xact_lock. Serialises evaluation runs
 * and profile deletion, which both rewrite job_profile_matches.
 */
export const EVALUATION_LOCK_KEY = 4_820_172;

export interface EvaluationRunSummary {
  evaluatedJobs: number;
  skippedNotified: number;
  jobsWithMatches: number;
  matches: number;
  engineVersion: string;
  /** Jobs whose matching profiles changed (and got a history event). */
  changedJobs: number;
}

export interface EvaluationOptions {
  evaluatedAt?: IsoDateTime;
  isDemo?: (jobIsDemo: boolean) => boolean;
  /** Only these jobs (default: all). */
  jobIds?: readonly string[];
  /** Record `evaluation_changed` job events (default true; the demo seed turns it off). */
  logChanges?: boolean;
}

type Tx = Prisma.TransactionClient;

export async function reevaluateAllJobs(
  prisma: PrismaClient,
  options: Omit<EvaluationOptions, "jobIds"> = {},
): Promise<EvaluationRunSummary> {
  return prisma.$transaction((tx) => reevaluateJobsInTx(tx, options).then((r) => r.summary), { timeout: 60_000 });
}

type MatchKey = { profileId: string; status: string };
const keyOf = (m: MatchKey) => `${m.profileId}:${m.status}`;

export async function reevaluateJobsInTx(
  tx: Tx,
  options: EvaluationOptions = {},
): Promise<{ summary: EvaluationRunSummary; evaluations: JobEvaluation[] }> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${EVALUATION_LOCK_KEY})`;
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  const logChanges = options.logChanges ?? true;
  const jobFilter = options.jobIds ? { id: { in: [...options.jobIds] } } : {};

  const [jobRows, profileRows, frozen] = await Promise.all([
    tx.jobPosting.findMany({ where: jobFilter, include: jobInclude, orderBy: { id: "asc" } }),
    tx.searchProfile.findMany({ where: { enabled: true, archivedAt: null }, include: profileInclude }),
    tx.jobProfileEvaluation.findMany({
      where: { notifiedAt: { not: null }, ...(options.jobIds ? { jobId: { in: [...options.jobIds] } } : {}) },
      select: { jobId: true },
    }),
  ]);
  const frozenIds = new Set(frozen.map((f) => f.jobId));
  const live = jobRows.filter((row) => !frozenIds.has(row.id));
  const liveIds = live.map((r) => r.id);

  const evaluations = evaluateJobs(
    live.map((row) => ({ job: toJobPosting(row), dedupeKey: row.dedupeKey })),
    profileRows.map(toSearchProfile),
    evaluatedAt,
  );
  const demoByJob = new Map(live.map((row) => [row.id, row.isDemo]));

  // Previous live results, to detect changes worth recording in job history.
  const previous = logChanges && liveIds.length > 0
    ? await tx.jobProfileEvaluation.findMany({
        where: { jobId: { in: liveIds } },
        select: { jobId: true, matches: { select: { profileId: true, status: true }, orderBy: { rank: "asc" } } },
      })
    : [];
  const previousByJob = new Map(previous.map((p) => [p.jobId, p.matches]));
  const names = logChanges
    ? new Map((await tx.searchProfile.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]))
    : new Map<string, string>();

  if (liveIds.length > 0) {
    await tx.jobProfileMatch.deleteMany({ where: { jobId: { in: liveIds } } });
  }

  let matches = 0;
  let changedJobs = 0;
  for (const evaluation of evaluations) {
    const isDemo = (options.isDemo ?? ((d) => d))(demoByJob.get(evaluation.jobId) ?? false);
    await tx.jobProfileEvaluation.upsert({
      where: { jobId: evaluation.jobId },
      create: { jobId: evaluation.jobId, evaluatedAt: new Date(evaluatedAt), engineVersion: evaluation.engineVersion, isDemo },
      update: { evaluatedAt: new Date(evaluatedAt), engineVersion: evaluation.engineVersion, isDemo },
    });
    if (evaluation.matches.length > 0) {
      await tx.jobProfileMatch.createMany({
        data: evaluation.matches.map((m) => ({
          jobId: evaluation.jobId,
          profileId: m.profileId,
          profileVersion: m.profileVersion,
          rank: m.rank,
          status: m.status,
          relevance: m.relevance,
          reasons: m.reasons,
        })),
      });
      matches += evaluation.matches.length;
    }

    if (logChanges) {
      const before = previousByJob.get(evaluation.jobId) ?? [];
      const change = describeChange(before, evaluation.matches, names, previousByJob.has(evaluation.jobId));
      if (change) {
        changedJobs += 1;
        await tx.jobEvent.create({
          data: {
            jobId: evaluation.jobId,
            type: "evaluation_changed",
            fromValue: String(before.length),
            toValue: String(evaluation.matches.length),
            message: change,
            data: {
              engineVersion: evaluation.engineVersion,
              skipped: evaluation.skipped,
              before: before.map((m) => ({ profileId: m.profileId, status: m.status })),
              after: evaluation.matches.map((m) => ({
                profileId: m.profileId,
                profileVersion: m.profileVersion,
                status: m.status,
              })),
            },
            occurredAt: new Date(evaluatedAt),
            isDemo,
          },
        });
      }
    }
  }

  return {
    summary: {
      evaluatedJobs: evaluations.length,
      skippedNotified: frozenIds.size,
      jobsWithMatches: evaluations.filter((e) => e.matches.length > 0).length,
      matches,
      engineVersion: MATCHING_ENGINE_VERSION,
      changedJobs,
    },
    evaluations,
  };
}

/** Human summary of a change in matching profiles; null when nothing changed. */
function describeChange(
  before: readonly MatchKey[],
  after: readonly ProfileMatchEntry[],
  names: ReadonlyMap<string, string>,
  hadEvaluation: boolean,
): string | null {
  const beforeKeys = new Set(before.map(keyOf));
  const afterKeys = new Set(after.map(keyOf));
  if (hadEvaluation && beforeKeys.size === afterKeys.size && [...beforeKeys].every((k) => afterKeys.has(k))) return null;
  if (!hadEvaluation && after.length === 0) return "Evaluated: no search profile matches.";

  const label = (m: MatchKey) =>
    `${names.get(m.profileId) ?? m.profileId} (${m.status === "eligible" ? "eligible" : "needs review"})`;
  const added = after.filter((m) => !beforeKeys.has(keyOf(m))).map(label);
  const removed = before.filter((m) => !afterKeys.has(keyOf(m))).map(label);
  const parts = [
    added.length > 0 ? `now matches ${added.join(", ")}` : null,
    removed.length > 0 ? `no longer ${removed.join(", ")}` : null,
  ].filter(Boolean);
  const text = parts.join("; ");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) + "." : "Evaluated: no search profile matches.";
}
