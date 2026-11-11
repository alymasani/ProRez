import { RUN_KIND_LABELS, RUN_STATUS, type StatusMeta } from "./labels";
import type { Application, ApplicationRun, IsoDateTime, JobPosting } from "./types";

export interface ActivityEvent {
  id: string;
  at: IsoDateTime;
  applicationId: string;
  job: JobPosting | undefined;
  title: string;
  detail: string;
  status: StatusMeta;
}

/** Merges generation runs and recorded submissions into one newest-first feed. */
export function buildActivityFeed(
  applications: readonly Application[],
  runs: readonly ApplicationRun[],
  getJob: (id: string) => JobPosting | undefined,
  limit = 8,
): ActivityEvent[] {
  const appsById = new Map(applications.map((a) => [a.id, a]));

  const runEvents: ActivityEvent[] = runs.map((run) => {
    const app = appsById.get(run.applicationId);
    return {
      id: run.id,
      at: run.finishedAt ?? run.startedAt,
      applicationId: run.applicationId,
      job: app ? getJob(app.jobId) : undefined,
      title: RUN_KIND_LABELS[run.kind],
      detail: run.summary,
      status: RUN_STATUS[run.status],
    };
  });

  const submissionEvents: ActivityEvent[] = applications
    .filter((a): a is Application & { submittedAt: string } => a.submittedAt !== null)
    .map((a) => ({
      id: `submitted-${a.id}`,
      at: a.submittedAt,
      applicationId: a.id,
      job: getJob(a.jobId),
      title: "Submission recorded",
      detail: "Marked as submitted by the user.",
      status: { label: "Recorded", tone: "info" },
    }));

  return [...runEvents, ...submissionEvents]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}
