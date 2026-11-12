"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bot, MessageCircle, RotateCcw, Save } from "lucide-react";
import { CheckboxGroup, optionsFrom } from "@/components/forms/checkbox-group";
import { saveSettingsAction } from "@/app/settings/actions";
import { FutureAction } from "@/components/future-action";
import { PreviewNotice } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { NativeSelect } from "@/components/ui/input";
import {
  ARRANGEMENT_LABELS,
  DISCIPLINE_LABELS,
  DURATION_REQUIREMENT_LABELS,
  INTEGRATION_STATUS,
  JOB_TYPE_LABELS,
  PROVINCE_LABELS,
  SOURCE_PROVIDER_LABELS,
} from "@/lib/labels";
import {
  DISCIPLINES,
  SELECTABLE_DURATION_REQUIREMENTS,
  JOB_TYPES,
  PROVINCES,
  WORK_ARRANGEMENTS,
  type JobSource,
  type AppSettings,
  type SearchPreferences,
} from "@/lib/types";

const PROVINCE_OPTIONS = PROVINCES.map((p) => ({ value: p, label: PROVINCE_LABELS[p] }));

export function SettingsForm({
  initialSettings,
  initialSources,
}: {
  initialSettings: AppSettings;
  initialSources: JobSource[];
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [baseline, setBaseline] = useState(initialSettings);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const prefs = settings.search;
  const [sourceEnabled, setSourceEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialSources.map((s) => [s.id, s.enabled])),
  );
  const [sourceBaseline, setSourceBaseline] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialSources.map((s) => [s.id, s.enabled])),
  );

  const dirty = JSON.stringify(settings) !== JSON.stringify(baseline) ||
    Object.keys(sourceEnabled).some((id) => sourceEnabled[id] !== sourceBaseline[id]);

  function patch(next: Partial<SearchPreferences>) {
    setSettings((s) => ({ ...s, search: { ...s.search, ...next } }));
  }

  function reset() {
    setSettings(initialSettings);
    setSourceEnabled(sourceBaseline);
  }

  function save() {
    startTransition(async () => {
      const result = await saveSettingsAction(settings.version, {
        search: settings.search,
        notifications: settings.notifications,
        workflow: settings.workflow,
        sources: sourceEnabled,
      });
      if (result.ok) { setSettings(result.value); setBaseline(result.value); setSourceBaseline({ ...sourceEnabled }); setMessage("Settings saved."); }
      else setMessage(result.message);
    });
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-14 z-20 -mx-4 flex flex-col gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:top-0 lg:mx-0 lg:rounded-xl lg:border lg:px-4">
        <p className="text-sm" aria-live="polite">
          {message ? <span>{message}</span> : dirty ? (
            <span className="flex items-center gap-2">
              <Badge variant="warning">Unsaved</Badge>
              Changes have not been saved.
            </span>
          ) : (
            <span className="text-muted-foreground">Showing demo defaults.</span>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={reset} disabled={!dirty}>
            <RotateCcw /> Reset
          </Button>
          <Button size="sm" onClick={save} disabled={!dirty || pending}><Save />{pending ? "Saving…" : "Save"}</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Default search preferences</CardTitle>
          <CardDescription>
            Global defaults for discovery. Each{" "}
            <Link href="/profiles" className="text-primary hover:underline">
              search profile
            </Link>{" "}
            can override these with its own criteria.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <CheckboxGroup
            legend="Canadian locations"
            description="Provinces and territories to search."
            options={PROVINCE_OPTIONS}
            value={prefs.provinces}
            onChange={(provinces) => patch({ provinces })}
            columns={3}
          />
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
            <CheckboxGroup
              legend="Work arrangement"
              options={optionsFrom(WORK_ARRANGEMENTS, ARRANGEMENT_LABELS)}
              value={prefs.arrangements}
              onChange={(arrangements) => patch({ arrangements })}
            />
            <CheckboxGroup
              legend="Desired job types"
              options={optionsFrom(JOB_TYPES, JOB_TYPE_LABELS)}
              value={prefs.jobTypes}
              onChange={(jobTypes) => patch({ jobTypes })}
            />
            <CheckboxGroup
              legend="Internship durations"
              options={SELECTABLE_DURATION_REQUIREMENTS.map((value) => ({ value, label: DURATION_REQUIREMENT_LABELS[value].label }))}
              value={prefs.durations}
              onChange={(durations) => patch({ durations })}
            />
          </div>
          <CheckboxGroup
            legend="Software disciplines"
            options={optionsFrom(DISCIPLINES, DISCIPLINE_LABELS)}
            value={prefs.disciplines}
            onChange={(disciplines) => patch({ disciplines })}
            columns={3}
          />
          <label className="flex max-w-lg items-center justify-between gap-4 rounded-lg border p-3 text-sm">
            Include remote roles anywhere in Canada
            <Switch checked={prefs.includeRemoteCanadaWide} onCheckedChange={(includeRemoteCanadaWide) => patch({ includeRemoteCanadaWide })} />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Notifications and workflow</CardTitle><CardDescription>Defaults for new profiles and applications.</CardDescription></CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-3">
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">Pause notifications<Switch checked={settings.notifications.paused} onCheckedChange={(paused) => setSettings((s) => ({ ...s, notifications: { ...s.notifications, paused } }))} /></label>
          <label className="space-y-1 text-sm"><span className="font-medium">Notification cadence</span><NativeSelect value={settings.notifications.defaultCadence} onChange={(e) => setSettings((s) => ({ ...s, notifications: { ...s.notifications, defaultCadence: e.target.value as AppSettings["notifications"]["defaultCadence"] } }))}><option value="immediate">Immediate</option><option value="daily_digest">Daily digest</option></NativeSelect></label>
          <label className="space-y-1 text-sm"><span className="font-medium">Application mode</span><NativeSelect value={settings.workflow.defaultApplicationMode} onChange={(e) => setSettings((s) => ({ ...s, workflow: { ...s.workflow, defaultApplicationMode: e.target.value as AppSettings["workflow"]["defaultApplicationMode"] } }))}><option value="quick_apply">Quick Apply</option><option value="full_build">Full Build</option></NativeSelect></label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Job sources</CardTitle>
          <CardDescription>
            Choose which sources to monitor once connectors exist. No source is connected or polled yet. Individual
            employer boards are managed in the{" "}
            <Link href="/boards" className="text-primary hover:underline">
              employer board registry
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-lg border">
            {initialSources.map((source) => {
              const id = `source-${source.id}`;
              return (
                <li key={source.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor={id} className="cursor-pointer font-medium">
                        {SOURCE_PROVIDER_LABELS[source.provider]}
                      </label>
                      <StatusBadge meta={INTEGRATION_STATUS[source.integrationStatus]} srPrefix="Integration:" />
                    </div>
                    <p className="text-sm text-muted-foreground">{source.description}</p>
                  </div>
                  <Switch
                    id={id}
                    checked={sourceEnabled[source.id] ?? false}
                    onCheckedChange={(checked) => setSourceEnabled((s) => ({ ...s, [source.id]: checked }))}
                  />
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <IntegrationCard
          icon={MessageCircle}
          title="Telegram"
          description="Will deliver new matching jobs with Full Build, Quick Apply, and Skip buttons."
        />
        <IntegrationCard
          icon={Bot}
          title="Claude Code"
          description="Will run your existing workflow to generate tailored resumes, cover letters, and projects."
        />
      </div>

      <PreviewNotice title="Integrations are placeholders">
        ProRez is not connected to Telegram or Claude Code. These cards show where connection status will appear.
      </PreviewNotice>
    </div>
  );
}

function IntegrationCard({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Bot;
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          <CardTitle>{title}</CardTitle>
        </div>
        <CardDescription>{description}</CardDescription>
        <CardAction>
          <StatusBadge meta={{ label: "Not connected", tone: "muted" }} srPrefix="Status:" />
        </CardAction>
      </CardHeader>
      <CardContent>
        <FutureAction>Connect</FutureAction>
      </CardContent>
    </Card>
  );
}
