"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CircleCheck, LoaderCircle, RotateCcw, Save, ShieldCheck, Zap } from "lucide-react";
import { createProfileAction, updateProfileAction } from "@/app/profiles/actions";
import { DeleteProfileButton } from "@/components/profiles/delete-profile-button";
import { CheckboxGroup, optionsFrom } from "@/components/forms/checkbox-group";
import { describedBy, Field } from "@/components/forms/field";
import { FutureAction } from "@/components/future-action";
import { ProfileSummary } from "@/components/profiles/profile-summary";
import { PreviewNotice } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ARRANGEMENT_LABELS,
  AUTOMATION_MODE_LABELS,
  DISCIPLINE_LABELS,
  DURATION_REQUIREMENT_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  JOB_TYPE_LABELS,
  NOTIFICATION_CADENCE_LABELS,
  PROVINCE_LABELS,
} from "@/lib/labels";
import { draftFromProfile, durationApplies, parseKeywordList, validateProfileDraft } from "@/lib/profiles/draft";
import {
  AUTOMATION_MODES,
  DISCIPLINES,
  SELECTABLE_DURATION_REQUIREMENTS,
  EXPERIENCE_LEVELS,
  JOB_TYPES,
  NOTIFICATION_CADENCES,
  PROVINCES,
  WORK_ARRANGEMENTS,
  type AutomationMode,
  type NotificationCadence,
  type ProfileCriteria,
  type SearchProfileDraft,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const PROVINCE_OPTIONS = PROVINCES.map((p) => ({ value: p, label: PROVINCE_LABELS[p] }));
const MODE_ICONS: Record<AutomationMode, typeof Zap> = {
  approval_required: ShieldCheck,
  quick_generate: Zap,
  notify_only: BellRing,
};

type SaveStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; message: string; warning: string | null }
  | { kind: "error"; message: string; formErrors: string[] }
  | { kind: "conflict"; message: string };

function keywordTexts(d: SearchProfileDraft) {
  return {
    title: d.criteria.titleKeywords.join(", "),
    excludedTitle: d.criteria.excludedTitleKeywords.join(", "),
    include: d.criteria.includeKeywords.join(", "),
    exclude: d.criteria.excludeKeywords.join(", "),
    maxYears: d.criteria.maxYearsExperience?.toString() ?? "",
  };
}

export interface ProfileEditorProps {
  initial: SearchProfileDraft;
  /** null when creating a new profile. */
  profileId: string | null;
  version: number | null;
  saving: { enabled: boolean; reason: string | null };
  /** Jobs whose stored matches reference this profile (delete vs archive). */
  matchCount?: number;
  justCreated?: boolean;
}

export function ProfileEditor({ initial, profileId, version: initialVersion, saving, matchCount = 0, justCreated = false }: ProfileEditorProps) {
  const router = useRouter();
  const isNew = profileId === null;
  const [baseline, setBaseline] = useState<SearchProfileDraft>(initial);
  const [draft, setDraft] = useState<SearchProfileDraft>(initial);
  const [version, setVersion] = useState(initialVersion);
  const [texts, setTexts] = useState(() => keywordTexts(initial));
  const [showErrors, setShowErrors] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<SaveStatus>(
    justCreated ? { kind: "saved", message: "Profile created and saved.", warning: null } : { kind: "idle" },
  );
  const [isPending, startTransition] = useTransition();
  const [reloadRequested, setReloadRequested] = useState(false);
  const [seenPropVersion, setSeenPropVersion] = useState(initialVersion);

  const errors = useMemo(() => validateProfileDraft(draft), [draft]);
  const errorCount = Object.keys(errors).length;
  const visibleErrors: Record<string, string | undefined> = showErrors ? { ...serverErrors, ...errors } : {};
  const durationsEnabled = durationApplies(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);

  // Fresh server data (after refresh()) replaces local state only when it is a
  // different version AND there are no unsaved edits — or the user explicitly
  // asked to load the latest after a conflict. Our own saves are already in sync.
  if (initialVersion !== seenPropVersion) {
    setSeenPropVersion(initialVersion);
    if (initialVersion !== version && (!dirty || reloadRequested)) {
      setBaseline(initial);
      setDraft(initial);
      setTexts(keywordTexts(initial));
      setVersion(initialVersion);
      setReloadRequested(false);
      setShowErrors(false);
      setServerErrors({});
      setStatus({ kind: "idle" });
    }
  }

  // Protect unsaved edits: closing/reloading the tab, and in-app link clicks.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!anchor || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const url = new URL((anchor as HTMLAnchorElement).href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm("You have unsaved changes to this profile. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  function edit(update: (d: SearchProfileDraft) => SearchProfileDraft) {
    setDraft(update);
    setServerErrors({});
    if (status.kind === "saved" || status.kind === "error") setStatus({ kind: "idle" });
  }

  function setCriteria(patch: Partial<ProfileCriteria>) {
    edit((d) => ({ ...d, criteria: { ...d.criteria, ...patch } }));
  }

  function setText(key: keyof ReturnType<typeof keywordTexts>, value: string) {
    setTexts((t) => ({ ...t, [key]: value }));
  }

  function reset() {
    setDraft(baseline);
    setTexts(keywordTexts(baseline));
    setShowErrors(false);
    setServerErrors({});
    setStatus({ kind: "idle" });
  }

  function focusFirstError() {
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("form [aria-invalid='true']")?.focus();
    });
  }

  function save() {
    setShowErrors(true);
    if (errorCount > 0) {
      setStatus({ kind: "error", message: "Please fix the highlighted fields.", formErrors: [] });
      focusFirstError();
      return;
    }
    setStatus({ kind: "saving" });
    startTransition(async () => {
      const result =
        isNew || version === null
          ? await createProfileAction(draft)
          : await updateProfileAction(profileId, version, draft);

      if (result.ok) {
        const saved = draftFromProfile(result.value.profile);
        setBaseline(saved);
        setDraft(saved);
        setTexts(keywordTexts(saved));
        setVersion(result.value.profile.version);
        setShowErrors(false);
        if (isNew) {
          router.replace(`/profiles/${result.value.profile.id}?created=1`);
          return;
        }
        setStatus({ kind: "saved", message: `Saved as version ${result.value.profile.version}.`, warning: result.value.warning });
        return;
      }
      if (result.code === "version_conflict") {
        setStatus({ kind: "conflict", message: result.message });
        return;
      }
      setServerErrors(result.fieldErrors ?? {});
      setStatus({ kind: "error", message: result.message, formErrors: result.formErrors ?? [] });
      if (result.fieldErrors && Object.keys(result.fieldErrors).length > 0) focusFirstError();
    });
  }

  function loadLatest() {
    // Discards local edits once the latest stored version arrives.
    setReloadRequested(true);
    router.refresh();
  }

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_22rem]">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setShowErrors(true);
        }}
        className="min-w-0 space-y-6"
      >
        <Card>
          <CardHeader>
            <CardTitle>Basics</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field id="profile-name" label="Profile name" required error={visibleErrors.name}>
              <Input
                {...describedBy("profile-name", visibleErrors.name)}
                value={draft.name}
                maxLength={80}
                placeholder="e.g. Four-month SWE co-ops"
                onChange={(e) => edit((d) => ({ ...d, name: e.target.value }))}
              />
            </Field>
            <Field id="profile-description" label="Description" error={visibleErrors.description}>
              <Textarea
                {...describedBy("profile-description", visibleErrors.description)}
                rows={2}
                className="field-sizing-content min-h-16"
                value={draft.description}
                onChange={(e) => edit((d) => ({ ...d, description: e.target.value }))}
              />
            </Field>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <label htmlFor="profile-enabled" className="cursor-pointer text-sm font-medium">
                  Enabled
                </label>
                <p className="text-xs text-muted-foreground">
                  Any number of profiles can be enabled at once. A job matching several is still reported once.
                </p>
              </div>
              <Switch
                id="profile-enabled"
                checked={draft.enabled}
                onCheckedChange={(enabled) => edit((d) => ({ ...d, enabled }))}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Target roles</CardTitle>
            <CardDescription>Job titles and software specialties this profile looks for.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Field
                id="title-keywords"
                label="Title keywords"
                hint="Comma-separated. Any one may match."
                error={visibleErrors.titleKeywords}
              >
                <Input
                  {...describedBy("title-keywords", visibleErrors.titleKeywords, true)}
                  value={texts.title}
                  placeholder="software, developer, engineer"
                  onChange={(e) => {
                    setText("title", e.target.value);
                    setCriteria({ titleKeywords: parseKeywordList(e.target.value) });
                  }}
                />
              </Field>
              <Field
                id="excluded-keywords"
                label="Exclude titles containing"
                hint="Comma-separated."
                error={visibleErrors.excludedTitleKeywords}
              >
                <Input
                  {...describedBy("excluded-keywords", visibleErrors.excludedTitleKeywords, true)}
                  value={texts.excludedTitle}
                  placeholder="senior, staff, manager"
                  onChange={(e) => {
                    setText("excludedTitle", e.target.value);
                    setCriteria({ excludedTitleKeywords: parseKeywordList(e.target.value) });
                  }}
                />
              </Field>
              <Field
                id="include-keywords"
                label="Preferred keywords"
                hint="Anywhere in the posting. Raise relevance only — never exclude a job."
                error={visibleErrors.includeKeywords}
              >
                <Input
                  {...describedBy("include-keywords", visibleErrors.includeKeywords, true)}
                  value={texts.include}
                  placeholder="typescript, distributed systems"
                  onChange={(e) => {
                    setText("include", e.target.value);
                    setCriteria({ includeKeywords: parseKeywordList(e.target.value) });
                  }}
                />
              </Field>
              <Field
                id="exclude-keywords"
                label="Exclude postings mentioning"
                hint="Anywhere in the posting, e.g. security clearance."
                error={visibleErrors.excludeKeywords}
              >
                <Input
                  {...describedBy("exclude-keywords", visibleErrors.excludeKeywords, true)}
                  value={texts.exclude}
                  placeholder="security clearance, us citizenship"
                  onChange={(e) => {
                    setText("exclude", e.target.value);
                    setCriteria({ excludeKeywords: parseKeywordList(e.target.value) });
                  }}
                />
              </Field>
            </div>
            <CheckboxGroup
              legend="Software specialties"
              description="Leave empty to accept any specialty."
              options={optionsFrom(DISCIPLINES, DISCIPLINE_LABELS)}
              value={draft.criteria.disciplines}
              onChange={(disciplines) => setCriteria({ disciplines })}
              columns={3}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Employment &amp; experience</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <CheckboxGroup
              legend="Employment types"
              options={optionsFrom(JOB_TYPES, JOB_TYPE_LABELS)}
              value={draft.criteria.jobTypes}
              onChange={(jobTypes) => setCriteria({ jobTypes })}
              error={visibleErrors.jobTypes}
            />
            <CheckboxGroup
              legend="Internship duration"
              description={durationsEnabled ? "Leave empty for any length." : "Only applies to internships and co-ops."}
              options={SELECTABLE_DURATION_REQUIREMENTS.map((value) => ({ value, label: DURATION_REQUIREMENT_LABELS[value].label }))}
              value={draft.criteria.durations}
              onChange={(durations) => setCriteria({ durations })}
              disabled={!durationsEnabled && draft.criteria.durations.length === 0}
              error={visibleErrors.durations}
            />
            <div className="space-y-4">
              <CheckboxGroup
                legend="Experience level"
                options={optionsFrom(EXPERIENCE_LEVELS, EXPERIENCE_LEVEL_LABELS)}
                value={draft.criteria.experienceLevels}
                onChange={(experienceLevels) => setCriteria({ experienceLevels })}
              />
              <Field
                id="max-years"
                label="Max years required"
                hint="Skip postings asking for more."
                error={visibleErrors.maxYearsExperience}
              >
                <Input
                  {...describedBy("max-years", visibleErrors.maxYearsExperience, true)}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={15}
                  placeholder="No limit"
                  value={texts.maxYears}
                  onChange={(e) => {
                    setText("maxYears", e.target.value);
                    const raw = e.target.value.trim();
                    setCriteria({ maxYearsExperience: raw === "" ? null : Number(raw) });
                  }}
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Location &amp; remote work</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <CheckboxGroup
              legend="Provinces and territories"
              description="Leave empty to search all of Canada."
              options={PROVINCE_OPTIONS}
              value={draft.criteria.provinces}
              onChange={(provinces) => setCriteria({ provinces })}
              columns={3}
            />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <CheckboxGroup
                legend="Work arrangement"
                options={optionsFrom(WORK_ARRANGEMENTS, ARRANGEMENT_LABELS)}
                value={draft.criteria.arrangements}
                onChange={(arrangements) => setCriteria({ arrangements })}
              />
              <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                <div>
                  <label htmlFor="remote-canada" className="cursor-pointer text-sm font-medium">
                    Include remote roles anywhere in Canada
                  </label>
                  <p className="text-xs text-muted-foreground">Remote postings match even outside selected provinces.</p>
                </div>
                <Switch
                  id="remote-canada"
                  checked={draft.criteria.includeRemoteCanadaWide}
                  onCheckedChange={(includeRemoteCanadaWide) => setCriteria({ includeRemoteCanadaWide })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Matching &amp; notifications</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <Field
              id="min-fit"
              label={`Minimum candidate-fit score: ${draft.minFitScore}`}
              required
              hint="Jobs scoring below this are not surfaced for this profile."
              error={visibleErrors.minFitScore}
            >
              <input
                {...describedBy("min-fit", visibleErrors.minFitScore, true)}
                type="range"
                min={0}
                max={100}
                step={5}
                value={draft.minFitScore}
                onChange={(e) => edit((d) => ({ ...d, minFitScore: Number(e.target.value) }))}
                className="w-full accent-[var(--primary)]"
              />
            </Field>
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <label htmlFor="notify-enabled" className="cursor-pointer text-sm font-medium">
                    Telegram notifications
                  </label>
                  <p className="text-xs text-muted-foreground">Telegram is not connected yet.</p>
                </div>
                <Switch
                  id="notify-enabled"
                  checked={draft.notifications.enabled}
                  onCheckedChange={(enabled) =>
                    edit((d) => ({ ...d, notifications: { ...d.notifications, enabled } }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="notify-cadence" className="text-sm font-medium">
                  Cadence
                </label>
                <NativeSelect
                  id="notify-cadence"
                  disabled={!draft.notifications.enabled}
                  value={draft.notifications.cadence}
                  onChange={(e) =>
                    edit((d) => ({
                      ...d,
                      notifications: { ...d.notifications, cadence: e.target.value as NotificationCadence },
                    }))
                  }
                >
                  {NOTIFICATION_CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {NOTIFICATION_CADENCE_LABELS[c]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Automation mode</CardTitle>
            <CardDescription>
              What happens when a job matches. ProRez never submits an application for you.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <fieldset>
              <legend className="sr-only">Automation mode</legend>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {AUTOMATION_MODES.map((mode) => {
                  const Icon = MODE_ICONS[mode];
                  const meta = AUTOMATION_MODE_LABELS[mode];
                  return (
                    <label
                      key={mode}
                      className={cn(
                        "flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                        draft.automationMode === mode ? "border-primary bg-primary/5" : "hover:bg-muted/50",
                      )}
                    >
                      <input
                        type="radio"
                        name="automation-mode"
                        value={mode}
                        checked={draft.automationMode === mode}
                        onChange={() => edit((d) => ({ ...d, automationMode: mode }))}
                        className="mt-1 size-4 shrink-0 self-start accent-[var(--primary)]"
                      />
                      <span>
                        <span className="flex items-center gap-1.5 text-sm font-medium">
                          <Icon className="size-4 text-primary" aria-hidden="true" />
                          {meta.label}
                        </span>
                        <span className="text-xs text-muted-foreground">{meta.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </CardContent>
        </Card>

        <SaveStatusMessage status={status} onLoadLatest={loadLatest} />

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {!isNew && saving.enabled && profileId ? (
            <DeleteProfileButton
              profileId={profileId}
              profileName={baseline.name}
              matchCount={matchCount}
              onDone={() => {
                setBaseline(draft); // nothing left to protect
                router.push("/profiles");
              }}
              className="sm:mr-auto"
            />
          ) : null}
          <Button type="button" variant="ghost" onClick={reset} disabled={(!dirty && !showErrors) || isPending}>
            <RotateCcw /> Reset
          </Button>
          <Button type="submit" variant="outline" disabled={isPending}>
            <CircleCheck /> Validate
          </Button>
          {saving.enabled ? (
            <Button type="button" onClick={save} disabled={isPending || (!dirty && !isNew)}>
              {isPending ? <LoaderCircle className="animate-spin" /> : <Save />}
              {isPending ? "Saving…" : isNew ? "Create profile" : "Save changes"}
            </Button>
          ) : (
            <FutureAction variant="default" size="default" reason={saving.reason ?? "Saving is unavailable"}>
              <Save /> {isNew ? "Create profile" : "Save changes"}
            </FutureAction>
          )}
        </div>
      </form>

      <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        {saving.enabled ? null : (
          <PreviewNotice title="Read-only demo data">
            {saving.reason} Edits here are a local preview and reset when you leave this page.
          </PreviewNotice>
        )}
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {draft.name.trim() || "Untitled profile"}
              {dirty ? <Badge variant="warning">Unsaved</Badge> : null}
              {!isNew && version !== null ? <Badge variant="muted">v{version}</Badge> : null}
            </CardTitle>
            <CardDescription aria-live="polite">
              {showErrors ? (
                errorCount === 0 ? (
                  <span className="text-emerald-700 dark:text-emerald-400">Configuration is valid.</span>
                ) : (
                  <span className="text-destructive">
                    {errorCount} issue{errorCount === 1 ? "" : "s"} to fix.
                  </span>
                )
              ) : (
                "Live summary"
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileSummary draft={draft} />
          </CardContent>
        </Card>
      </aside>
    </div>
  );
}

function SaveStatusMessage({ status, onLoadLatest }: { status: SaveStatus; onLoadLatest: () => void }) {
  return (
    <div role="status" aria-live="polite" className="min-h-0">
      {status.kind === "saving" ? (
        <p className="text-sm text-muted-foreground">Saving…</p>
      ) : status.kind === "saved" ? (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-800 dark:text-emerald-300">
          <p className="font-medium">{status.message}</p>
          {status.warning ? <p className="mt-1 text-amber-700 dark:text-amber-300">{status.warning}</p> : null}
        </div>
      ) : status.kind === "error" ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <p className="font-medium">{status.message}</p>
          {status.formErrors.length > 0 ? (
            <ul className="mt-1 list-disc pl-5">
              {status.formErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : status.kind === "conflict" ? (
        <div role="alert" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-200">{status.message}</p>
          <p className="text-amber-900/80 dark:text-amber-200/80">
            Your edits are still here. Copy anything you need, then load the latest version.
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onLoadLatest}>
            Discard my edits and load latest
          </Button>
        </div>
      ) : null}
    </div>
  );
}
