"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Building, LoaderCircle, Plus, Trash2, WandSparkles } from "lucide-react";
import { createBoardAction, deleteBoardAction, setBoardEnabledAction } from "@/app/boards/actions";
import { describedBy, Field } from "@/components/forms/field";
import { FutureAction } from "@/components/future-action";
import { EmptyState, PreviewNotice } from "@/components/states";
import { DemoBadge, StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canonicalBoardUrl, isValidBoardToken, parseBoardUrl } from "@/lib/boards/board-url";
import { BOARD_HEALTH, boardHealth, formatPollInterval } from "@/lib/boards/health";
import { POLL_INTERVAL } from "@/lib/boards/schema";
import { formatDateTime } from "@/lib/format";
import { SOURCE_PROVIDER_LABELS } from "@/lib/labels";
import { ATS_PROVIDERS, type AtsProvider, type EmployerBoard } from "@/lib/types";

const POLL_OPTIONS = [60, 180, 360, 720, 1440];

type Notice = { tone: "success" | "error"; text: string } | null;

const EMPTY_FORM: { url: string; provider: AtsProvider; employerName: string; boardToken: string; pollIntervalMinutes: number } = {
  url: "",
  provider: "greenhouse",
  employerName: "",
  boardToken: "",
  pollIntervalMinutes: POLL_INTERVAL.default,
};

export function BoardsManager({
  boards,
  saving,
}: {
  boards: EmployerBoard[];
  saving: { enabled: boolean; reason: string | null };
}) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<Notice>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [urlHint, setUrlHint] = useState<string | null>(null);

  const token = form.boardToken.trim().toLowerCase();
  const preview = token && isValidBoardToken(token) ? canonicalBoardUrl(form.provider, token) : null;

  function fillFromUrl() {
    const parsed = parseBoardUrl(form.url);
    if (!parsed) {
      setUrlHint("That doesn't look like a Greenhouse, Lever, Ashby or SmartRecruiters board URL.");
      return;
    }
    setUrlHint(`Detected ${SOURCE_PROVIDER_LABELS[parsed.provider]} board “${parsed.boardToken}”.`);
    setForm((f) => ({ ...f, provider: parsed.provider, boardToken: parsed.boardToken }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice(null);
    setFieldErrors({});
    startTransition(async () => {
      const { url: _url, ...fields } = form;
      void _url;
      // New boards start enabled; they can be paused from the table.
      const result = await createBoardAction({ ...fields, enabled: true });
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
            Each employer&apos;s public board on a supported ATS. ProRez does not poll boards yet, so nothing has been checked.
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
                    <TableHead>Polling</TableHead>
                    <TableHead>Last check</TableHead>
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
                          </div>
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
                          {board.lastErrorMessage ? (
                            <p className="mt-1 text-xs text-destructive">
                              {board.consecutiveFailures} failure{board.consecutiveFailures === 1 ? "" : "s"}: {board.lastErrorMessage}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap text-muted-foreground">
                          {formatPollInterval(board.pollIntervalMinutes)}
                        </TableCell>
                        <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                          <div>Checked: {board.lastCheckedAt ? formatDateTime(board.lastCheckedAt) : "never"}</div>
                          <div>Succeeded: {board.lastSuccessAt ? formatDateTime(board.lastSuccessAt) : "never"}</div>
                        </TableCell>
                        <TableCell className="text-right">
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
                <FutureAction variant="default" size="default" reason={saving.reason ?? undefined}>
                  <Plus /> Register board
                </FutureAction>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
