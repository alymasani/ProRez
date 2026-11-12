/**
 * Job persistence for manual submission and job management. Every function
 * expects input that already passed the strict parsers in ./schema.ts and an
 * authorised actor (see app/jobs/actions.ts).
 *
 * Guarantees:
 * - Intake is serialised by an advisory lock, duplicate detection runs inside
 *   the same transaction as the insert, and unique constraints (canonical URL,
 *   ATS posting identity, dedupe key) are the final backstop.
 * - A duplicate never overwrites an existing job's description, status or
 *   application history. The user can open it or add the new URL as another
 *   sighting.
 * - The submitted description is stored as an immutable snapshot; later edits
 *   append snapshots, never replace the original.
 * - Every change appends a job event; matching runs in the same transaction,
 *   so a saved job always has its evaluation.
 */
import { createHash, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "../generated/prisma/client";
import { reevaluateJobsInTx } from "../matching/persist";
import { fail, prismaErrorCode, type MutationResult } from "../mutations/result";
import { jobInclude, toJobPosting } from "../repositories/prisma-mappers";
import type { AtsProvider, DiscoveryStatus, JobPosting, ProfileMatchEntry } from "../types";
import { buildDedupeKey, slugify } from "./dedupe";
import { affectsEvaluation, planDiscoveryAction } from "./discovery";
import { classifyDuplicates, isBlocking, type DuplicateCandidate, type DuplicateProbe } from "./duplicates";
import { summarizeDescription, type ManualJob } from "./manual-submission";
import type { DiscoveryAction } from "./schema";
import { parseJobUrl } from "./url";

type Tx = Prisma.TransactionClient;

/** Serialises job intake so two identical submissions cannot both pass the duplicate check. */
export const JOB_INTAKE_LOCK_KEY = 4_820_173;
export const MANUAL_SOURCE_ID = "src-manual";

export const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

export function probeFor(job: ManualJob): DuplicateProbe {
  return {
    canonicalUrl: job.url?.canonical ?? null,
    ats: job.url?.ats ?? null,
    company: job.company,
    title: job.title,
    location: job.location,
    dedupeKey: buildDedupeKey(job.company, job.title, job.location),
  };
}

/** Jobs that could be duplicates: same URL, same ATS posting, or same company. */
async function loadCandidates(tx: Tx | PrismaClient, probe: DuplicateProbe, excludeJobId?: string): Promise<DuplicateCandidate[]> {
  const or: Prisma.JobPostingWhereInput[] = [{ dedupeKey: { startsWith: `${slugify(probe.company)}|` } }];
  if (probe.canonicalUrl) or.push({ observations: { some: { canonicalUrl: probe.canonicalUrl } } });
  if (probe.ats) {
    or.push({
      observations: {
        some: { atsProvider: probe.ats.provider, atsBoardToken: probe.ats.boardToken, atsPostingId: probe.ats.postingId },
      },
    });
  }
  const rows = await tx.jobPosting.findMany({
    where: { OR: or, ...(excludeJobId ? { id: { not: excludeJobId } } : {}) },
    include: { locations: { orderBy: { position: "asc" } }, observations: true },
    orderBy: { id: "asc" },
    take: 50,
  });
  return rows.map((row) => ({
    jobId: row.id,
    company: row.company,
    title: row.title,
    locations: row.locations.map((l) => ({ city: l.city, province: l.province, arrangement: l.arrangement })),
    discoveryStatus: row.discoveryStatus,
    dedupeKey: row.dedupeKey,
    canonicalUrls: row.observations.flatMap((o) => (o.canonicalUrl ? [o.canonicalUrl] : [])),
    atsPostings: row.observations.flatMap((o) =>
      o.atsProvider && o.atsBoardToken && o.atsPostingId
        ? [{ provider: o.atsProvider as AtsProvider, boardToken: o.atsBoardToken, postingId: o.atsPostingId }]
        : [],
    ),
  }));
}

export async function findDuplicates(prisma: PrismaClient | Tx, job: ManualJob, excludeJobId?: string) {
  const probe = probeFor(job);
  return classifyDuplicates(probe, await loadCandidates(prisma, probe, excludeJobId));
}

export interface SavedJob {
  job: JobPosting;
  /** Profiles the job matched, ranked (eligible first). Empty if none. */
  matches: ProfileMatchEntry[];
}

async function loadJob(tx: Tx | PrismaClient, id: string): Promise<JobPosting> {
  return toJobPosting(await tx.jobPosting.findUniqueOrThrow({ where: { id }, include: jobInclude }));
}

async function evaluateOne(tx: Tx, jobId: string): Promise<ProfileMatchEntry[]> {
  const { evaluations } = await reevaluateJobsInTx(tx, { jobIds: [jobId] });
  return evaluations[0]?.matches ?? [];
}

const locationCreate = (job: ManualJob) => (job.location ? [{ position: 0, ...job.location }] : []);

function detailColumns(job: ManualJob) {
  return {
    company: job.company,
    title: job.title,
    jobType: job.jobType,
    durationMonths: job.durationMonths,
    term: job.term,
    disciplines: job.disciplines,
    experienceRequirement: job.experienceRequirement,
    salaryMin: job.salary?.min ?? null,
    salaryMax: job.salary?.max ?? null,
    salaryCurrency: job.salary?.currency ?? null,
    salaryPeriod: job.salary?.period ?? null,
  };
}

const DUPLICATE_MESSAGE = "This job looks like one you've already saved. Nothing was saved, and the existing job is unchanged.";
const POSSIBLE_MESSAGE = "A similar job is already saved. Check it before saving this one as a separate job.";

/**
 * Saves a manually submitted job, evaluates it against every enabled search
 * profile, and returns the result — all in one transaction.
 *
 * @param confirmSeparateFrom job ids the user confirmed are DIFFERENT postings
 *   (only possible duplicates can be confirmed; exact/likely ones always block).
 */
export async function createManualJob(
  prisma: PrismaClient,
  job: ManualJob,
  options: { confirmSeparateFrom?: readonly string[]; now?: Date } = {},
): Promise<MutationResult<SavedJob>> {
  const now = options.now ?? new Date();
  const confirmed = new Set(options.confirmSeparateFrom ?? []);
  const probe = probeFor(job);
  const id = `job-${randomUUID()}`;

  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${JOB_INTAKE_LOCK_KEY})`;
        const duplicates = classifyDuplicates(probe, await loadCandidates(tx, probe));
        if (duplicates.some(isBlocking)) return fail("duplicate", DUPLICATE_MESSAGE, { duplicates });
        if (duplicates.some((d) => !confirmed.has(d.jobId))) return fail("possible_duplicate", POSSIBLE_MESSAGE, { duplicates });

        await tx.jobPosting.create({
          data: {
            id,
            dedupeKey: probe.dedupeKey,
            ...detailColumns(job),
            summary: summarizeDescription(job.description),
            description: job.description,
            responsibilities: [],
            qualifications: [],
            postingUrl: job.url?.original ?? null,
            firstDiscoveredAt: now,
            // Saving a job yourself is an explicit "save".
            discoveryStatus: "saved",
            origin: "manual",
            primarySourceId: MANUAL_SOURCE_ID,
            notes: job.notes,
            createdAt: now,
            locations: { create: locationCreate(job) },
            observations: {
              create: {
                sourceId: MANUAL_SOURCE_ID,
                sourceUrl: job.url?.original ?? null,
                canonicalUrl: job.url?.canonical ?? null,
                atsProvider: job.url?.ats?.provider ?? null,
                atsBoardToken: job.url?.ats?.boardToken ?? null,
                atsPostingId: job.url?.ats?.postingId ?? null,
                rawTitle: job.title,
                firstSeenAt: now,
                lastSeenAt: now,
              },
            },
            descriptionSnapshots: job.description
              ? { create: { content: job.description, contentHash: sha256(job.description), source: "manual_submission", capturedAt: now } }
              : undefined,
            events: {
              create: {
                type: "created",
                toValue: "saved",
                message: confirmed.size > 0
                  ? `Added manually; you confirmed it is separate from ${[...confirmed].join(", ")}.`
                  : "Added manually.",
                occurredAt: now,
              },
            },
          },
        });

        const matches = await evaluateOne(tx, id);
        return { ok: true as const, value: { job: await loadJob(tx, id), matches } };
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (prismaErrorCode(error) !== "P2002") throw error;
    // A unique constraint caught a duplicate the check could not see; report it.
    const duplicates = await findDuplicates(prisma, job);
    return fail("duplicate", DUPLICATE_MESSAGE, { duplicates });
  }
}

/**
 * Records a new URL for an EXISTING job (another place it is posted). Never
 * changes the job's details, description or history beyond a history event.
 */
export async function addJobSighting(
  prisma: PrismaClient,
  jobId: string,
  rawUrl: string,
  now: Date = new Date(),
): Promise<MutationResult<{ jobId: string }>> {
  const parsed = parseJobUrl(rawUrl);
  if (!parsed.ok) return fail("validation", "That URL isn't valid.");
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${JOB_INTAKE_LOCK_KEY})`;
      const job = await tx.jobPosting.findUnique({ where: { id: jobId }, select: { id: true } });
      if (!job) return fail("not_found", "That job no longer exists.");
      const existing = await tx.sourceObservation.findUnique({ where: { canonicalUrl: parsed.canonical }, select: { jobId: true } });
      if (existing) {
        return existing.jobId === jobId
          ? fail("duplicate", "This URL is already recorded for this job.", { existingId: jobId })
          : fail("duplicate", "This URL belongs to a different saved job.", { existingId: existing.jobId });
      }
      await tx.sourceObservation.create({
        data: {
          jobId,
          sourceId: MANUAL_SOURCE_ID,
          sourceUrl: parsed.original,
          canonicalUrl: parsed.canonical,
          atsProvider: parsed.ats?.provider ?? null,
          atsBoardToken: parsed.ats?.boardToken ?? null,
          atsPostingId: parsed.ats?.postingId ?? null,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });
      await tx.jobEvent.create({
        data: { jobId, type: "sighting_added", toValue: parsed.canonical, message: "Recorded another URL for this job.", occurredAt: now },
      });
      return { ok: true as const, value: { jobId } };
    });
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") return fail("duplicate", "This URL or posting is already recorded for another job.");
    throw error;
  }
}

const FIELD_LABELS: Record<string, string> = {
  company: "company",
  title: "title",
  jobType: "employment type",
  durationMonths: "duration",
  term: "term",
  disciplines: "disciplines",
  experienceRequirement: "experience",
  salary: "salary",
  location: "location",
  description: "description",
};

/**
 * Edits the details of a MANUALLY added job (automatically discovered jobs
 * mirror their source and are not editable). Optimistic concurrency on
 * `version`; a changed description is appended as a new snapshot; the job is
 * re-evaluated in the same transaction.
 */
export async function updateJobDetails(
  prisma: PrismaClient,
  jobId: string,
  expectedVersion: number,
  job: ManualJob,
  now: Date = new Date(),
): Promise<MutationResult<SavedJob>> {
  const dedupeKey = buildDedupeKey(job.company, job.title, job.location);
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${JOB_INTAKE_LOCK_KEY})`;
        const current = await tx.jobPosting.findUnique({ where: { id: jobId }, include: jobInclude });
        if (!current) return fail("not_found", "This job no longer exists.");
        if (current.origin !== "manual") {
          return fail("not_editable", "Only jobs you added manually can be edited. Discovered jobs mirror their source.");
        }
        if (current.version !== expectedVersion) {
          return fail("version_conflict", `This job was changed elsewhere (now version ${current.version}). Your edits were not saved.`, {
            currentVersion: current.version,
          });
        }
        if (current.description && !job.description) {
          const message = "The description can't be removed. Edit it instead — the original is always kept.";
          return fail("validation", message, { fieldErrors: { description: message } });
        }

        if (dedupeKey !== current.dedupeKey) {
          const clash = await tx.jobPosting.findUnique({ where: { dedupeKey }, select: { id: true } });
          if (clash) {
            const duplicates = (await findDuplicates(tx, job, jobId)).filter((d) => d.jobId === clash.id);
            return fail("duplicate", "Another saved job already has this company, title and location.", { duplicates });
          }
        }

        const before = toJobPosting(current);
        const changed = changedFields(before, job);
        const updated = await tx.jobPosting.updateMany({
          where: { id: jobId, version: expectedVersion },
          data: {
            ...detailColumns(job),
            dedupeKey,
            description: job.description,
            summary: job.description ? summarizeDescription(job.description) : current.summary,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) return fail("version_conflict", "This job was changed elsewhere. Your edits were not saved.");

        if (changed.includes("location")) {
          await tx.jobLocation.deleteMany({ where: { jobId } });
          if (job.location) await tx.jobLocation.create({ data: { jobId, position: 0, ...job.location } });
        }
        if (job.description && job.description !== current.description) {
          // Re-saving an earlier text does not duplicate its snapshot.
          await tx.jobDescriptionSnapshot.createMany({
            data: [{ jobId, content: job.description, contentHash: sha256(job.description), source: "manual_edit", capturedAt: now }],
            skipDuplicates: true,
          });
          await tx.jobEvent.create({
            data: { jobId, type: "description_added", message: "Description edited; the previous text is kept.", occurredAt: now },
          });
        }
        if (changed.length > 0) {
          await tx.jobEvent.create({
            data: {
              jobId,
              type: "details_updated",
              fromValue: String(expectedVersion),
              toValue: String(expectedVersion + 1),
              message: `Edited ${changed.map((f) => FIELD_LABELS[f] ?? f).join(", ")}.`,
              occurredAt: now,
            },
          });
        }
        if (job.notes !== current.notes) {
          await tx.jobPosting.update({ where: { id: jobId }, data: { notes: job.notes } });
          await tx.jobEvent.create({ data: { jobId, type: "notes_updated", fromValue: current.notes, toValue: job.notes, occurredAt: now } });
        }

        const matches = await evaluateOne(tx, jobId);
        return { ok: true as const, value: { job: await loadJob(tx, jobId), matches } };
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (prismaErrorCode(error) === "P2002") return fail("duplicate", "Another saved job already has this company, title and location.");
    throw error;
  }
}

function changedFields(before: JobPosting, job: ManualJob): string[] {
  const loc = before.locations[0] ?? null;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const checks: [string, boolean][] = [
    ["company", before.company !== job.company],
    ["title", before.title !== job.title],
    ["jobType", before.jobType !== job.jobType],
    ["durationMonths", before.durationMonths !== job.durationMonths],
    ["term", before.term !== job.term],
    ["disciplines", !same([...before.disciplines].sort(), [...job.disciplines].sort())],
    ["experienceRequirement", before.experienceRequirement !== job.experienceRequirement],
    ["salary", !same(before.salary, job.salary)],
    ["location", !same(loc, job.location) || before.locations.length > 1],
    ["description", (job.description ?? null) !== before.description],
  ];
  return checks.filter(([, changed]) => changed).map(([field]) => field);
}

/** Notes are personal annotations: no version bump, but every change is kept in history. */
export async function updateJobNotes(
  prisma: PrismaClient,
  jobId: string,
  notes: string,
  now: Date = new Date(),
): Promise<MutationResult<JobPosting>> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.jobPosting.findUnique({ where: { id: jobId }, select: { notes: true } });
    if (!current) return fail("not_found", "This job no longer exists.");
    const value = notes.replace(/\r\n?/g, "\n").trim();
    if (value !== current.notes) {
      await tx.jobPosting.update({ where: { id: jobId }, data: { notes: value } });
      await tx.jobEvent.create({ data: { jobId, type: "notes_updated", fromValue: current.notes, toValue: value, occurredAt: now } });
    }
    return { ok: true as const, value: await loadJob(tx, jobId) };
  });
}

/**
 * Save / unsave / dismiss / restore / expire / reopen. Compare-and-swap on the
 * status the user saw; applications are never touched.
 */
export async function changeDiscoveryStatus(
  prisma: PrismaClient,
  jobId: string,
  action: DiscoveryAction,
  expectedStatus: DiscoveryStatus,
  now: Date = new Date(),
): Promise<MutationResult<JobPosting>> {
  return prisma.$transaction(async (tx) => {
    const current = await tx.jobPosting.findUnique({ where: { id: jobId }, select: { discoveryStatus: true } });
    if (!current) return fail("not_found", "This job no longer exists.");
    if (current.discoveryStatus !== expectedStatus) {
      return fail("version_conflict", "This job's status was changed elsewhere. The page now shows the latest status.");
    }
    // For restore/reopen: the status the job had before it became inactive.
    const lastEntry = await tx.jobEvent.findFirst({
      where: { jobId, type: "discovery_status_changed", toValue: current.discoveryStatus },
      orderBy: { occurredAt: "desc" },
      select: { fromValue: true },
    });
    const plan = planDiscoveryAction(current.discoveryStatus, action, lastEntry?.fromValue ?? null);
    if (!plan.ok) return fail("invalid_transition", plan.message);

    const updated = await tx.jobPosting.updateMany({
      where: { id: jobId, discoveryStatus: current.discoveryStatus },
      data: { discoveryStatus: plan.to },
    });
    if (updated.count !== 1) return fail("version_conflict", "This job's status was changed elsewhere.");
    await tx.jobEvent.create({
      data: { jobId, type: "discovery_status_changed", fromValue: current.discoveryStatus, toValue: plan.to, occurredAt: now },
    });
    if (affectsEvaluation(current.discoveryStatus, plan.to)) await evaluateOne(tx, jobId);
    return { ok: true as const, value: await loadJob(tx, jobId) };
  });
}
