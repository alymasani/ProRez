"use client";

import { useLayoutEffect, useMemo, useState } from "react";
import { Columns3, FileText, FolderGit2, Mail, Table2 } from "lucide-react";
import { ApplicationDialog } from "@/components/applications/application-dialog";
import { EmptyState } from "@/components/states";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { NativeSelect } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ApplicationRow } from "@/lib/applications/rows";
import { formatDate } from "@/lib/format";
import { MODE_LABELS, PREPARATION_STATUS, SUBMISSION_STATUS } from "@/lib/labels";
import { PREPARATION_STATUSES, SUBMISSION_STATUSES, type SubmissionStatus } from "@/lib/types";

type SubmissionFilter = SubmissionStatus | "all";

export function ApplicationsView({ rows, writable }: { rows: ApplicationRow[]; writable: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submissionFilter, setSubmissionFilter] = useState<SubmissionFilter>("all");

  // Close the dialog if this route is hidden by <Activity> during navigation.
  useLayoutEffect(() => () => setSelectedId(null), []);

  const visible = useMemo(
    () =>
      submissionFilter === "all"
        ? rows
        : rows.filter((r) => r.application.submissionStatus === submissionFilter),
    [rows, submissionFilter],
  );
  const selected = rows.find((r) => r.application.id === selectedId) ?? null;

  return (
    <>
      <Tabs defaultValue="table" className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList aria-label="Applications view">
            <TabsTrigger value="table">
              <Table2 aria-hidden="true" /> Table
            </TabsTrigger>
            <TabsTrigger value="board">
              <Columns3 aria-hidden="true" /> Board
            </TabsTrigger>
          </TabsList>
          <div className="flex items-center gap-2">
            <label htmlFor="submission-filter" className="text-sm whitespace-nowrap text-muted-foreground">
              Submission
            </label>
            <NativeSelect
              id="submission-filter"
              value={submissionFilter}
              onChange={(e) => setSubmissionFilter(e.target.value as SubmissionFilter)}
              className="w-44"
            >
              <option value="all">All statuses</option>
              {SUBMISSION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SUBMISSION_STATUS[s].label}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>

        <TabsContent value="table">
          {visible.length === 0 ? (
            <EmptyState title="No applications with this status" />
          ) : (
            <div className="rounded-xl border bg-card">
              <p className="border-b px-3 py-2 text-xs text-muted-foreground md:hidden">
                Scroll the table sideways for submission status, dates, and materials — or use the Board view.
              </p>
              <Table scrollLabel="Applications table">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Company &amp; position</TableHead>
                    <TableHead>Preparation</TableHead>
                    <TableHead>Submission</TableHead>
                    <TableHead>Applied</TableHead>
                    <TableHead>Materials</TableHead>
                    <TableHead className="min-w-48">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((row) => (
                    <TableRow key={row.application.id}>
                      <TableCell className="min-w-56">
                        <button
                          type="button"
                          onClick={() => setSelectedId(row.application.id)}
                          className="rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          <span className="block font-medium hover:underline">{row.job?.title ?? "Unknown job"}</span>
                          <span className="block text-xs text-muted-foreground">
                            {row.job?.company} · {MODE_LABELS[row.application.mode]}
                          </span>
                        </button>
                      </TableCell>
                      <TableCell>
                        <StatusBadge meta={PREPARATION_STATUS[row.application.preparationStatus]} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge meta={SUBMISSION_STATUS[row.application.submissionStatus]} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {formatDate(row.application.submittedAt)}
                      </TableCell>
                      <TableCell>
                        <MaterialIcons row={row} />
                      </TableCell>
                      <TableCell className="max-w-64 text-xs text-muted-foreground">
                        <span className="line-clamp-2">{row.application.notes || "—"}</span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="board">
          <p className="mb-3 text-xs text-muted-foreground">
            Columns show preparation status. Submission status is shown on each card. Drag-and-drop editing arrives in
            a later milestone.
          </p>
          <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
            <div className="grid auto-cols-[16rem] grid-flow-col gap-3">
              {PREPARATION_STATUSES.map((status) => {
                const cards = visible.filter((r) => r.application.preparationStatus === status);
                return (
                  <section
                    key={status}
                    aria-labelledby={`col-${status}`}
                    className="flex flex-col gap-2 rounded-xl border bg-muted/40 p-2.5"
                  >
                    <header className="flex items-center justify-between px-1">
                      <h3 id={`col-${status}`} className="text-sm font-medium">
                        {PREPARATION_STATUS[status].label}
                      </h3>
                      <Badge variant="muted">{cards.length}</Badge>
                    </header>
                    {cards.length === 0 ? (
                      <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                        Empty
                      </p>
                    ) : (
                      cards.map((row) => (
                        <button
                          key={row.application.id}
                          type="button"
                          onClick={() => setSelectedId(row.application.id)}
                          className="space-y-2 rounded-lg border bg-card p-3 text-left shadow-xs outline-none transition-colors hover:border-primary/40 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                          <div>
                            <p className="text-sm leading-snug font-medium">{row.job?.title}</p>
                            <p className="text-xs text-muted-foreground">{row.job?.company}</p>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <StatusBadge meta={SUBMISSION_STATUS[row.application.submissionStatus]} srPrefix="Submission:" />
                            <DemoBadge when={row.application.isDemo} />
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">{MODE_LABELS[row.application.mode]}</span>
                            <MaterialIcons row={row} />
                          </div>
                        </button>
                      ))
                    )}
                  </section>
                );
              })}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <ApplicationDialog row={selected} writable={writable} onOpenChange={(open) => !open && setSelectedId(null)} />
    </>
  );
}

function MaterialIcons({ row }: { row: ApplicationRow }) {
  const items = [
    { key: "resume", present: row.resume !== null, icon: FileText, label: "Resume" },
    { key: "cover", present: row.coverLetter !== null, icon: Mail, label: "Cover letter" },
    { key: "project", present: row.project !== null, icon: FolderGit2, label: "Project" },
  ];
  return (
    <ul className="flex items-center gap-1.5" aria-label="Linked materials">
      {items.map(({ key, present, icon: Icon, label }) => (
        <li key={key} title={`${label}: ${present ? "linked" : "none"}`}>
          <Icon className={present ? "size-4 text-foreground" : "size-4 text-muted-foreground/30"} aria-hidden="true" />
          <span className="sr-only">
            {label}: {present ? "linked" : "none"}
          </span>
        </li>
      ))}
    </ul>
  );
}
