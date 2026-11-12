import type {
  Application,
  ApplicationRun,
  ApplicationEvent,
  ApplicationInterview,
  CoverLetterArtifact,
  JobPosting,
  Project,
  ResumeArtifact,
} from "../types";

/** An application joined with everything the UI shows next to it. */
export interface ApplicationRow {
  application: Application;
  job: JobPosting | null;
  resume: ResumeArtifact | null;
  coverLetter: CoverLetterArtifact | null;
  project: Project | null;
  runs: ApplicationRun[];
  events: ApplicationEvent[];
  interviews: ApplicationInterview[];
}

export function buildApplicationRows(input: {
  applications: readonly Application[];
  jobs: readonly JobPosting[];
  resumes: readonly ResumeArtifact[];
  coverLetters: readonly CoverLetterArtifact[];
  projects: readonly Project[];
  runs: readonly ApplicationRun[];
  events?: readonly ApplicationEvent[];
  interviews?: readonly ApplicationInterview[];
}): ApplicationRow[] {
  const byId = <T extends { id: string }>(items: readonly T[]) => new Map(items.map((i) => [i.id, i]));
  const jobs = byId(input.jobs);
  const resumes = byId(input.resumes);
  const letters = byId(input.coverLetters);
  const projects = byId(input.projects);

  return input.applications
    .map((application) => ({
      application,
      job: jobs.get(application.jobId) ?? null,
      resume: application.resumeId ? (resumes.get(application.resumeId) ?? null) : null,
      coverLetter: application.coverLetterId ? (letters.get(application.coverLetterId) ?? null) : null,
      project: application.projectId ? (projects.get(application.projectId) ?? null) : null,
      runs: input.runs
        .filter((r) => r.applicationId === application.id)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
      events: (input.events ?? []).filter((e) => e.applicationId === application.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)),
      interviews: (input.interviews ?? []).filter((i) => i.applicationId === application.id).sort((a, b) => b.occurredOn.localeCompare(a.occurredOn)),
    }))
    .sort((a, b) => b.application.updatedAt.localeCompare(a.application.updatedAt));
}
