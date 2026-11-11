/**
 * DEMO FIXTURES — fictional resume, cover letter, and project records.
 * No documents exist behind these records and no repositories are published.
 */
import type { CoverLetterArtifact, Project, ResumeArtifact } from "@/lib/types";

export const DEMO_RESUMES: ResumeArtifact[] = [
  { kind: "resume", id: "res-000", applicationId: null, jobId: null, version: "base-v2", title: "Base resume", createdAt: "2026-09-20T15:00:00Z", generationStatus: "ready", baseTemplate: "One-page technical", highlightedSkills: ["TypeScript", "Python", "PostgreSQL"], pageCount: 1, isDemo: true },
  { kind: "resume", id: "res-001", applicationId: "app-005", jobId: "job-004", version: "v1", title: "Full stack — health scheduling", createdAt: "2026-10-14T09:20:00Z", generationStatus: "ready", baseTemplate: "One-page technical", highlightedSkills: ["React", "Node.js", "TypeScript"], pageCount: 1, isDemo: true },
  { kind: "resume", id: "res-002", applicationId: "app-006", jobId: "job-016", version: "v1", title: "Full stack — education platform", createdAt: "2026-10-07T10:30:00Z", generationStatus: "ready", baseTemplate: "One-page technical", highlightedSkills: ["React", "Node.js"], pageCount: 1, isDemo: true },
  { kind: "resume", id: "res-003", applicationId: "app-001", jobId: "job-003", version: "v2", title: "Backend — ledger services", createdAt: "2026-10-26T10:30:00Z", generationStatus: "ready", baseTemplate: "One-page technical", highlightedSkills: ["Java", "PostgreSQL", "JUnit"], pageCount: 1, isDemo: true },
  { kind: "resume", id: "res-004", applicationId: "app-002", jobId: "job-015", version: "v1", title: "Backend — payments APIs", createdAt: "2026-11-09T14:45:00Z", generationStatus: "ready", baseTemplate: "One-page technical", highlightedSkills: ["TypeScript", "Node.js", "PostgreSQL"], pageCount: 1, isDemo: true },
  { kind: "resume", id: "res-005", applicationId: "app-003", jobId: "job-007", version: "v1", title: "Security tooling", createdAt: "2026-10-31T16:00:00Z", generationStatus: "ready", baseTemplate: "One-page technical", highlightedSkills: ["Python", "GitHub Actions", "Linux"], pageCount: 1, isDemo: true },
  { kind: "resume", id: "res-006", applicationId: "app-004", jobId: "job-009", version: "v1", title: "Mobile — driver app", createdAt: "2026-11-10T11:05:00Z", generationStatus: "generating", baseTemplate: "One-page technical", highlightedSkills: ["Kotlin", "Swift"], pageCount: null, isDemo: true },
  { kind: "resume", id: "res-007", applicationId: "app-008", jobId: "job-014", version: "v1", title: "Platform — transit feeds", createdAt: "2026-11-03T16:00:00Z", generationStatus: "failed", baseTemplate: "One-page technical", highlightedSkills: ["Go", "PostgreSQL"], pageCount: null, isDemo: true },
];

export const DEMO_COVER_LETTERS: CoverLetterArtifact[] = [
  { kind: "cover_letter", id: "cl-000", applicationId: null, jobId: null, version: "base-v1", title: "Base cover letter", createdAt: "2026-09-21T15:00:00Z", generationStatus: "draft", baseTemplate: "Three-paragraph", tone: "formal", wordCount: 280, isDemo: true },
  { kind: "cover_letter", id: "cl-001", applicationId: "app-005", jobId: "job-004", version: "v1", title: "Health scheduling — new grad", createdAt: "2026-10-14T09:40:00Z", generationStatus: "ready", baseTemplate: "Three-paragraph", tone: "conversational", wordCount: 310, isDemo: true },
  { kind: "cover_letter", id: "cl-002", applicationId: "app-001", jobId: "job-003", version: "v2", title: "Ledger services co-op", createdAt: "2026-10-26T10:38:00Z", generationStatus: "ready", baseTemplate: "Three-paragraph", tone: "formal", wordCount: 295, isDemo: true },
  { kind: "cover_letter", id: "cl-003", applicationId: "app-002", jobId: "job-015", version: "v1", title: "Payments APIs — new grad", createdAt: "2026-11-09T15:00:00Z", generationStatus: "ready", baseTemplate: "Three-paragraph", tone: "conversational", wordCount: 330, isDemo: true },
  { kind: "cover_letter", id: "cl-004", applicationId: "app-003", jobId: "job-007", version: "v1", title: "Security engineering co-op", createdAt: "2026-11-01T14:00:00Z", generationStatus: "ready", baseTemplate: "Short form", tone: "concise", wordCount: 190, isDemo: true },
];

export const DEMO_PROJECTS: Project[] = [
  {
    id: "proj-001",
    name: "ledger-reconcile-demo",
    description: "A double-entry ledger service with nightly reconciliation reports and property-based tests.",
    technologies: ["Java", "Spring Boot", "PostgreSQL", "JUnit"],
    jobIds: ["job-003"],
    repository: { owner: "your-github", name: "ledger-reconcile-demo", visibility: "private", published: false },
    buildStatus: "passing",
    testStatus: "passing",
    createdAt: "2026-10-26T10:40:00Z",
    isDemo: true,
  },
  {
    id: "proj-002",
    name: "payments-idempotency-lab",
    description: "An HTTP API demonstrating idempotency keys, retries, and webhook signature verification.",
    technologies: ["TypeScript", "Node.js", "PostgreSQL", "Vitest"],
    jobIds: ["job-015"],
    repository: { owner: "your-github", name: "payments-idempotency-lab", visibility: "private", published: false },
    buildStatus: "passing",
    testStatus: "pending",
    createdAt: "2026-11-09T15:05:00Z",
    isDemo: true,
  },
  {
    id: "proj-003",
    name: "sensor-telemetry-pipeline",
    description: "Firmware-side telemetry batching with a small ingestion service and dashboard.",
    technologies: ["C++", "Python", "FastAPI"],
    jobIds: ["job-001"],
    repository: { owner: "your-github", name: "sensor-telemetry-pipeline", visibility: "private", published: false },
    buildStatus: "not_run",
    testStatus: "not_run",
    createdAt: "2026-11-10T15:00:00Z",
    isDemo: true,
  },
  {
    id: "proj-004",
    name: "transit-feed-normalizer",
    description: "Normalizes real-time transit feeds into a common schema with replayable fixtures.",
    technologies: ["Go", "Protocol Buffers", "PostgreSQL"],
    jobIds: ["job-014", "job-010"],
    repository: { owner: "your-github", name: "transit-feed-normalizer", visibility: "private", published: false },
    buildStatus: "passing",
    testStatus: "failing",
    createdAt: "2026-11-03T16:30:00Z",
    isDemo: true,
  },
];
