"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileText, Mail, Search, SearchX } from "lucide-react";
import { FutureAction } from "@/components/future-action";
import { EmptyState } from "@/components/states";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import { GENERATION_STATUS } from "@/lib/labels";
import type { DocumentArtifact, GenerationStatus } from "@/lib/types";

export interface DocumentItem {
  artifact: DocumentArtifact;
  /** Display info for the associated job, resolved on the server. */
  job: { id: string; title: string; company: string } | null;
}

type StatusFilter = GenerationStatus | "all";

export function DocumentLibrary({ items, noun }: { items: DocumentItem[]; noun: string }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items
      .filter(({ artifact }) => status === "all" || artifact.generationStatus === status)
      .filter(({ artifact, job }) =>
        !q
          ? true
          : [artifact.title, artifact.version, job?.company ?? "", job?.title ?? ""].join(" ").toLowerCase().includes(q),
      )
      .sort((a, b) => b.artifact.createdAt.localeCompare(a.artifact.createdAt));
  }, [items, query, status]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${noun}s by title, company, or version`}
            aria-label={`Search ${noun}s`}
            className="pl-9"
          />
        </div>
        <label htmlFor="doc-status" className="sr-only">
          Generation status
        </label>
        <NativeSelect
          id="doc-status"
          value={status}
          onChange={(e) => setStatus(e.target.value as StatusFilter)}
          className="sm:w-48"
        >
          <option value="all">All statuses</option>
          {(Object.keys(GENERATION_STATUS) as GenerationStatus[]).map((s) => (
            <option key={s} value={s}>
              {GENERATION_STATUS[s].label}
            </option>
          ))}
        </NativeSelect>
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {visible.length} of {items.length} demo {noun}s
      </p>

      {visible.length === 0 ? (
        <EmptyState icon={SearchX} title={`No ${noun}s match`} description="Try a different search or status." />
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((item) => (
            <li key={item.artifact.id}>
              <DocumentCard item={item} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DocumentCard({ item }: { item: DocumentItem }) {
  const { artifact, job } = item;
  const Icon = artifact.kind === "resume" ? FileText : Mail;
  const meta =
    artifact.kind === "resume"
      ? artifact.pageCount !== null
        ? `${artifact.pageCount} page${artifact.pageCount === 1 ? "" : "s"}`
        : null
      : [artifact.wordCount !== null ? `${artifact.wordCount} words` : null, `${artifact.tone} tone`]
          .filter(Boolean)
          .join(" · ");

  return (
    <Card className="h-full gap-4">
      <CardHeader className="grid-cols-[auto_1fr] gap-x-3">
        <span className="row-span-2 flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <h3 className="leading-tight font-medium">{artifact.title}</h3>
        <p className="text-xs text-muted-foreground">
          <span className="font-mono">{artifact.version}</span> · Created{" "}
          <time dateTime={artifact.createdAt}>{formatDate(artifact.createdAt)}</time>
        </p>
      </CardHeader>
      <CardContent className="flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge meta={GENERATION_STATUS[artifact.generationStatus]} srPrefix="Generation status:" />
          <DemoBadge />
        </div>
        <dl className="space-y-1.5 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Associated job</dt>
            <dd>
              {job ? (
                <Link href={`/jobs/${job.id}`} className="hover:underline">
                  {job.company} — {job.title}
                </Link>
              ) : (
                <span className="text-muted-foreground">Base document (no job)</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Template</dt>
            <dd>
              {artifact.baseTemplate}
              {meta ? <span className="text-muted-foreground"> · {meta}</span> : null}
            </dd>
          </div>
        </dl>
        {artifact.kind === "resume" && artifact.highlightedSkills.length > 0 ? (
          <ul className="flex flex-wrap gap-1" aria-label="Highlighted skills">
            {artifact.highlightedSkills.map((s) => (
              <li key={s}>
                <Badge variant="secondary">{s}</Badge>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
      <CardFooter className="border-t pt-4">
        <FutureAction reason="Downloads become available once documents are generated in a later milestone">
          <Download /> Download
        </FutureAction>
      </CardFooter>
    </Card>
  );
}
