import Link from "next/link";
import { Calendar, Clock, MapPin } from "lucide-react";
import { FitScore } from "@/components/fit-score";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDuration, formatLocation } from "@/lib/format";
import { ARRANGEMENT_LABELS, DISCIPLINE_LABELS, DISCOVERY_STATUS, JOB_TYPE_LABELS } from "@/lib/labels";
import type { JobWithMatch } from "@/lib/types";

export function JobListItem({ item }: { item: JobWithMatch }) {
  const { job, match } = item;
  const arrangements = Array.from(new Set(job.locations.map((l) => l.arrangement)));

  return (
    <li>
      <Link
        href={`/jobs/${job.id}`}
        className="group flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs outline-none transition-colors hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex-row sm:items-start sm:justify-between"
      >
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge meta={DISCOVERY_STATUS[job.discoveryStatus]} srPrefix="Discovery status:" />
            <Badge variant="secondary">{JOB_TYPE_LABELS[job.jobType]}</Badge>
            {arrangements.map((a) => (
              <Badge key={a} variant="outline">
                {ARRANGEMENT_LABELS[a]}
              </Badge>
            ))}
            <DemoBadge when={job.isDemo} />
          </div>
          <div>
            <h3 className="font-medium group-hover:text-primary">{job.title}</h3>
            <p className="text-sm text-muted-foreground">{job.company}</p>
          </div>
          <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <dt className="sr-only">Location</dt>
              <MapPin className="size-3.5" aria-hidden="true" />
              <dd>{job.locations.map(formatLocation).join(" · ")}</dd>
            </div>
            <div className="flex items-center gap-1">
              <dt className="sr-only">Duration</dt>
              <Clock className="size-3.5" aria-hidden="true" />
              <dd>
                {formatDuration(job.durationMonths)}
                {job.term ? ` · ${job.term}` : ""}
              </dd>
            </div>
            <div className="flex items-center gap-1">
              <dt className="sr-only">Discovered</dt>
              <Calendar className="size-3.5" aria-hidden="true" />
              <dd>
                Found <time dateTime={job.discoveredAt}>{formatDate(job.discoveredAt)}</time>
              </dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            {job.disciplines.map((d) => DISCIPLINE_LABELS[d]).join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:flex-col sm:items-end">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Fit</span>
          <FitScore score={match?.fitScore ?? null} />
        </div>
      </Link>
    </li>
  );
}
