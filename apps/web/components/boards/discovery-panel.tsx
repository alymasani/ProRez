"use client";

import { useState, useTransition } from "react";
import { Check, RefreshCw, Search, X } from "lucide-react";
import {
  approveCandidateAction,
  rejectCandidateAction,
  requestDiscoveryRunAction,
  revalidateCandidateAction,
} from "@/app/boards/actions";
import { EmptyState } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { DiscoveryCandidateView, DiscoveryDashboard } from "@/lib/discovery/dashboard";
import { formatDateTime } from "@/lib/format";
import type { StatusMeta } from "@/lib/labels";
import { SOURCE_PROVIDER_LABELS } from "@/lib/labels";

const CANDIDATE_STATUS: Record<DiscoveryCandidateView["status"], StatusMeta> = {
  discovered: { label: "Queued", tone: "neutral" },
  validating: { label: "Verifying", tone: "progress" },
  verified: { label: "Verified", tone: "success" },
  pending_review: { label: "Needs review", tone: "warning" },
  unsupported: { label: "Unsupported", tone: "muted" },
  rejected: { label: "Rejected", tone: "muted" },
  registered: { label: "Registered", tone: "info" },
};

const EVIDENCE_LABEL: Record<string, string> = {
  ats_board_response: "Provider API",
  official_site_link: "Company website link",
  official_site_redirect: "Company website redirect",
  search_result: "Search",
  common_crawl: "Common Crawl",
  existing_job_url: "A job you saved",
  existing_board: "Already registered",
  manual_review: "Your review",
};

const SOURCE_LABEL: Record<string, string> = { search: "Search", common_crawl: "Common Crawl", existing_jobs: "Your saved jobs", manual: "Manual" };

type Filter = "review" | "registered" | "rejected" | "all";
const FILTERS: { id: Filter; label: string; match: (c: DiscoveryCandidateView) => boolean }[] = [
  { id: "review", label: "Needs attention", match: (c) => c.status === "pending_review" || c.status === "verified" || c.status === "discovered" || c.status === "validating" },
  { id: "registered", label: "Registered", match: (c) => c.status === "registered" },
  { id: "rejected", label: "Rejected", match: (c) => c.status === "rejected" },
  { id: "all", label: "All", match: () => true },
];

export function DiscoveryPanel({ data, saving }: { data: DiscoveryDashboard; saving: { enabled: boolean; reason: string | null } }) {
  const [filter, setFilter] = useState<Filter>(data.counts.pending_review > 0 ? "review" : "all");
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const last = data.runs[0] ?? null;
  const visible = data.candidates.filter(FILTERS.find((f) => f.id === filter)!.match);

  function act(fn: () => Promise<{ ok: boolean; message?: string }>, success: string) {
    setNotice(null);
    startTransition(async () => {
      const result = await fn();
      setNotice(result.ok ? { tone: "success", text: success } : { tone: "error", text: result.message ?? "Something went wrong." });
    });
  }

  const stats: [string, number][] = [
    ["Candidates", data.counts.total],
    ["Verified", data.counts.verified + data.counts.registered],
    ["Registered automatically", data.counts.autoRegistered],
    ["Needs review", data.counts.pending_review],
    ["Rejected", data.counts.rejected],
  ];

  return (
    <Card aria-labelledby="discovery-title">
      <CardHeader>
        <CardTitle id="discovery-title">Board discovery</CardTitle>
        <CardDescription>
          ProRez looks for employer boards on the four supported ATS providers (search, your saved jobs, imported Common Crawl lists),
          confirms each board with the provider, and registers it automatically only when the company&apos;s own website links to it.
          Everything else waits here for your review.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {stats.map(([label, value]) => (
            <div key={label} className="rounded-lg border p-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-xl font-semibold tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="space-y-1 rounded-lg border p-3">
            <div>
              Last run:{" "}
              {last ? (
                <>
                  {formatDateTime(last.startedAt)} · {last.trigger === "scheduled" ? "automatic" : "manual"} · {last.status}
                </>
              ) : (
                "never"
              )}
            </div>
            {last ? (
              <div className="text-xs text-muted-foreground">
                {last.uniqueCandidates} boards found ({last.newCandidates} new) · {last.validated} checked · {last.registered} registered ·{" "}
                {last.pendingReview} for review · {last.rejected} rejected
              </div>
            ) : null}
            {last?.errorMessage ? <div className="text-xs text-amber-700 dark:text-amber-300">{last.errorMessage}</div> : null}
            <div>
              Next scheduled run:{" "}
              {data.scheduledEnabled ? (data.nextRunAt ? formatDateTime(data.nextRunAt) : "not scheduled") : "automatic discovery is off (PROREZ_DISCOVERY_ENABLED)"}
            </div>
          </div>
          <div className="space-y-1 rounded-lg border p-3">
            <div>
              Search API: {data.searchRequests24h} of {data.maxRequestsPerDay} requests used in the last 24 hours
            </div>
            <div>
              Tavily: {data.tavilyCreditsThisMonth} of {data.maxCreditsPerMonth} credits used this UTC month
            </div>
            {data.searchStatus ? <div className="text-xs text-muted-foreground">{data.searchStatus}</div> : null}
            {last ? (
              <div className="text-xs text-muted-foreground">
                Last run: {last.searchRequests} search requests · {last.searchCredits} credits
                {last.searchProvider ? ` (${last.searchProvider})` : ""} · {last.atsRequests} provider requests · {last.siteRequests} company sites · {last.apiErrors} errors
              </div>
            ) : null}
            {saving.enabled ? (
              <Button
                size="sm"
                variant="outline"
                className="mt-1"
                disabled={pending || data.runRequested}
                onClick={() => act(requestDiscoveryRunAction, "Discovery requested. The worker (npm run worker) starts it within a minute.")}
              >
                <Search /> {data.runRequested ? "Discovery requested…" : "Run discovery now"}
              </Button>
            ) : null}
          </div>
        </div>

        {notice ? (
          <p role={notice.tone === "error" ? "alert" : "status"} className={notice.tone === "error" ? "text-sm text-destructive" : "text-sm text-emerald-700 dark:text-emerald-300"}>
            {notice.text}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter candidates">
          {FILTERS.map((f) => (
            <Button key={f.id} size="sm" variant={filter === f.id ? "default" : "ghost"} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label} ({data.candidates.filter(f.match).length})
            </Button>
          ))}
        </div>

        {visible.length === 0 ? (
          <EmptyState icon={Search} title="No candidates here" description="Discovered boards appear here after a discovery run or an import." />
        ) : (
          <ul className="divide-y rounded-lg border text-sm" aria-label="Discovery candidates">
            {visible.map((c) => (
              <CandidateRow key={c.id} c={c} saving={saving.enabled} pending={pending} act={act} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function CandidateRow({
  c,
  saving,
  pending,
  act,
}: {
  c: DiscoveryCandidateView;
  saving: boolean;
  pending: boolean;
  act: (fn: () => Promise<{ ok: boolean; message?: string }>, success: string) => void;
}) {
  const [name, setName] = useState(c.companyName ?? "");
  const [reason, setReason] = useState("");
  const label = `${c.companyName ?? c.boardToken} (${SOURCE_PROVIDER_LABELS[c.provider]})`;
  const reviewable = c.status === "pending_review" || c.status === "verified";
  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 font-medium">
            {c.companyName ?? <span className="font-mono">{c.boardToken}</span>}
            <Badge variant="secondary">{SOURCE_PROVIDER_LABELS[c.provider]}</Badge>
            {c.region ? <Badge variant="outline">EU</Badge> : null}
            <StatusBadge meta={CANDIDATE_STATUS[c.status]} srPrefix="Discovery status:" />
          </div>
          <div className="font-mono text-xs break-all text-muted-foreground">{c.boardUrl}</div>
          <div className="text-xs text-muted-foreground">
            Found via {SOURCE_LABEL[c.source] ?? c.source} · {formatDateTime(c.firstDiscoveredAt)}
            {c.companyDomain ? ` · ${c.status === "verified" || c.status === "registered" ? "verified site" : "possible site (unverified)"}: ${c.companyDomain}` : ""}
            {c.postingCount !== null ? ` · ${c.postingCount} postings` : ""}
          </div>
          {c.statusReason ? <div className="text-xs">{c.statusReason}</div> : null}
        </div>
        {saving && (c.status === "rejected" || c.status === "pending_review" || c.status === "verified") ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => act(() => revalidateCandidateAction(c.id), `Queued ${label} for re-validation.`)}
            aria-label={`Re-validate ${label}`}
          >
            <RefreshCw /> Re-validate
          </Button>
        ) : null}
      </div>

      {saving && reviewable ? (
        <div className="flex flex-col gap-2 rounded-md bg-muted/40 p-2 sm:flex-row sm:items-end">
          <label className="flex-1 text-xs">
            Employer name
            <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={`Employer name for ${label}`} className="mt-1" />
          </label>
          <Button size="sm" disabled={pending || !name.trim()} onClick={() => act(() => approveCandidateAction(c.id, name.trim()), `Registered ${name.trim()}; it is scheduled for syncing.`)} aria-label={`Approve ${label}`}>
            <Check /> Approve
          </Button>
          <label className="flex-1 text-xs">
            Reason (optional)
            <Input value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`Rejection reason for ${label}`} className="mt-1" />
          </label>
          <Button size="sm" variant="outline" disabled={pending} onClick={() => act(() => rejectCandidateAction(c.id, reason), `Rejected ${label}.`)} aria-label={`Reject ${label}`}>
            <X /> Reject
          </Button>
        </div>
      ) : null}

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Evidence ({c.evidence.length})</summary>
        <ul className="mt-1 space-y-1" aria-label={`Evidence for ${label}`}>
          {c.evidence.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-1.5">
              <Badge variant={e.status === "validated" ? "success" : e.status === "failed" ? "muted" : "outline"}>
                {EVIDENCE_LABEL[e.type] ?? e.type} · {e.status}
              </Badge>
              <span className="text-muted-foreground">{formatDateTime(e.observedAt)}</span>
              {e.summary ? <span>{e.summary}</span> : null}
              {e.sourceUrl ? <span className="font-mono break-all text-muted-foreground">{e.sourceUrl}</span> : null}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}
