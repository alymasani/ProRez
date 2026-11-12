"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { createManualJobAction } from "@/app/jobs/actions";
import { describedBy, Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { EMPTY_MANUAL_JOB_INPUT, MANUAL_JOB_LIMITS, validateManualJob, type ManualJobErrors, type ManualJobInput } from "@/lib/jobs/manual-submission";
import { ARRANGEMENT_LABELS, JOB_TYPE_LABELS, PROVINCE_LABELS } from "@/lib/labels";
import { JOB_TYPES, PROVINCES, WORK_ARRANGEMENTS } from "@/lib/types";

export function ManualJobForm() {
  const router = useRouter();
  const [input, setInput] = useState<ManualJobInput>(EMPTY_MANUAL_JOB_INPUT);
  const [errors, setErrors] = useState<ManualJobErrors>({});
  const [message, setMessage] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<{ jobId: string; reason: string }[]>([]);
  const [pending, startTransition] = useTransition();
  function set<K extends keyof ManualJobInput>(key: K, value: ManualJobInput[K]) {
    setInput((old) => ({ ...old, [key]: value })); setErrors((old) => ({ ...old, [key]: undefined }));
  }
  function submit() {
    const checked = validateManualJob(input);
    if (!checked.ok) { setErrors(checked.errors); setMessage("Please fix the highlighted fields."); return; }
    setMessage(null);
    startTransition(async () => {
      const result = await createManualJobAction(input);
      if (result.ok) { router.push(`/jobs/${result.value.job.id}?created=1`); return; }
      setErrors((result.fieldErrors ?? {}) as ManualJobErrors); setMessage(result.message);
      setDuplicates((result.duplicates ?? []).map((d) => ({ jobId: d.jobId, reason: d.reasons.join(" ") })));
    });
  }
  return <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="space-y-6" noValidate>
    {message ? <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{message}</div> : null}
    {duplicates.length ? <Card><CardHeader><CardTitle>Existing job found</CardTitle></CardHeader><CardContent>{duplicates.map((d) => <p key={d.jobId} className="text-sm"><Link className="font-medium text-primary hover:underline" href={`/jobs/${d.jobId}`}>Open existing job</Link>{d.reason ? ` — ${d.reason}` : ""}</p>)}</CardContent></Card> : null}
    <Card><CardHeader><CardTitle>Job source</CardTitle></CardHeader><CardContent className="space-y-4">
      <Field id="jobUrl" label="Job URL" hint="Optional when a description is provided" error={errors.jobUrl}><Input {...describedBy("jobUrl", errors.jobUrl, true)} type="url" value={input.jobUrl} onChange={(e) => set("jobUrl", e.target.value)} /></Field>
      <Field id="description" label="Full job description" hint={`${input.description.length.toLocaleString()} / ${MANUAL_JOB_LIMITS.descriptionMax.toLocaleString()} characters`} error={errors.description}><Textarea {...describedBy("description", errors.description, true)} rows={12} value={input.description} onChange={(e) => set("description", e.target.value)} /></Field>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>Position details</CardTitle></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
      <Field id="company" label="Company" required error={errors.company}><Input {...describedBy("company", errors.company)} value={input.company} onChange={(e) => set("company", e.target.value)} /></Field>
      <Field id="title" label="Position title" required error={errors.title}><Input {...describedBy("title", errors.title)} value={input.title} onChange={(e) => set("title", e.target.value)} /></Field>
      <Field id="city" label="City" error={errors.city}><Input {...describedBy("city", errors.city, true)} value={input.city} onChange={(e) => set("city", e.target.value)} /></Field>
      <Field id="province" label="Province / territory" error={errors.province}><NativeSelect {...describedBy("province", errors.province, true)} value={input.province} onChange={(e) => set("province", e.target.value)}><option value="">Not specified</option>{PROVINCES.map((v) => <option key={v} value={v}>{PROVINCE_LABELS[v]}</option>)}</NativeSelect></Field>
      <Field id="arrangement" label="Work arrangement" error={errors.arrangement}><NativeSelect {...describedBy("arrangement", errors.arrangement, true)} value={input.arrangement} onChange={(e) => set("arrangement", e.target.value)}><option value="">Not specified</option>{WORK_ARRANGEMENTS.map((v) => <option key={v} value={v}>{ARRANGEMENT_LABELS[v]}</option>)}</NativeSelect></Field>
      <Field id="jobType" label="Employment type" required error={errors.jobType}><NativeSelect {...describedBy("jobType", errors.jobType)} value={input.jobType} onChange={(e) => set("jobType", e.target.value)}><option value="">Select…</option>{JOB_TYPES.map((v) => <option key={v} value={v}>{JOB_TYPE_LABELS[v]}</option>)}</NativeSelect></Field>
      <Field id="durationMonths" label="Duration (months)" error={errors.durationMonths}><Input {...describedBy("durationMonths", errors.durationMonths, true)} type="number" min={1} max={24} value={input.durationMonths} onChange={(e) => set("durationMonths", e.target.value)} /></Field>
      <Field id="term" label="Term" hint="For example, Summer 2027" error={errors.term}><Input {...describedBy("term", errors.term, true)} value={input.term} onChange={(e) => set("term", e.target.value)} /></Field>
      <Field id="experienceRequirement" label="Experience requirement" error={errors.experienceRequirement}><Input {...describedBy("experienceRequirement", errors.experienceRequirement, true)} value={input.experienceRequirement} onChange={(e) => set("experienceRequirement", e.target.value)} /></Field>
      <Field id="salaryMin" label="Minimum salary" error={errors.salaryMin}><Input {...describedBy("salaryMin", errors.salaryMin, true)} inputMode="numeric" value={input.salaryMin} onChange={(e) => set("salaryMin", e.target.value)} /></Field>
      <Field id="salaryMax" label="Maximum salary" error={errors.salaryMax}><Input {...describedBy("salaryMax", errors.salaryMax, true)} inputMode="numeric" value={input.salaryMax} onChange={(e) => set("salaryMax", e.target.value)} /></Field>
      <Field id="salaryPeriod" label="Salary period" error={errors.salaryPeriod}><NativeSelect {...describedBy("salaryPeriod", errors.salaryPeriod, true)} value={input.salaryPeriod} onChange={(e) => set("salaryPeriod", e.target.value)}><option value="">Not specified</option><option value="hour">Per hour</option><option value="month">Per month</option><option value="year">Per year</option></NativeSelect></Field>
      <Field id="notes" label="Notes" error={errors.notes}><Textarea {...describedBy("notes", errors.notes, true)} rows={4} value={input.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
    </CardContent></Card>
    <div className="flex justify-end"><Button type="submit" disabled={pending}><Save />{pending ? "Saving…" : "Save job"}</Button></div>
  </form>;
}
