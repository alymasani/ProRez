/** PostgreSQL-backed repository. Read-only in Milestone 2A. */
import type { PrismaClient } from "../generated/prisma/client";
import {
  evaluationInclude,
  jobInclude,
  profileInclude,
  projectInclude,
  toApplication,
  toApplicationRun,
  toEmployerBoard,
  toBoardSyncRun,
  toJobSourceRecord,
  toApprovalRequest,
  toCoverLetter,
  toJobMatch,
  toJobPosting,
  toJobProfileMatch,
  toJobSource,
  toProject,
  toResume,
  toSearchProfile,
} from "./prisma-mappers";
import { countProfileHistory } from "../profiles/service";
import { DEFAULT_PREFERENCES, type DataRepository } from "./repository";

export function createPrismaRepository(prisma: PrismaClient): DataRepository {
  return {
    async listJobSources() {
      // Postgres sorts enums by declaration order, which matches the UI order.
      const rows = await prisma.jobSource.findMany({ orderBy: { provider: "asc" } });
      return rows.map(toJobSource);
    },

    async listJobs() {
      const rows = await prisma.jobPosting.findMany({ include: jobInclude, orderBy: { id: "asc" } });
      return rows.map(toJobPosting);
    },

    async listJobsWithMatches() {
      const rows = await prisma.jobPosting.findMany({ include: jobInclude, orderBy: { id: "asc" } });
      return rows.map((row) => ({ job: toJobPosting(row), match: row.match ? toJobMatch(row.match) : null }));
    },

    async getJobWithMatch(id) {
      const row = await prisma.jobPosting.findUnique({ where: { id }, include: jobInclude });
      return row ? { job: toJobPosting(row), match: row.match ? toJobMatch(row.match) : null } : null;
    },

    async listApplications() {
      const rows = await prisma.application.findMany({ orderBy: { id: "asc" } });
      return rows.map(toApplication);
    },

    async getApplicationForJob(jobId) {
      const row = await prisma.application.findUnique({ where: { jobId } });
      return row ? toApplication(row) : null;
    },

    async listApplicationRuns() {
      const rows = await prisma.workflowRun.findMany({ orderBy: { id: "asc" } });
      return rows.map(toApplicationRun);
    },

    async listApprovals() {
      const rows = await prisma.approvalRequest.findMany({ orderBy: { id: "asc" } });
      return rows.map(toApprovalRequest);
    },

    async listResumes() {
      const rows = await prisma.resumeArtifact.findMany({ orderBy: { id: "asc" } });
      return rows.map(toResume);
    },

    async listCoverLetters() {
      const rows = await prisma.coverLetterArtifact.findMany({ orderBy: { id: "asc" } });
      return rows.map(toCoverLetter);
    },

    async listProjects() {
      const rows = await prisma.project.findMany({ include: projectInclude, orderBy: { id: "asc" } });
      return rows.map(toProject);
    },

    async listSearchProfiles() {
      const rows = await prisma.searchProfile.findMany({
        where: { archivedAt: null },
        include: profileInclude,
        orderBy: [{ createdAt: "asc" }, { name: "asc" }],
      });
      return rows.map(toSearchProfile);
    },

    async listArchivedSearchProfiles() {
      const rows = await prisma.searchProfile.findMany({
        where: { archivedAt: { not: null } },
        include: profileInclude,
        orderBy: [{ archivedAt: "desc" }, { name: "asc" }],
      });
      return rows.map(toSearchProfile);
    },

    async countProfileHistory(profileId) {
      return countProfileHistory(prisma, profileId);
    },

    async listEmployerBoards() {
      const [rows, running, active] = await Promise.all([
        prisma.employerBoard.findMany({ orderBy: [{ employerName: "asc" }, { provider: "asc" }], include: { company: { select: { domain: true } } } }),
        prisma.boardSyncRun.findMany({ where: { status: "running" }, select: { boardId: true } }),
        // Active = currently listed sightings, one per job per board.
        prisma.sourceObservation.groupBy({ by: ["boardId"], where: { boardId: { not: null }, closedAt: null }, _count: { _all: true } }),
      ]);
      const runningIds = new Set(running.map((r) => r.boardId));
      const activeById = new Map(active.map((a) => [a.boardId, a._count._all]));
      return rows.map((row) =>
        toEmployerBoard(row, { syncing: runningIds.has(row.id), activeJobCount: activeById.get(row.id) ?? 0, companyDomain: row.company?.domain ?? null }),
      );
    },

    async getSearchProfile(id) {
      const row = await prisma.searchProfile.findUnique({ where: { id }, include: profileInclude });
      return row ? toSearchProfile(row) : null;
    },

    async getProfileMatchForJob(jobId) {
      const row = await prisma.jobProfileEvaluation.findUnique({ where: { jobId }, include: evaluationInclude });
      return row ? toJobProfileMatch(row) : null;
    },

    async listBoardSyncRuns(limit = 5) {
      const boards = await prisma.employerBoard.findMany({ select: { id: true } });
      const runs = await Promise.all(
        boards.map((b) => prisma.boardSyncRun.findMany({ where: { boardId: b.id }, orderBy: { startedAt: "desc" }, take: limit })),
      );
      return runs.flat().map(toBoardSyncRun).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },

    async listJobSightings(jobId) {
      const rows = await prisma.sourceObservation.findMany({
        where: { jobId },
        include: { source: { select: { provider: true } }, board: { select: { employerName: true } } },
        orderBy: [{ firstSeenAt: "asc" }, { id: "asc" }],
      });
      return rows.map(toJobSourceRecord);
    },

    async getDefaultPreferences() {
      // Preferences are not persisted yet (Milestone 2B+); return static defaults.
      return structuredClone(DEFAULT_PREFERENCES);
    },
  };
}
