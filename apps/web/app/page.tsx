import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BriefcaseBusiness,
  CircleCheck,
  ClipboardCheck,
  Hourglass,
  Send,
  Sparkles,
} from "lucide-react";
import { FitScore } from "@/components/fit-score";
import { FutureAction } from "@/components/future-action";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildActivityFeed } from "@/lib/activity";
import {
  getApplicationRuns,
  getApplications,
  getApprovals,
  getJobIndex,
  getJobsWithMatches,
} from "@/lib/data";
import { formatDate, formatDateTime, formatPrimaryLocation } from "@/lib/format";
import { DISCOVERY_STATUS, JOB_TYPE_LABELS } from "@/lib/labels";
import { MATCH_THRESHOLD, computeOverviewMetrics } from "@/lib/metrics";

function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
}: {
  label: string;
  value: number;
  hint: string;
  icon: LucideIcon;
  href: "/jobs" | "/applications";
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Card className="h-full gap-3 transition-colors group-hover:border-primary/40">
        <CardHeader>
          <CardDescription className="font-medium">{label}</CardDescription>
          <CardAction>
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Icon className="size-4" aria-hidden="true" />
            </span>
          </CardAction>
        </CardHeader>
        <CardContent className="space-y-1">
          <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

export default function OverviewPage() {
  const jobs = getJobsWithMatches();
  const approvals = getApprovals();
  const applications = getApplications();
  const jobIndex = getJobIndex();
  const metrics = computeOverviewMetrics(jobs, approvals, applications);

  const recentJobs = [...jobs]
    .sort((a, b) => b.job.discoveredAt.localeCompare(a.job.discoveredAt))
    .slice(0, 6);
  const pendingApprovals = approvals
    .filter((a) => a.decision === "pending")
    .sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
  const activity = buildActivityFeed(applications, getApplicationRuns(), (id) => jobIndex.get(id));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="A snapshot of discovered roles and application progress. All figures below are computed from fictional demo fixtures."
        actions={
          <Button asChild>
            <Link href="/jobs/new">Add a job manually</Link>
          </Button>
        }
      />

      <section aria-labelledby="metrics-heading">
        <h2 id="metrics-heading" className="sr-only">
          Key metrics
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <MetricCard label="Discovered jobs" value={metrics.totalDiscovered} hint="All postings in demo data" icon={BriefcaseBusiness} href="/jobs" />
          <MetricCard label="New matching jobs" value={metrics.newMatching} hint={`New, fit score ≥ ${MATCH_THRESHOLD}`} icon={Sparkles} href="/jobs" />
          <MetricCard label="Pending approvals" value={metrics.pendingApprovals} hint="Awaiting a build decision" icon={Hourglass} href="/jobs" />
          <MetricCard label="Prepared applications" value={metrics.preparedNotSubmitted} hint="Materials ready, not submitted" icon={ClipboardCheck} href="/applications" />
          <MetricCard label="Submitted applications" value={metrics.submitted} hint="Recorded by the user" icon={Send} href="/applications" />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <Card className="xl:col-span-3 xl:self-start">
          <CardHeader>
            <CardTitle>Recent job discoveries</CardTitle>
            <CardDescription>Newest postings first.</CardDescription>
            <CardAction>
              <Button asChild variant="ghost" size="sm">
                <Link href="/jobs">
                  View all <ArrowRight />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            {recentJobs.length === 0 ? (
              <EmptyState title="No jobs discovered yet" />
            ) : (
              <ul className="-mx-2 divide-y">
                {recentJobs.map(({ job, match }) => (
                  <li key={job.id}>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="flex flex-col gap-2 rounded-lg px-2 py-3 outline-none hover:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0 space-y-1">
                        <p className="truncate font-medium">{job.title}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {job.company} · {formatPrimaryLocation(job.locations)}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge meta={DISCOVERY_STATUS[job.discoveryStatus]} srPrefix="Discovery status:" />
                          <span className="text-xs text-muted-foreground">
                            {JOB_TYPE_LABELS[job.jobType]} · Found {formatDate(job.discoveredAt)}
                          </span>
                          <DemoBadge />
                        </div>
                      </div>
                      <FitScore score={match?.fitScore ?? null} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6 xl:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Pending approvals</CardTitle>
              <CardDescription>
                Jobs awaiting a Full Build, Quick Apply, or Skip decision. Decisions open in a later milestone.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pendingApprovals.length === 0 ? (
                <EmptyState icon={CircleCheck} title="You're all caught up" />
              ) : (
                <ul className="space-y-3">
                  {pendingApprovals.map((approval) => {
                    const job = jobIndex.get(approval.jobId);
                    return (
                      <li key={approval.id} className="space-y-2 rounded-lg border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Link
                              href={`/jobs/${approval.jobId}`}
                              className="block truncate text-sm font-medium hover:underline"
                            >
                              {job?.title ?? "Unknown job"}
                            </Link>
                            <p className="truncate text-xs text-muted-foreground">
                              {job?.company} · Requested {formatDate(approval.requestedAt)}
                            </p>
                          </div>
                          <DemoBadge />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <FutureAction size="sm">Full Build</FutureAction>
                          <FutureAction size="sm">Quick Apply</FutureAction>
                          <FutureAction size="sm" variant="ghost">Skip</FutureAction>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent application activity</CardTitle>
              <CardDescription>Generation runs and recorded submissions.</CardDescription>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <EmptyState title="No activity yet" />
              ) : (
                <ol className="relative space-y-4 border-l pl-5">
                  {activity.map((event) => (
                    <li key={event.id} className="relative">
                      <span
                        aria-hidden="true"
                        className="absolute top-1.5 -left-[24.5px] size-2 rounded-full bg-border ring-4 ring-card"
                      />
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="text-sm font-medium">{event.title}</p>
                        <StatusBadge meta={event.status} />
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {event.job ? `${event.job.company} — ${event.job.title}` : "Unknown job"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {event.detail} · <time dateTime={event.at}>{formatDateTime(event.at)}</time>
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
