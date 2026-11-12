/**
 * Loads the fictional Milestone 1 fixtures into PostgreSQL for local
 * development. Every row is flagged `is_demo = true`.
 *
 * Idempotent: existing demo rows are deleted and recreated inside a single
 * transaction, so re-running never duplicates data. Non-demo rows are left
 * untouched. Callers MUST run `checkDemoSeedAllowed` first (see prisma/seed.ts).
 */
import { DEMO_APPLICATION_RUNS, DEMO_APPLICATIONS, DEMO_APPROVALS } from "../fixtures/applications";
import { DEMO_COVER_LETTERS, DEMO_PROJECTS, DEMO_RESUMES } from "../fixtures/artifacts";
import { DEMO_JOB_MATCHES, DEMO_JOB_SOURCES, DEMO_JOBS } from "../fixtures/jobs";
import { DEMO_JOB_PROFILE_MATCHES, DEMO_SEARCH_PROFILES } from "../fixtures/profiles";
import type { PrismaClient } from "../generated/prisma/client";
import { buildDedupeKey } from "../jobs/dedupe";
import { durationToDb } from "../repositories/prisma-mappers";

const d = (iso: string) => new Date(iso);
const dOrNull = (iso: string | null) => (iso ? new Date(iso) : null);

/** A second sighting of one job on another board, to demonstrate canonical-job merging. */
const SYNDICATED_OBSERVATION = {
  jobId: "job-010",
  sourceId: "src-lever",
  externalId: "demo-job-010-syndicated",
  sourceUrl: "https://careers.example/quillstone-software/job-010?via=lever",
  seenAt: "2026-11-10T18:30:00Z",
};

export interface SeedSummary {
  sources: number;
  jobs: number;
  observations: number;
  profiles: number;
  applications: number;
  artifacts: number;
  projects: number;
  runs: number;
  approvals: number;
}

export async function deleteDemoData(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.approvalRequest.deleteMany({ where: { isDemo: true } });
    await tx.workflowRun.deleteMany({ where: { isDemo: true } });
    await tx.application.deleteMany({ where: { isDemo: true } });
    await tx.resumeArtifact.deleteMany({ where: { isDemo: true } });
    await tx.coverLetterArtifact.deleteMany({ where: { isDemo: true } });
    await tx.project.deleteMany({ where: { isDemo: true } });
    await tx.jobProfileEvaluation.deleteMany({ where: { isDemo: true } });
    await tx.searchProfile.deleteMany({ where: { isDemo: true } });
    await tx.jobPosting.deleteMany({ where: { isDemo: true } });
  });
}

export async function seedDemoData(prisma: PrismaClient): Promise<SeedSummary> {
  await deleteDemoData(prisma);

  return prisma.$transaction(
    async (tx) => {
      for (const s of DEMO_JOB_SOURCES) {
        const data = {
          provider: s.provider,
          label: s.label,
          description: s.description,
          enabled: s.enabled,
          integrationStatus: s.integrationStatus,
          lastCheckedAt: dOrNull(s.lastCheckedAt),
        };
        await tx.jobSource.upsert({ where: { id: s.id }, create: { id: s.id, ...data }, update: data });
      }

      const matchByJob = new Map(DEMO_JOB_MATCHES.map((m) => [m.jobId, m]));
      for (const job of DEMO_JOBS) {
        const match = matchByJob.get(job.id);
        await tx.jobPosting.create({
          data: {
            id: job.id,
            dedupeKey: buildDedupeKey(job.company, job.title, job.locations[0] ?? null),
            company: job.company,
            title: job.title,
            jobType: job.jobType,
            durationMonths: job.durationMonths,
            term: job.term,
            disciplines: job.disciplines,
            summary: job.summary,
            responsibilities: job.responsibilities,
            qualifications: job.qualifications,
            postingUrl: job.postingUrl,
            postedAt: dOrNull(job.postedAt),
            firstDiscoveredAt: d(job.discoveredAt),
            discoveryStatus: job.discoveryStatus,
            primarySourceId: job.sourceId,
            isDemo: true,
            locations: {
              create: job.locations.map((l, position) => ({ position, ...l })),
            },
            observations: {
              create: [
                {
                  sourceId: job.sourceId,
                  externalId: job.externalId,
                  sourceUrl: job.postingUrl,
                  rawTitle: job.title,
                  firstSeenAt: d(job.discoveredAt),
                  lastSeenAt: d(job.discoveredAt),
                },
              ],
            },
            match: match
              ? {
                  create: {
                    fitScore: match.fitScore,
                    matchedSkills: match.matchedSkills,
                    missingSkills: match.missingSkills,
                    reasons: match.reasons,
                    computedAt: d(match.computedAt),
                    isDemo: true,
                  },
                }
              : undefined,
          },
        });
      }

      const syn = SYNDICATED_OBSERVATION;
      await tx.sourceObservation.create({
        data: {
          jobId: syn.jobId,
          sourceId: syn.sourceId,
          externalId: syn.externalId,
          sourceUrl: syn.sourceUrl,
          firstSeenAt: d(syn.seenAt),
          lastSeenAt: d(syn.seenAt),
        },
      });

      for (const p of DEMO_SEARCH_PROFILES) {
        await tx.searchProfile.create({
          data: {
            id: p.id,
            name: p.name,
            description: p.description,
            enabled: p.enabled,
            minFitScore: p.minFitScore,
            automationMode: p.automationMode,
            notificationsEnabled: p.notifications.enabled,
            notificationChannel: p.notifications.channel,
            notificationCadence: p.notifications.cadence,
            createdAt: d(p.createdAt),
            updatedAt: d(p.updatedAt),
            isDemo: true,
            criteria: {
              create: { ...p.criteria, durations: p.criteria.durations.map(durationToDb) },
            },
          },
        });
      }

      for (const m of DEMO_JOB_PROFILE_MATCHES) {
        await tx.jobProfileEvaluation.create({
          data: {
            jobId: m.jobId,
            evaluatedAt: d(m.evaluatedAt),
            notifiedAt: dOrNull(m.notifiedAt),
            isDemo: true,
            matches: { create: m.matchedProfileIds.map((profileId, rank) => ({ profileId, rank })) },
          },
        });
      }

      for (const p of DEMO_PROJECTS) {
        await tx.project.create({
          data: {
            id: p.id,
            name: p.name,
            description: p.description,
            technologies: p.technologies,
            repoOwner: p.repository.owner,
            repoName: p.repository.name,
            repoVisibility: p.repository.visibility,
            repoPublished: p.repository.published,
            buildStatus: p.buildStatus,
            testStatus: p.testStatus,
            createdAt: d(p.createdAt),
            isDemo: true,
            jobLinks: { create: p.jobIds.map((jobId, position) => ({ jobId, position })) },
          },
        });
      }

      // Applications and artifacts reference each other, so link artifacts afterwards.
      for (const a of DEMO_APPLICATIONS) {
        await tx.application.create({
          data: {
            id: a.id,
            jobId: a.jobId,
            mode: a.mode,
            preparationStatus: a.preparationStatus,
            submissionStatus: a.submissionStatus,
            submittedAt: dOrNull(a.submittedAt),
            projectId: a.projectId,
            notes: a.notes,
            createdAt: d(a.createdAt),
            updatedAt: d(a.updatedAt),
            isDemo: true,
          },
        });
      }

      await tx.resumeArtifact.createMany({
        data: DEMO_RESUMES.map((r) => ({
          id: r.id,
          applicationId: r.applicationId,
          jobId: r.jobId,
          version: r.version,
          title: r.title,
          generationStatus: r.generationStatus,
          baseTemplate: r.baseTemplate,
          highlightedSkills: r.highlightedSkills,
          pageCount: r.pageCount,
          createdAt: d(r.createdAt),
          isDemo: true,
        })),
      });
      await tx.coverLetterArtifact.createMany({
        data: DEMO_COVER_LETTERS.map((c) => ({
          id: c.id,
          applicationId: c.applicationId,
          jobId: c.jobId,
          version: c.version,
          title: c.title,
          generationStatus: c.generationStatus,
          baseTemplate: c.baseTemplate,
          tone: c.tone,
          wordCount: c.wordCount,
          createdAt: d(c.createdAt),
          isDemo: true,
        })),
      });

      for (const a of DEMO_APPLICATIONS) {
        if (!a.resumeId && !a.coverLetterId) continue;
        await tx.application.update({
          where: { id: a.id },
          // updatedAt is passed explicitly so linking does not change the fixture timestamp.
          data: { resumeId: a.resumeId, coverLetterId: a.coverLetterId, updatedAt: d(a.updatedAt) },
        });
      }

      await tx.applicationEvent.createMany({
        data: DEMO_APPLICATIONS.flatMap((a) => [
          { applicationId: a.id, type: "created" as const, toValue: a.mode, occurredAt: d(a.createdAt), isDemo: true },
          ...(a.submittedAt
            ? [
                {
                  applicationId: a.id,
                  type: "submission_recorded" as const,
                  toValue: "submitted",
                  message: "Recorded by the user (demo).",
                  occurredAt: d(a.submittedAt),
                  isDemo: true,
                },
              ]
            : []),
        ]),
      });

      await tx.workflowRun.createMany({
        data: DEMO_APPLICATION_RUNS.map((r) => ({
          id: r.id,
          applicationId: r.applicationId,
          kind: r.kind,
          status: r.status,
          startedAt: d(r.startedAt),
          finishedAt: dOrNull(r.finishedAt),
          summary: r.summary,
          isDemo: true,
        })),
      });

      await tx.approvalRequest.createMany({
        data: DEMO_APPROVALS.map((a) => ({
          id: a.id,
          jobId: a.jobId,
          channel: a.channel,
          decision: a.decision,
          requestedAt: d(a.requestedAt),
          respondedAt: dOrNull(a.respondedAt),
          isDemo: true,
        })),
      });

      return {
        sources: DEMO_JOB_SOURCES.length,
        jobs: DEMO_JOBS.length,
        observations: DEMO_JOBS.length + 1,
        profiles: DEMO_SEARCH_PROFILES.length,
        applications: DEMO_APPLICATIONS.length,
        artifacts: DEMO_RESUMES.length + DEMO_COVER_LETTERS.length,
        projects: DEMO_PROJECTS.length,
        runs: DEMO_APPLICATION_RUNS.length,
        approvals: DEMO_APPROVALS.length,
      };
    },
    { timeout: 30_000 },
  );
}
