"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkMinus, RotateCcw, Trash2 } from "lucide-react";
import { changeJobStatusAction, updateJobNotesAction } from "@/app/jobs/actions";
import { createApplicationAction } from "@/app/applications/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NativeSelect, Textarea } from "@/components/ui/input";
import type { Application, ApplicationMode, JobPosting } from "@/lib/types";

export function JobManagement({ job, application, writable, readOnlyReason, defaultMode = "quick_apply" }: { job: JobPosting; application: Application | null; writable: boolean; readOnlyReason: string | null; defaultMode?: ApplicationMode }) {
  const router = useRouter();
  const [status, setStatus] = useState(job.discoveryStatus);
  const [notes, setNotes] = useState(job.notes);
  const [savedNotes, setSavedNotes] = useState(job.notes);
  const [mode, setMode] = useState<ApplicationMode>(defaultMode);
  const [message, setMessage] = useState<string | null>(readOnlyReason);
  const [pending, startTransition] = useTransition();
  const mutateStatus = (action: "save" | "unsave" | "dismiss" | "restore") => startTransition(async () => {
    const result = await changeJobStatusAction(job.id, action, status);
    if (!result.ok) { setMessage(result.message); return; }
    setStatus(result.value.discoveryStatus); setMessage(`Job ${result.value.discoveryStatus}.`); router.refresh();
  });
  const statusButton = status === "dismissed"
    ? <Button onClick={() => mutateStatus("restore")} disabled={!writable || pending}><RotateCcw />Restore job</Button>
    : <><Button variant="outline" onClick={() => mutateStatus(status === "saved" ? "unsave" : "save")} disabled={!writable || pending}>{status === "saved" ? <BookmarkMinus /> : <Bookmark />}{status === "saved" ? "Unsave job" : "Save job"}</Button><Button variant="outline" onClick={() => mutateStatus("dismiss")} disabled={!writable || pending}><Trash2 />Dismiss job</Button></>;
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">{statusButton}</div>
    {message ? <p className="text-sm" role="status">{message}</p> : null}
    <Card><CardHeader><CardTitle>Job notes</CardTitle><CardDescription>Private notes are saved separately from the immutable posting snapshot.</CardDescription></CardHeader><CardContent className="space-y-3"><Textarea aria-label="Job notes" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!writable} /><Button size="sm" disabled={!writable || pending || notes === savedNotes} onClick={() => startTransition(async () => { const result = await updateJobNotesAction(job.id, notes); if (!result.ok) { setMessage(result.message); return; } setSavedNotes(result.value.notes); setNotes(result.value.notes); setMessage("Job notes saved."); router.refresh(); })}>Save notes</Button></CardContent></Card>
    {!application ? <Card><CardHeader><CardTitle>Track application</CardTitle><CardDescription>Starting a record does not mean you applied.</CardDescription></CardHeader><CardContent className="flex flex-col gap-3 sm:flex-row"><NativeSelect aria-label="Application mode" value={mode} onChange={(e) => setMode(e.target.value as ApplicationMode)}><option value="quick_apply">Quick Apply</option><option value="full_build">Full Build</option></NativeSelect><Button disabled={!writable || pending || status === "dismissed"} onClick={() => startTransition(async () => { const result = await createApplicationAction({ jobId: job.id, mode, notes: "" }); if (!result.ok) { setMessage(result.message); return; } setMessage("Application tracking started."); router.refresh(); })}>Start tracking</Button></CardContent></Card> : null}
  </div>;
}
