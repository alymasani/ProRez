"use client";

import { useRef, useState, type FormEvent } from "react";
import { Eye, Hammer, RotateCcw, Zap } from "lucide-react";
import { describedBy, Field } from "@/components/forms/field";
import { PreviewNotice } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import {
  DESCRIPTION_MAX_LENGTH,
  EMPTY_MANUAL_SUBMISSION,
  validateManualSubmission,
  type ManualSubmission,
  type ManualSubmissionErrors,
  type ManualSubmissionInput,
} from "@/lib/jobs/manual-submission";
import { formatDuration } from "@/lib/format";
import { JOB_TYPE_LABELS, MODE_LABELS } from "@/lib/labels";
import { JOB_TYPES, type ApplicationMode } from "@/lib/types";
import { cn } from "@/lib/utils";

const MODE_OPTIONS: { value: ApplicationMode; icon: typeof Zap; description: string }[] = [
  { value: "quick_apply", icon: Zap, description: "Tailored resume and cover letter." },
  { value: "full_build", icon: Hammer, description: "Resume, cover letter, and a relevant project." },
];

export function ManualJobForm() {
  const [input, setInput] = useState<ManualSubmissionInput>(EMPTY_MANUAL_SUBMISSION);
  const [errors, setErrors] = useState<ManualSubmissionErrors>({});
  const [preview, setPreview] = useState<ManualSubmission | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function set<K extends keyof ManualSubmissionInput>(key: K, value: ManualSubmissionInput[K]) {
    setInput((prev) => ({ ...prev, [key]: value }));
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = validateManualSubmission(input);
    if (!result.ok) {
      setErrors(result.errors);
      setPreview(null);
      // Move focus to the first invalid control.
      requestAnimationFrame(() => {
        formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      });
      return;
    }
    setErrors({});
    setPreview(result.value);
    requestAnimationFrame(() => previewRef.current?.focus());
  }

  function reset() {
    setInput(EMPTY_MANUAL_SUBMISSION);
    setErrors({});
    setPreview(null);
  }

  const durationRelevant = input.jobType !== "new_grad";

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
      <form ref={formRef} onSubmit={onSubmit} noValidate className="space-y-6 xl:col-span-3">
        <Card>
          <CardHeader>
            <CardTitle>Job source</CardTitle>
            <CardDescription>Provide a link to the posting, paste its description, or both.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field id="jobUrl" label="Job URL" required hint="Full address starting with https://" error={errors.jobUrl}>
              <Input
                {...describedBy("jobUrl", errors.jobUrl, true)}
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://careers.example.com/jobs/12345"
                value={input.jobUrl}
                onChange={(e) => set("jobUrl", e.target.value)}
              />
            </Field>
            <Field
              id="description"
              label="Job description"
              hint={`${input.description.length.toLocaleString("en-CA")} / ${DESCRIPTION_MAX_LENGTH.toLocaleString("en-CA")} characters`}
              error={errors.description}
            >
              <Textarea
                {...describedBy("description", errors.description, true)}
                rows={8}
                placeholder="Paste the full job description here…"
                value={input.description}
                onChange={(e) => set("description", e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Position details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="company" label="Company name" required error={errors.company}>
              <Input
                {...describedBy("company", errors.company)}
                autoComplete="organization"
                value={input.company}
                onChange={(e) => set("company", e.target.value)}
              />
            </Field>
            <Field id="title" label="Position title" required error={errors.title}>
              <Input
                {...describedBy("title", errors.title)}
                value={input.title}
                onChange={(e) => set("title", e.target.value)}
              />
            </Field>
            <Field id="location" label="Location" hint="e.g. Toronto, ON · Hybrid" error={errors.location}>
              <Input
                {...describedBy("location", errors.location, true)}
                value={input.location}
                onChange={(e) => set("location", e.target.value)}
              />
            </Field>
            <Field id="jobType" label="Employment type" required error={errors.jobType}>
              <NativeSelect
                {...describedBy("jobType", errors.jobType)}
                value={input.jobType}
                onChange={(e) => set("jobType", e.target.value)}
              >
                <option value="">Select a type…</option>
                {JOB_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {JOB_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field
              id="durationMonths"
              label="Duration (months)"
              hint={durationRelevant ? "Leave blank if not stated." : "Usually not applicable to new grad roles."}
              error={errors.durationMonths}
            >
              <Input
                {...describedBy("durationMonths", errors.durationMonths, true)}
                type="number"
                inputMode="numeric"
                min={1}
                max={24}
                step={1}
                placeholder="4"
                value={input.durationMonths}
                onChange={(e) => set("durationMonths", e.target.value)}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Application mode</CardTitle>
          </CardHeader>
          <CardContent>
            <fieldset aria-describedby={errors.mode ? "mode-error" : undefined}>
              <legend className="sr-only">Application mode (required)</legend>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {MODE_OPTIONS.map(({ value, icon: Icon, description }) => (
                  <label
                    key={value}
                    className={cn(
                      "flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                      input.mode === value ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                      errors.mode && "border-destructive",
                    )}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value={value}
                      checked={input.mode === value}
                      onChange={() => set("mode", value)}
                      className="mt-1 size-4 shrink-0 self-start accent-[var(--primary)]"
                    />
                    <span>
                      <span className="flex items-center gap-1.5 font-medium">
                        <Icon className="size-4 text-primary" aria-hidden="true" />
                        {MODE_LABELS[value]}
                      </span>
                      <span className="text-sm text-muted-foreground">{description}</span>
                    </span>
                  </label>
                ))}
              </div>
              {errors.mode ? (
                <p id="mode-error" className="mt-2 text-xs text-destructive">
                  {errors.mode}
                </p>
              ) : null}
            </fieldset>
          </CardContent>
        </Card>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={reset}>
            <RotateCcw /> Clear form
          </Button>
          <Button type="submit">
            <Eye /> Validate &amp; preview
          </Button>
        </div>
      </form>

      <aside className="space-y-4 xl:col-span-2">
        <PreviewNotice title="Preview only — nothing is saved">
          Submitting validates the form and shows a local preview below. The job is not stored, no workflow is started,
          and nothing is sent anywhere. Saving arrives in a later milestone.
        </PreviewNotice>

        <div ref={previewRef} tabIndex={-1} className="rounded-xl outline-none" aria-live="polite">
          {preview ? (
            <Card className="border-dashed">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <CardTitle>Local preview</CardTitle>
                  <Badge variant="warning">Not saved</Badge>
                </div>
                <CardDescription>This is how the job would be recorded. Refreshing the page discards it.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-3 text-sm">
                  <PreviewRow label="Company">{preview.company}</PreviewRow>
                  <PreviewRow label="Position">{preview.title}</PreviewRow>
                  <PreviewRow label="Location">{preview.location ?? "Not specified"}</PreviewRow>
                  <PreviewRow label="Employment type">{JOB_TYPE_LABELS[preview.jobType]}</PreviewRow>
                  <PreviewRow label="Duration">{formatDuration(preview.durationMonths)}</PreviewRow>
                  <PreviewRow label="Mode">{MODE_LABELS[preview.mode]}</PreviewRow>
                  <PreviewRow label="Job URL">
                    <span className="break-all font-mono text-xs">{preview.jobUrl ?? "Not provided"}</span>
                  </PreviewRow>
                  <PreviewRow label="Description">
                    {preview.description ? (
                      <span className="line-clamp-4 whitespace-pre-line text-muted-foreground">{preview.description}</span>
                    ) : (
                      "Not provided"
                    )}
                  </PreviewRow>
                </dl>
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Fill in the form and choose <span className="font-medium">Validate &amp; preview</span> to see the result
              here.
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function PreviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
