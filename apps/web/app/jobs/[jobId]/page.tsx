import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Check, ListFilter, Minus } from "lucide-react";
import { FitScore } from "@/components/fit-score";
import { FutureAction } from "@/components/future-action";
import { PageHeader } from "@/components/page-header";
import { PreviewNotice } from "@/components/states";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getApplicationForJob,
  getJobSources,
  getJobWithMatch,
  getProfileMatchForJob,
  getSearchProfiles,
} from "@/lib/data";
import { formatDate, formatDateTime, formatDuration, formatLocation } from "@/lib/format";
import {
  ARRANGEMENT_LABELS,
  DISCIPLINE_LABELS,
  DISCOVERY_STATUS,
  JOB_TYPE_LABELS,
  MODE_LABELS,
  PREPARATION_STATUS,
  SOURCE_PROVIDER_LABELS,
  SUBMISSION_STATUS,
} from "@/lib/labels";

export async function generateMetadata({ params }: PageProps<"/jobs/[jobId]">): Promise<Metadata> {
  const { jobId } = await params;
  const item = await getJobWithMatch(jobId);
  return { title: item ? `${item.job.title} — ${item.job.company}` : "Job not found" };
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

export default async function JobDetailPage({ params }: PageProps<"/jobs/[jobId]">) {
  const { jobId } = await params;
  const item = await getJobWithMatch(jobId);
  if (!item) notFound();

  const { job, match } = item;
  const [sources, application, profileMatch, profiles] = await Promise.all([
    getJobSources(),
    getApplicationForJob(job.id),
    getProfileMatchForJob(job.id),
    getSearchProfiles(),
  ]);
  const source = sources.find((s) => s.id === job.sourceId) ?? null;
  const profilesById = new Map(profiles.map((p) => [p.id, p]));

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/jobs">
          <ArrowLeft /> All jobs
        </Link>
      </Button>

      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusBadge meta={DISCOVERY_STATUS[job.discoveryStatus]} srPrefix="Discovery status:" />
            <Badge variant="secondary">{JOB_TYPE_LABELS[job.jobType]}</Badge>
            <DemoBadge when={job.isDemo} label="Demo posting" />
          </span>
        }
        title={job.title}
        description={`${job.company} · ${job.locations.map(formatLocation).join(" · ")}`}
        actions={
          <>
            <FutureAction variant="default" size="default">Full Build</FutureAction>
            <FutureAction size="default">Quick Apply</FutureAction>
            <FutureAction size="default" variant="ghost">Skip</FutureAction>
          </>
        }
      />

      <PreviewNotice title="Demo posting — actions are not active yet">
        This company and role are fictional. Full Build, Quick Apply, and Skip will start generation workflows in a
        later milestone; nothing is generated or submitted from this page.
      </PreviewNotice>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>About the role</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-sm leading-relaxed">{job.summary}</p>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <section>
                  <h3 className="mb-2 text-sm font-medium">Responsibilities</h3>
                  <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                    {job.responsibilities.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </section>
                <section>
                  <h3 className="mb-2 text-sm font-medium">Qualifications</h3>
                  <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                    {job.qualifications.map((q) => (
                      <li key={q}>{q}</li>
                    ))}
                  </ul>
                </section>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Posting details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Detail label="Company">{job.company}</Detail>
                <Detail label="Employment type">{JOB_TYPE_LABELS[job.jobType]}</Detail>
                <Detail label="Duration">{formatDuration(job.durationMonths)}</Detail>
                <Detail label="Term">{job.term ?? "Not specified"}</Detail>
                <Detail label="Locations">
                  <ul>
                    {job.locations.map((l) => (
                      <li key={`${l.city}-${l.arrangement}`}>
                        {formatLocation(l)} · {ARRANGEMENT_LABELS[l.arrangement]}
                      </li>
                    ))}
                  </ul>
                </Detail>
                <Detail label="Disciplines">{job.disciplines.map((d) => DISCIPLINE_LABELS[d]).join(", ")}</Detail>
                <Detail label="Source">{source ? SOURCE_PROVIDER_LABELS[source.provider] : "Unknown"}</Detail>
                <Detail label="Posted">{formatDate(job.postedAt)}</Detail>
                <Detail label="Discovered">
                  <time dateTime={job.discoveredAt}>{formatDateTime(job.discoveredAt)}</time>
                </Detail>
                <Detail label="Posting URL">
                  {job.postingUrl ? (
                    <span className="block break-all font-mono text-xs text-muted-foreground">
                      {job.postingUrl}
                      <span className="mt-0.5 block font-sans">Placeholder address — not a real listing.</span>
                    </span>
                  ) : (
                    "—"
                  )}
                </Detail>
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Candidate fit</CardTitle>
              <CardDescription>Fictional score for demonstration — not computed by any model.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FitScore score={match?.fitScore ?? null} />
              {match ? (
                <>
                  <div>
                    <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Matched skills</h3>
                    <ul className="flex flex-wrap gap-1.5">
                      {match.matchedSkills.map((s) => (
                        <li key={s}>
                          <Badge variant="success">
                            <Check aria-hidden="true" /> {s}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </div>
                  {match.missingSkills.length > 0 ? (
                    <div>
                      <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">Gaps</h3>
                      <ul className="flex flex-wrap gap-1.5">
                        {match.missingSkills.map((s) => (
                          <li key={s}>
                            <Badge variant="muted">
                              <Minus aria-hidden="true" /> {s}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                    {match.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">This posting hasn&apos;t been scored yet.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Matching search profiles</CardTitle>
              <CardDescription>
                One record per job, even when several profiles match — so it produces a single notification.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {profileMatch ? (
                <ul className="space-y-2">
                  {profileMatch.matchedProfileIds.map((id) => {
                    const profile = profilesById.get(id);
                    return (
                      <li key={id} className="flex items-center justify-between gap-2 text-sm">
                        <Link href={`/profiles/${id}`} className="flex min-w-0 items-center gap-2 hover:underline">
                          <ListFilter className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate">{profile?.name ?? id}</span>
                        </Link>
                        {id === profileMatch.primaryProfileId ? <Badge variant="info">Primary</Badge> : null}
                      </li>
                    );
                  })}
                  <li className="pt-1 text-xs text-muted-foreground">
                    Illustrative demo record. Notification: not sent (Telegram is not connected).
                  </li>
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No demo profile-match record for this job. Profile evaluation arrives in a later milestone.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Application</CardTitle>
            </CardHeader>
            <CardContent>
              {application ? (
                <dl className="space-y-3">
                  <Detail label="Mode">{MODE_LABELS[application.mode]}</Detail>
                  <Detail label="Preparation">
                    <StatusBadge meta={PREPARATION_STATUS[application.preparationStatus]} />
                  </Detail>
                  <Detail label="Submission">
                    <StatusBadge meta={SUBMISSION_STATUS[application.submissionStatus]} />
                  </Detail>
                  <Button asChild variant="outline" size="sm" className="mt-1">
                    <Link href="/applications">View applications</Link>
                  </Button>
                </dl>
              ) : (
                <p className="text-sm text-muted-foreground">No application has been started for this job.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
