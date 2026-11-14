"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Globe, LoaderCircle, Plus, Search } from "lucide-react";
import { importCareerUrlAction, previewCareerUrlAction } from "@/app/boards/actions";
import { describedBy, Field } from "@/components/forms/field";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ImportPreview } from "@/lib/careers/importer";
import { SOURCE_PROVIDER_LABELS } from "@/lib/labels";

const STRATEGY_LABELS: Record<string, string> = {
  ats_api: "Provider API",
  workday_cxs: "Workday career site JSON",
  json_ld: "Structured data (JSON-LD JobPosting)",
  sitemap: "Sitemap + job pages",
  static_html: "Page links + job pages (HTML)",
  rendered: "Browser rendering",
};

export function strategyLabel(s: string | null | undefined): string {
  return s ? (STRATEGY_LABELS[s] ?? s) : "—";
}

/**
 * Universal career-URL import (Milestone 3D): paste any public careers URL;
 * ProRez detects the ATS/Workday board or extracts the page, shows what it
 * found, and registers the source only when real jobs were extracted.
 */
export function CareerUrlImporter({ saving }: { saving: { enabled: boolean; reason: string | null } }) {
  const [url, setUrl] = useState("");
  const [employerName, setEmployerName] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [checking, startCheck] = useTransition();
  const [registering, startRegister] = useTransition();

  function check(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setPreview(null);
    startCheck(async () => {
      const result = await previewCareerUrlAction(url);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setPreview(result.value);
      setEmployerName(result.value.companyName ?? "");
    });
  }

  function register() {
    if (!preview) return;
    setError(null);
    startRegister(async () => {
      const result = await importCareerUrlAction(preview.inputUrl, employerName);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setSuccess(`Registered ${employerName || result.value.preview.companyName || "the source"} (${SOURCE_PROVIDER_LABELS[result.value.preview.provider]}). The worker syncs it shortly.`);
      setPreview(null);
      setUrl("");
      setEmployerName("");
    });
  }

  const busy = checking || registering;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Globe className="size-4" aria-hidden /> Import a careers page
        </CardTitle>
        <CardDescription>
          Paste any public careers URL — a company careers page, a Workday site, or a Greenhouse, Lever, Ashby or SmartRecruiters board or job. ProRez detects the source and previews the jobs it can extract.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={check} noValidate className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Field id="career-url" label="Careers URL" hint="e.g. https://example.com/careers or https://example.wd3.myworkdayjobs.com/External">
              <Input {...describedBy("career-url", undefined, true)} type="url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!saving.enabled || busy} />
            </Field>
          </div>
          <Button type="submit" variant="outline" disabled={!saving.enabled || busy || !url.trim()} className="sm:mb-5" title={saving.enabled ? undefined : (saving.reason ?? undefined)}>
            {checking ? <LoaderCircle className="animate-spin" /> : <Search />} {checking ? "Checking…" : "Check URL"}
          </Button>
        </form>

        {error ? (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {success ? (
          <p role="status" className="rounded-md border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 text-sm">
            {success}
          </p>
        ) : null}

        {preview ? (
          <section aria-label="Import preview" className="space-y-3 rounded-md border p-3 text-sm" data-testid="career-preview">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[max-content_1fr]">
              <dt className="text-muted-foreground">Source type</dt>
              <dd>
                {SOURCE_PROVIDER_LABELS[preview.provider]}
                {preview.routedFrom ? <span className="text-muted-foreground"> (linked from {preview.routedFrom})</span> : null}
              </dd>
              <dt className="text-muted-foreground">Canonical URL</dt>
              <dd className="font-mono text-xs break-all">{preview.canonicalUrl}</dd>
              <dt className="text-muted-foreground">Company</dt>
              <dd>{preview.companyName ?? "Unknown"}</dd>
              <dt className="text-muted-foreground">Verification</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                <StatusBadge meta={preview.verification === "verified" ? { label: "Company confirmed", tone: "success" } : { label: "Not confirmed", tone: "warning" }} />
                <span className="text-muted-foreground">{preview.verificationNote}</span>
              </dd>
              <dt className="text-muted-foreground">Extraction method</dt>
              <dd>{strategyLabel(preview.extractionStrategy)}</dd>
              <dt className="text-muted-foreground">Jobs detected</dt>
              <dd data-testid="career-preview-jobs">
                {preview.jobsDetected} ({preview.eligibleJobs} Canadian entry-level)
              </dd>
              <dt className="text-muted-foreground">Descriptions</dt>
              <dd>
                {preview.withFullDescription} of {preview.jobsDetected} with a full description
              </dd>
              <dt className="text-muted-foreground">Listing</dt>
              <dd>
                {preview.listingComplete ? (
                  <Badge variant="outline">Complete</Badge>
                ) : (
                  <span>Not provably complete — absent jobs are never expired from an incomplete snapshot.</span>
                )}
              </dd>
            </dl>
            {preview.sampleJobs.length > 0 ? (
              <div>
                <div className="font-medium">Sample jobs</div>
                <ul className="list-disc pl-5">
                  {preview.sampleJobs.map((j, i) => (
                    <li key={`${j.url}-${i}`}>
                      {j.title}
                      {j.location ? <span className="text-muted-foreground"> — {j.location}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview.warnings.length > 0 ? (
              <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
            {preview.registrable ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field id="career-employer" label="Employer name" required>
                    <Input {...describedBy("career-employer", undefined)} value={employerName} onChange={(e) => setEmployerName(e.target.value)} disabled={busy} />
                  </Field>
                </div>
                <Button type="button" onClick={register} disabled={busy || !employerName.trim()} className="sm:mb-5">
                  {registering ? <LoaderCircle className="animate-spin" /> : <Plus />} {registering ? "Registering…" : "Register source"}
                </Button>
              </div>
            ) : (
              <p role="alert" className="text-destructive">
                {preview.blocker}
              </p>
            )}
          </section>
        ) : null}
      </CardContent>
    </Card>
  );
}
