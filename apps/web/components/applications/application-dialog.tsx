"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changeApplicationStatusAction, recordInterviewAction, updateApplicationNotesAction } from "@/app/applications/actions";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ApplicationRow } from "@/lib/applications/rows";
import { allowedSubmissionTransitions } from "@/lib/applications/transitions";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  GENERATION_STATUS,
  MODE_LABELS,
  PREPARATION_STATUS,
  RUN_KIND_LABELS,
  RUN_STATUS,
  SUBMISSION_STATUS,
  INTERVIEW_STAGE_LABELS,
  type StatusMeta,
} from "@/lib/labels";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { INTERVIEW_STAGES, type SubmissionStatus } from "@/lib/types";

export function ApplicationDialog({
  row,
  onOpenChange,
  writable,
}: {
  row: ApplicationRow | null;
  onOpenChange: (open: boolean) => void;
  writable: boolean;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      {row ? <ApplicationDialogBody row={row} writable={writable} /> : null}
    </Dialog>
  );
}

function ApplicationDialogBody({ row, writable }: { row: ApplicationRow; writable: boolean }) {
  const router = useRouter();
  const { application, job, resume, coverLetter, project, runs, events, interviews } = row;
  const [current, setCurrent] = useState(application);
  const [target, setTarget] = useState<SubmissionStatus | "">("");
  const [submittedOn, setSubmittedOn] = useState(application.submittedAt?.slice(0, 10) ?? "");
  const [notes, setNotes] = useState(application.notes);
  const [stage, setStage] = useState<(typeof INTERVIEW_STAGES)[number]>("recruiter_screen");
  const [interviewDate, setInterviewDate] = useState("");
  const [interviewNotes, setInterviewNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
  const refresh = () => { router.refresh(); };
  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <div className="flex items-center gap-2">
          <DemoBadge when={application.isDemo} />
          <span className="text-xs text-muted-foreground">{MODE_LABELS[application.mode]}</span>
        </div>
        <DialogTitle>{job?.title ?? "Unknown job"}</DialogTitle>
        <DialogDescription>{job?.company}</DialogDescription>
      </DialogHeader>

      <dl className="grid grid-cols-2 gap-4 text-sm">
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Preparation</dt>
          <dd>
          <StatusBadge meta={PREPARATION_STATUS[current.preparationStatus]} />
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Submission</dt>
          <dd>
          <StatusBadge meta={SUBMISSION_STATUS[current.submissionStatus]} />
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Submitted on</dt>
          <dd>{formatDate(current.submittedAt)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">Last updated</dt>
          <dd>{formatDate(current.updatedAt)}</dd>
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

      <fieldset disabled={!writable} className="space-y-4 disabled:opacity-60">
      <section className="space-y-2"><h3 className="text-sm font-medium">Update application</h3>
        {message ? <p role="status" className="text-sm">{message}</p> : null}
        <div className="grid gap-2 sm:grid-cols-2"><NativeSelect aria-label="New application status" value={target} onChange={(e) => setTarget(e.target.value as SubmissionStatus)}><option value="">Choose status…</option>{allowedSubmissionTransitions(current.submissionStatus).map((s) => <option key={s} value={s}>{SUBMISSION_STATUS[s].label}</option>)}</NativeSelect><Input aria-label="Submission date" type="date" value={submittedOn} onChange={(e) => setSubmittedOn(e.target.value)} /></div>
        <Button size="sm" disabled={pending || !target} onClick={() => startTransition(async () => { if (!target) return; const result = await changeApplicationStatusAction({ applicationId: current.id, expectedStatus: current.submissionStatus, to: target, submittedOn: submittedOn || null, note: null, today }); if (!result.ok) { setMessage(result.message); return; } setCurrent(result.value); setTarget(""); setMessage(`Status changed to ${SUBMISSION_STATUS[result.value.submissionStatus].label}.`); refresh(); })}>Update status</Button>
      </section>

      <section className="space-y-2"><h3 className="text-sm font-medium">Notes</h3><Textarea aria-label="Application notes" value={notes} onChange={(e) => setNotes(e.target.value)} /><Button size="sm" variant="outline" disabled={pending || notes === current.notes} onClick={() => startTransition(async () => { const result = await updateApplicationNotesAction({ applicationId: current.id, expectedUpdatedAt: current.updatedAt, notes }); if (!result.ok) { setMessage(result.message); return; } setCurrent(result.value); setNotes(result.value.notes); setMessage("Application notes saved."); refresh(); })}>Save application notes</Button></section>

      <section className="space-y-2"><h3 className="text-sm font-medium">Record interview</h3><div className="grid gap-2 sm:grid-cols-2"><NativeSelect aria-label="Interview stage" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>{INTERVIEW_STAGES.map((s) => <option key={s} value={s}>{INTERVIEW_STAGE_LABELS[s]}</option>)}</NativeSelect><Input aria-label="Interview date" type="date" value={interviewDate} onChange={(e) => setInterviewDate(e.target.value)} /></div><Input aria-label="Interview notes" value={interviewNotes} onChange={(e) => setInterviewNotes(e.target.value)} /><Button size="sm" variant="outline" disabled={pending || !interviewDate} onClick={() => startTransition(async () => { const result = await recordInterviewAction({ applicationId: current.id, stage, occurredOn: interviewDate, notes: interviewNotes, today }); if (!result.ok) { setMessage(result.message); return; } setCurrent(result.value); setInterviewDate(""); setInterviewNotes(""); setMessage("Interview recorded."); refresh(); })}>Add interview</Button></section>
      </fieldset>

      <section className="space-y-2"><h3 className="text-sm font-medium">History</h3>{events.length === 0 && interviews.length === 0 ? <p className="text-sm text-muted-foreground">No history recorded yet.</p> : <ol className="space-y-2 text-sm">{events.map((event) => <li key={event.id} className="rounded border p-2"><span className="font-medium">{event.type.replaceAll("_", " ")}</span><span className="block text-xs text-muted-foreground">{formatDateTime(event.occurredAt)}{event.message ? ` · ${event.message}` : ""}</span></li>)}{interviews.map((interview) => <li key={interview.id} className="rounded border p-2"><span className="font-medium">{INTERVIEW_STAGE_LABELS[interview.stage]}</span><span className="block text-xs text-muted-foreground">{interview.occurredOn}{interview.notes ? ` · ${interview.notes}` : ""}</span></li>)}</ol>}</section>

      <DialogFooter>
        {job ? (
          <Link href={`/jobs/${job.id}`} className="inline-flex h-8 items-center px-3 text-sm font-medium text-primary hover:underline">
            View job posting
          </Link>
        ) : null}
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
