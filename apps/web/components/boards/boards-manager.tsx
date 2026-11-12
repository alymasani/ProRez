"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Building, LoaderCircle, Plus, RefreshCw, Trash2, WandSparkles } from "lucide-react";
import { createBoardAction, deleteBoardAction, setBoardEnabledAction, syncBoardAction } from "@/app/boards/actions";
import { describedBy, Field } from "@/components/forms/field";
import { EmptyState, PreviewNotice } from "@/components/states";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canonicalBoardUrl, isValidBoardToken, parseBoardUrl } from "@/lib/boards/board-url";
import { BOARD_HEALTH, boardHealth, boardSyncState, formatPollInterval, type BoardSyncState } from "@/lib/boards/health";
import type { StatusMeta } from "@/lib/labels";
import { POLL_INTERVAL } from "@/lib/boards/schema";
import { formatDateTime } from "@/lib/format";
import { SOURCE_PROVIDER_LABELS } from "@/lib/labels";
import { ATS_PROVIDERS, type AtsProvider, type BoardSyncRun, type EmployerBoard } from "@/lib/types";

const POLL_OPTIONS = [60, 180, 360, 720, 1440];

type Notice = { tone: "success" | "error"; text: string } | null;

const EMPTY_FORM: { url: string; provider: AtsProvider; employerName: string; boardToken: string; pollIntervalMinutes: number; region: "eu" | null } = {
  url: "",
  provider: "greenhouse",
  employerName: "",
  boardToken: "",
  pollIntervalMinutes: POLL_INTERVAL.default,
  region: null,
};

export function BoardsManager({
  boards,
  runs = [],
  saving,
}: {
  boards: EmployerBoard[];
  runs?: BoardSyncRun[];
  saving: { enabled: boolean; reason: string | null };
}) {
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const latestRun = (boardId: string) => runs.find((r) => r.boardId === boardId) ?? null;
  const boardName = (boardId: string) => {
    const b = boards.find((x) => x.id === boardId);
    return b ? `${b.employerName} (${SOURCE_PROVIDER_LABELS[b.provider]})` : "Removed board";
  };

  async function sync(board: EmployerBoard) {
    setSyncingId(board.id);
    setNotice(null);
    try {
      const result = await syncBoardAction(board.id);
      if (!result.ok) {
        setNotice({ tone: "error", text: result.message });
      } else if (result.value.status === "failed") {
        setNotice({ tone: "error", text: `Sync of ${board.employerName} failed: ${result.value.errorMessage ?? "unknown error"} Imported postings were kept; you can retry.` });
      } else {
        const v = result.value;
        const counts = `${v.fetched} published, ${v.eligible} eligible, ${v.created} new, ${v.updated} changed, ${v.unchanged} unchanged, ${v.reactivated} reactivated, ${v.duplicate} already known, ${v.missing} missing, ${v.closed} inactivated; not imported: ${v.filteredLocation} outside Canada, ${v.filteredEmploymentType} not entry-level${v.errorCount ? `, ${v.errorCount} errors` : ""}`;
        setNotice(
          v.status === "partial"
            ? { tone: "error", text: `Synced ${board.employerName} partially: ${counts}. ${v.errorMessage ?? ""}`.trim() }
            : { tone: "success", text: `Synced ${board.employerName}: ${counts}.` },
        );
      }
    } catch {
      setNotice({ tone: "error", text: "The sync request failed. Nothing was lost; please retry." });
    } finally {
      setSyncingId(null);
    }
  }

  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [urlHint, setUrlHint] = useState<string | null>(null);

  const token = form.boardToken.trim().toLowerCase();
  const region = form.provider === "lever" ? form.region : null;
  const preview = token && isValidBoardToken(token) ? canonicalBoardUrl(form.provider, token, region) : null;

  function fillFromUrl() {
    const parsed = parseBoardUrl(form.url);
    if (!parsed) {
      setUrlHint("That doesn't look like a Greenhouse, Lever, Ashby or SmartRecruiters board URL.");
      return;
    }
    setUrlHint(`Detected ${SOURCE_PROVIDER_LABELS[parsed.provider]}${parsed.region ? " (EU region)" : ""} board “${parsed.boardToken}”.`);
    setForm((f) => ({ ...f, provider: parsed.provider, boardToken: parsed.boardToken, region: parsed.region ?? null }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setFieldErrors({});
    startTransition(async () => {
      const { url: _url, ...fields } = form;
      void _url;
      // New boards start enabled; they can be paused from the table.
      const result = await createBoardAction({ ...fields, region: fields.provider === "lever" ? fields.region : null, enabled: true });
      if (result.ok) {
        setForm(EMPTY_FORM);
        setUrlHint(null);
        setNotice({ tone: "success", text: `Registered ${result.value.employerName} (${SOURCE_PROVIDER_LABELS[result.value.provider]}).` });
      } else {
        setFieldErrors(result.fieldErrors ?? {});
        setNotice({ tone: "error", text: [result.message, ...(result.formErrors ?? [])].join(" ") });
      }
    });
  }

  function toggle(board: EmployerBoard, enabled: boolean) {
    setPendingId(board.id);
    startTransition(async () => {
      const result = await setBoardEnabledAction(board.id, enabled);
      setPendingId(null);
      setNotice(result.ok ? null : { tone: "error", text: result.message });
    });
  }

  function remove(board: EmployerBoard) {
    if (!window.confirm(`Remove ${board.employerName} (${SOURCE_PROVIDER_LABELS[board.provider]}) from the registry?`)) return;
    setPendingId(board.id);
    startTransition(async () => {
      const result = await deleteBoardAction(board.id);
      setPendingId(null);
      setNotice(result.ok ? { tone: "success", text: `Removed ${board.employerName}.` } : { tone: "error", text: result.message });
    });
  }

  return (
    <div className="space-y-6">
      {saving.enabled ? null : <PreviewNotice title="Read-only demo boards">{saving.reason}</PreviewNotice>}

      {notice ? (
        <p
          role={notice.tone === "error" ? "alert" : "status"}
          className={
            notice.tone === "error"
              ? "rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              : "rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-800 dark:text-emerald-300"
          }
        >
          {notice.text}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Registered boards</CardTitle>
          <CardDescription>
            Each employer&apos;s public board on a supported ATS. Enabled boards are synced automatically by the
            background worker (<code className="text-xs">npm run worker</code>) at their check interval;{" "}
            <span className="font-medium">Sync now</span> runs one immediately. Only Canadian internship, co-op,
            new-grad and junior postings are imported.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {boards.length === 0 ? (
            <EmptyState icon={Building} title="No boards registered" description="Add an employer's board below." />
          ) : (
            <div className="rounded-lg border">
              <Table scrollLabel="Employer boards table">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Employer</TableHead>
                    <TableHead>Board</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last sync</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {boards.map((board) => {
                    const health = boardHealth(board);
                    const switchId = `board-enabled-${board.id}`;
                    return (
                      <TableRow key={board.id}>
                        <TableCell className="min-w-44">
                          <div className="flex flex-wrap items-center gap-1.5 font-medium">
                            {board.employerName}
                            <DemoBadge when={board.isDemo} />
                            {board.origin === "discovered" ? <Badge variant="info">Discovered</Badge> : null}
                            {board.region === "eu" ? <Badge variant="outline">EU</Badge> : null}
                          </div>
                          {board.companyDomain ? <div className="text-xs text-muted-foreground">Verified site: {board.companyDomain}</div> : null}
                          <div className="text-xs text-muted-foreground">{SOURCE_PROVIDER_LABELS[board.provider]}</div>
                        </TableCell>
                        <TableCell className="min-w-56">
                          <div className="font-mono text-xs">{board.boardToken}</div>
                          <div className="font-mono text-xs break-all text-muted-foreground">{board.boardUrl}</div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch
                              id={switchId}
                              checked={board.enabled}
                              disabled={!saving.enabled || pendingId === board.id}
                              onCheckedChange={(checked) => toggle(board, checked)}
                              aria-label={`${board.employerName} ${SOURCE_PROVIDER_LABELS[board.provider]} enabled`}
                            />
                            <StatusBadge meta={BOARD_HEALTH[health]} srPrefix="Health:" />
                          </div>
                          <div className="mt-1">
                            <StatusBadge meta={SYNC_STATE[boardSyncState({ ...board, running: board.syncing })]} srPrefix="Automatic sync:" />
                          </div>
                          {board.lastErrorMessage ? (
                            board.lastErrorCode === "incomplete" ? (
                              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Last sync incomplete: {board.lastErrorMessage}</p>
                            ) : (
                              <p className="mt-1 text-xs text-destructive">
                                {board.consecutiveFailures} failure{board.consecutiveFailures === 1 ? "" : "s"}: {board.lastErrorMessage}
                              </p>
                            )
                          ) : null}
                        </TableCell>
                        <TableCell className="min-w-48 text-xs text-muted-foreground">
                          <RunSummary run={latestRun(board.id)} />
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                          <div>
                            Next sync:{" "}
                            {board.syncing
                              ? "running now"
                              : board.nextSyncAt
                                ? <time dateTime={board.nextSyncAt}>{formatDateTime(board.nextSyncAt)}</time>
                                : nextSyncReason(board)}
                          </div>
                          <div>Last success: {board.lastSuccessAt ? formatDateTime(board.lastSuccessAt) : "never"}</div>
                          <div>Last checked: {board.lastCheckedAt ? formatDateTime(board.lastCheckedAt) : "never"}</div>
                          <div>
                            Active jobs: <span className="font-medium text-foreground">{board.activeJobCount}</span> ·{" "}
                            {formatPollInterval(board.pollIntervalMinutes)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          {saving.enabled ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={!board.enabled || syncingId !== null}
                              onClick={() => void sync(board)}
                              aria-label={`Sync ${board.employerName} ${SOURCE_PROVIDER_LABELS[board.provider]} board now`}
                              title={board.enabled ? undefined : "Enable the board to sync it"}
                            >
                              {syncingId === board.id ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                              {syncingId === board.id ? "Syncing…" : "Sync now"}
                            </Button>
                          ) : null}
                          {saving.enabled ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              disabled={pendingId === board.id}
                              onClick={() => remove(board)}
                              aria-label={`Remove ${board.employerName} ${SOURCE_PROVIDER_LABELS[board.provider]} board`}
                            >
                              <Trash2 />
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {runs.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Sync history</CardTitle>
            <CardDescription>
              Recent manual and automatic syncs. Skipped postings are outside Canada or not entry-level roles. A posting is
              marked inactive only after two consecutive complete syncs no longer list it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border text-sm" aria-label="Sync history">
              {runs.map((run) => (
                <li key={run.id} className="space-y-1 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{boardName(run.boardId)}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(run.startedAt)}</span>
                  </div>
                  <RunSummary run={run} />
                  {run.details.length > 0 ? (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">Skipped, warning and error details ({run.details.length})</summary>
                      <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-auto pl-5">
                        {run.details.map((d, i) => (
                          <li key={`${d.postingId}-${i}`}>
                            {d.kind === "error" ? "Error" : d.kind === "warning" ? "Warning" : "Skipped"}
                            {d.postingId ? ` ${d.postingId}` : ""}: {d.message}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Add a board</CardTitle>
          <CardDescription>Paste a board URL to fill in the details, or enter them directly.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} noValidate className="space-y-4">
            <fieldset disabled={!saving.enabled || isPending} className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field id="board-url" label="Board URL" hint={urlHint ?? "e.g. https://job-boards.greenhouse.io/yourcompany"}>
                    <Input
                      {...describedBy("board-url", undefined, true)}
                      type="url"
                      value={form.url}
                      onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                    />
                  </Field>
                </div>
                <Button type="button" variant="outline" onClick={fillFromUrl} disabled={!form.url.trim()} className="sm:mb-5">
                  <WandSparkles /> Fill from URL
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="board-provider" label="Provider" required error={fieldErrors.provider}>
                  <NativeSelect
                    {...describedBy("board-provider", fieldErrors.provider)}
                    value={form.provider}
                    onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value as AtsProvider }))}
                  >
                    {ATS_PROVIDERS.map((p) => (
                      <option key={p} value={p}>
                        {SOURCE_PROVIDER_LABELS[p]}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="board-employer" label="Employer name" required error={fieldErrors.employerName}>
                  <Input
                    {...describedBy("board-employer", fieldErrors.employerName)}
                    value={form.employerName}
                    onChange={(e) => setForm((f) => ({ ...f, employerName: e.target.value }))}
                  />
                </Field>
                <Field
                  id="board-token"
                  label="Board identifier"
                  required
                  hint={preview ? `Canonical URL: ${preview}` : "The part of the board URL after the domain."}
                  error={fieldErrors.boardToken}
                >
                  <Input
                    {...describedBy("board-token", fieldErrors.boardToken, true)}
                    value={form.boardToken}
                    autoCapitalize="none"
                    spellCheck={false}
                    onChange={(e) => setForm((f) => ({ ...f, boardToken: e.target.value }))}
                  />
                </Field>
                <Field id="board-poll" label="Check every" required error={fieldErrors.pollIntervalMinutes}>
                  <NativeSelect
                    {...describedBy("board-poll", fieldErrors.pollIntervalMinutes)}
                    value={form.pollIntervalMinutes}
                    onChange={(e) => setForm((f) => ({ ...f, pollIntervalMinutes: Number(e.target.value) }))}
                  >
                    {POLL_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {formatPollInterval(m).replace("every ", "")}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </fieldset>
            <div className="flex justify-end">
              {saving.enabled ? (
                <Button type="submit" disabled={isPending}>
                  {isPending ? <LoaderCircle className="animate-spin" /> : <Plus />}
                  {isPending ? "Saving…" : "Register board"}
                </Button>
              ) : (
                // Saving is switched off by configuration (fixture mode or local
                // mutations disabled) — not an unbuilt feature, so no "Soon" badge.
                <Button type="button" disabled title={saving.reason ?? undefined}>
                  <Plus /> Register board
                  <span className="sr-only">({saving.reason})</span>
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const RUN_STATUS: Record<Exclude<BoardSyncRun["status"], "running">, StatusMeta> = {
  succeeded: { label: "Succeeded", tone: "success" },
  partial: { label: "Partial", tone: "warning" },
  failed: { label: "Failed", tone: "danger" },
  skipped: { label: "Skipped", tone: "muted" },
};

const SYNC_STATE: Record<BoardSyncState, StatusMeta> = {
  scheduled: { label: "Scheduled", tone: "success" },
  running: { label: "Syncing", tone: "neutral" },
  retrying: { label: "Retrying", tone: "warning" },
  paused: { label: "Paused — needs attention", tone: "danger" },
  disabled: { label: "Not scheduled", tone: "muted" },
  demo: { label: "Demo — not scheduled", tone: "muted" },
};

function nextSyncReason(board: EmployerBoard): string {
  if (!board.enabled) return "not scheduled (disabled)";
  if (board.isDemo) return "never (demo board)";
  return "paused — fix the board, then disable and re-enable it or sync now";
}

function RunSummary({ run }: { run: BoardSyncRun | null }) {
  if (!run) return <span>Never synced</span>;
  if (run.status === "running") return <span>Sync in progress ({run.trigger === "scheduled" ? "automatic" : "manual"})…</span>;
  const duration = run.durationMs !== null ? `${(run.durationMs / 1000).toFixed(1)} s` : "";
  return (
    <div className="space-y-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <StatusBadge meta={RUN_STATUS[run.status]} srPrefix="Last sync:" />
        <span>{run.trigger === "scheduled" ? "Automatic" : "Manual"}</span>
      </div>
      {run.status === "skipped" ? null : (
        <>
          <div>
            {run.fetched} published · {run.eligible} eligible · {run.created} new · {run.updated} changed · {run.unchanged} unchanged
            {run.reactivated > 0 ? ` · ${run.reactivated} reactivated` : ""}
            {run.duplicate > 0 ? ` · ${run.duplicate} already known` : ""}
            {run.missing > 0 ? ` · ${run.missing} missing` : ""} · {run.closed} inactivated
            {run.errorCount > 0 ? ` · ${run.errorCount} error${run.errorCount === 1 ? "" : "s"}` : ""}
            {duration ? ` · ${duration}` : ""}
          </div>
          {run.skipped > 0 || run.invalid > 0 || run.enrichmentIncomplete > 0 ? (
            <div>
              Not imported: {run.filteredLocation} outside Canada · {run.filteredEmploymentType} not entry-level
              {run.invalid > 0 ? ` · ${run.invalid} unreadable` : ""}
              {run.enrichmentIncomplete > 0 ? ` · ${run.enrichmentIncomplete} with incomplete descriptions` : ""}
            </div>
          ) : null}
        </>
      )}
      {run.errorMessage ? <div className={run.status === "failed" ? "text-destructive" : "text-amber-700 dark:text-amber-300"}>{run.errorMessage}</div> : null}
    </div>
  );
}
