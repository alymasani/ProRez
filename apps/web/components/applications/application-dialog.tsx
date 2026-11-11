"use client";

import Link from "next/link";
import { FutureAction } from "@/components/future-action";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApplicationRow } from "@/lib/applications";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  GENERATION_STATUS,
  MODE_LABELS,
  PREPARATION_STATUS,
  RUN_KIND_LABELS,
  RUN_STATUS,
  SUBMISSION_STATUS,
  type StatusMeta,
} from "@/lib/labels";

export function ApplicationDialog({
  row,
  onOpenChange,
}: {
  row: ApplicationRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      {row ? <ApplicationDialogBody row={row} /> : null}
    </Dialog>
  );
}

function ApplicationDialogBody({ row }: { row: ApplicationRow }) {
  const { application, job, resume, coverLetter, project, runs } = row;
  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <div className="flex items-center gap-2">
          <DemoBadge />
          <span className="text-xs text-muted-foreground">{MODE_LABELS[application.mode]}</span>
        </div>
        <DialogTitle>{job?.title ?? "Unknown job"}</DialogTitle>
        <DialogDescription>{job?.company}</DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Preparation</dt>
          <dd>
            <StatusBadge meta={PREPARATION_STATUS[application.preparationStatus]} />
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Submission</dt>
          <dd>
            <StatusBadge meta={SUBMISSION_STATUS[application.submissionStatus]} />
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Submitted on</dt>
          <dd>{formatDate(application.submittedAt)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Last updated</dt>
          <dd>{formatDate(application.updatedAt)}</dd>
        </div>
      </dl>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Materials</h3>
        <ul className="divide-y rounded-lg border text-sm">
          <MaterialRow label="Resume" href="/resumes" name={resume ? `${resume.title} (${resume.version})` : null} status={resume ? GENERATION_STATUS[resume.generationStatus] : null} />
          <MaterialRow label="Cover letter" href="/cover-letters" name={coverLetter ? `${coverLetter.title} (${coverLetter.version})` : null} status={coverLetter ? GENERATION_STATUS[coverLetter.generationStatus] : null} />
          <MaterialRow label="Project" href="/projects" name={project?.name ?? null} status={null} />
        </ul>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-medium">Workflow runs</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No runs recorded.</p>
        ) : (
          <ul className="space-y-2">
            {runs.map((run) => (
              <li key={run.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{RUN_KIND_LABELS[run.kind]}</span>
                  <StatusBadge meta={RUN_STATUS[run.status]} />
                </div>
                <p className="mt-1 text-muted-foreground">{run.summary}</p>
                <p className="mt-1 text-xs text-muted-foreground">Started {formatDateTime(run.startedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {application.notes ? (
        <section className="space-y-1">
          <h3 className="text-sm font-medium">Notes</h3>
          <p className="text-sm text-muted-foreground">{application.notes}</p>
        </section>
      ) : null}

      <DialogFooter>
        {job ? (
          <Link href={`/jobs/${job.id}`} className="inline-flex h-8 items-center px-3 text-sm font-medium text-primary hover:underline">
            View job posting
          </Link>
        ) : null}
        <FutureAction>Record submission</FutureAction>
        <FutureAction>Edit notes</FutureAction>
      </DialogFooter>
    </DialogContent>
  );
}

function MaterialRow({
  label,
  name,
  href,
  status,
}: {
  label: string;
  name: string | null;
  href: "/resumes" | "/cover-letters" | "/projects";
  status: StatusMeta | null;
}) {
  return (
    <li className="flex items-center justify-between gap-3 px-3 py-2">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        {name ? (
          <Link href={href} className="block truncate hover:underline">
            {name}
          </Link>
        ) : (
          <p className="text-muted-foreground">None linked</p>
        )}
      </div>
      {status ? <StatusBadge meta={status} /> : null}
    </li>
  );
}
