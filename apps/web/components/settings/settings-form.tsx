"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, MessageCircle, RotateCcw, Save } from "lucide-react";
import { CheckboxGroup, optionsFrom } from "@/components/forms/checkbox-group";
import { FutureAction } from "@/components/future-action";
import { PreviewNotice } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  ARRANGEMENT_LABELS,
  DISCIPLINE_LABELS,
  DURATION_LABELS,
  INTEGRATION_STATUS,
  JOB_TYPE_LABELS,
  PROVINCE_LABELS,
  SOURCE_PROVIDER_LABELS,
} from "@/lib/labels";
import {
  DISCIPLINES,
  DURATION_BUCKETS,
  JOB_TYPES,
  PROVINCES,
  WORK_ARRANGEMENTS,
  type JobSource,
  type SearchPreferences,
} from "@/lib/types";

const PROVINCE_OPTIONS = PROVINCES.map((p) => ({ value: p, label: PROVINCE_LABELS[p] }));

function sameSet<T>(a: readonly T[], b: readonly T[]) {
  return a.length === b.length && a.every((v) => b.includes(v));
}

export function SettingsForm({
  initialPreferences,
  initialSources,
}: {
  initialPreferences: SearchPreferences;
  initialSources: JobSource[];
}) {
  const [prefs, setPrefs] = useState(initialPreferences);
  const [sourceEnabled, setSourceEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(initialSources.map((s) => [s.id, s.enabled])),
  );

  const dirty =
    (Object.keys(prefs) as (keyof SearchPreferences)[]).some(
      (k) => !sameSet<string>(prefs[k], initialPreferences[k]),
    ) || initialSources.some((s) => sourceEnabled[s.id] !== s.enabled);

  function patch(next: Partial<SearchPreferences>) {
    setPrefs((p) => ({ ...p, ...next }));
  }

  function reset() {
    setPrefs(initialPreferences);
    setSourceEnabled(Object.fromEntries(initialSources.map((s) => [s.id, s.enabled])));
  }

  return (
    <div className="space-y-6">
      <div className="sticky top-14 z-20 -mx-4 flex flex-col gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur sm:flex-row sm:items-center sm:justify-between lg:top-0 lg:mx-0 lg:rounded-xl lg:border lg:px-4">
        <p className="text-sm" aria-live="polite">
          {dirty ? (
            <span className="flex items-center gap-2">
              <Badge variant="warning">Unsaved</Badge>
              Local changes only — they reset when you leave or refresh.
            </span>
          ) : (
            <span className="text-muted-foreground">Showing demo defaults.</span>
          )}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={reset} disabled={!dirty}>
            <RotateCcw /> Reset
          </Button>
          <FutureAction variant="default" reason="Saving settings requires persistence, planned for a later milestone">
            <Save /> Save
          </FutureAction>
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
              options={optionsFrom(DURATION_BUCKETS, DURATION_LABELS)}
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Job sources</CardTitle>
          <CardDescription>
            Choose which sources to monitor once connectors exist. No source is connected or polled yet.
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
