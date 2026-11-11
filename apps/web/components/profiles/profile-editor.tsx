"use client";

import { useMemo, useState } from "react";
import { BellRing, CircleCheck, RotateCcw, Save, ShieldCheck, Zap } from "lucide-react";
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
  DURATION_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  JOB_TYPE_LABELS,
  NOTIFICATION_CADENCE_LABELS,
  PROVINCE_LABELS,
} from "@/lib/labels";
import { durationApplies, parseKeywordList, validateProfileDraft } from "@/lib/profiles/draft";
import {
  AUTOMATION_MODES,
  DISCIPLINES,
  DURATION_BUCKETS,
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

export function ProfileEditor({ initial, isNew }: { initial: SearchProfileDraft; isNew: boolean }) {
  const [draft, setDraft] = useState<SearchProfileDraft>(initial);
  const [includeText, setIncludeText] = useState(initial.criteria.titleKeywords.join(", "));
  const [excludeText, setExcludeText] = useState(initial.criteria.excludedTitleKeywords.join(", "));
  const [maxYearsText, setMaxYearsText] = useState(initial.criteria.maxYearsExperience?.toString() ?? "");
  const [showErrors, setShowErrors] = useState(false);

  const errors = useMemo(() => validateProfileDraft(draft), [draft]);
  const errorCount = Object.keys(errors).length;
  const visibleErrors = showErrors ? errors : {};
  const durationsEnabled = durationApplies(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  function setCriteria(patch: Partial<ProfileCriteria>) {
    setDraft((d) => ({ ...d, criteria: { ...d.criteria, ...patch } }));
  }

  function reset() {
    setDraft(initial);
    setIncludeText(initial.criteria.titleKeywords.join(", "));
    setExcludeText(initial.criteria.excludedTitleKeywords.join(", "));
    setMaxYearsText(initial.criteria.maxYearsExperience?.toString() ?? "");
    setShowErrors(false);
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
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </Field>
            <Field id="profile-description" label="Description">
              <Textarea
                id="profile-description"
                rows={2}
                className="field-sizing-content min-h-16"
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
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
                onCheckedChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
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
                  value={includeText}
                  placeholder="software, developer, engineer"
                  onChange={(e) => {
                    setIncludeText(e.target.value);
                    setCriteria({ titleKeywords: parseKeywordList(e.target.value) });
                  }}
                />
              </Field>
              <Field id="excluded-keywords" label="Exclude titles containing" hint="Comma-separated.">
                <Input
                  {...describedBy("excluded-keywords", undefined, true)}
                  value={excludeText}
                  placeholder="senior, staff, manager"
                  onChange={(e) => {
                    setExcludeText(e.target.value);
                    setCriteria({ excludedTitleKeywords: parseKeywordList(e.target.value) });
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
              options={optionsFrom(DURATION_BUCKETS, DURATION_LABELS)}
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
                  value={maxYearsText}
                  onChange={(e) => {
                    setMaxYearsText(e.target.value);
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
                onChange={(e) => setDraft((d) => ({ ...d, minFitScore: Number(e.target.value) }))}
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
                    setDraft((d) => ({ ...d, notifications: { ...d.notifications, enabled } }))
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
                    setDraft((d) => ({
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
                        onChange={() => setDraft((d) => ({ ...d, automationMode: mode }))}
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

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="ghost" onClick={reset} disabled={!dirty && !showErrors}>
            <RotateCcw /> Reset
          </Button>
          <Button type="submit" variant="outline">
            <CircleCheck /> Validate
          </Button>
          <FutureAction variant="default" size="default" reason="Saving profiles requires persistence, planned for a later milestone">
            <Save /> {isNew ? "Create profile" : "Save changes"}
          </FutureAction>
        </div>
      </form>

      <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
        <PreviewNotice title="Configuration preview only">
          Profiles are not saved or evaluated in this milestone. Edits reset when you leave this page.
        </PreviewNotice>
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {draft.name.trim() || "Untitled profile"}
              {dirty ? <Badge variant="warning">Unsaved</Badge> : null}
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
