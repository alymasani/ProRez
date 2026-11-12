"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Copy, ListFilter, LoaderCircle, Pencil } from "lucide-react";
import { duplicateProfileAction, setProfileEnabledAction } from "@/app/profiles/actions";
import { FutureAction } from "@/components/future-action";
import { DeleteProfileButton } from "@/components/profiles/delete-profile-button";
import { ProfileSummary } from "@/components/profiles/profile-summary";
import { EmptyState } from "@/components/states";
import { DemoBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatDate } from "@/lib/format";
import { draftFromProfile } from "@/lib/profiles/draft";
import type { SearchProfile } from "@/lib/types";

type Notice = { tone: "success" | "error"; text: string } | null;

export function ProfilesList({
  profiles,
  matchCounts,
  saving,
}: {
  profiles: SearchProfile[];
  matchCounts: Record<string, number>;
  saving: { enabled: boolean; reason: string | null };
}) {
  // Read-only mode keeps toggles as a local preview; saving mode writes through.
  const [localEnabled, setLocalEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(profiles.map((p) => [p.id, p.enabled])),
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [isPending, startTransition] = useTransition();

  const enabledOf = (p: SearchProfile) => (saving.enabled ? p.enabled : (localEnabled[p.id] ?? p.enabled));
  const enabledCount = profiles.filter(enabledOf).length;
  const previewDirty = !saving.enabled && profiles.some((p) => localEnabled[p.id] !== p.enabled);

  function toggle(profile: SearchProfile, next: boolean) {
    if (!saving.enabled) {
      setLocalEnabled((s) => ({ ...s, [profile.id]: next }));
      return;
    }
    setPendingId(profile.id);
    setNotice(null);
    startTransition(async () => {
      const result = await setProfileEnabledAction(profile.id, next);
      setPendingId(null);
      setNotice(
        result.ok
          ? {
              tone: "success",
              text: `${profile.name} ${next ? "enabled" : "disabled"}.${result.value.warning ? ` ${result.value.warning}` : ""}`,
            }
          : { tone: "error", text: result.message },
      );
    });
  }

  function duplicate(profile: SearchProfile) {
    setPendingId(profile.id);
    setNotice(null);
    startTransition(async () => {
      const result = await duplicateProfileAction(profile.id);
      setPendingId(null);
      setNotice(
        result.ok
          ? { tone: "success", text: `Created “${result.value.profile.name}” (disabled).` }
          : { tone: "error", text: result.message },
      );
    });
  }

  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={ListFilter}
        title="No search profiles yet"
        description="Create a profile to describe the kinds of roles you want ProRez to look for."
        action={
          saving.enabled ? (
            <Button asChild size="sm">
              <Link href="/profiles/new">New profile</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <span>
          <span className="font-medium text-foreground">{enabledCount}</span> of {profiles.length} profiles enabled
        </span>
        {previewDirty ? <Badge variant="warning">Unsaved toggle changes</Badge> : null}
        {isPending ? (
          <span className="inline-flex items-center gap-1">
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" /> Saving…
          </span>
        ) : null}
      </div>
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
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {profiles.map((profile) => {
          const switchId = `enable-${profile.id}`;
          const isOn = enabledOf(profile);
          const busy = pendingId === profile.id;
          const matched = matchCounts[profile.id] ?? 0;
          return (
            <li key={profile.id}>
              <Card className={isOn ? "h-full" : "h-full opacity-75"}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {profile.name}
                    <DemoBadge when={profile.isDemo} />
                  </CardTitle>
                  <CardDescription>{profile.description}</CardDescription>
                  <CardAction className="flex items-center gap-2">
                    <label htmlFor={switchId} className="text-xs text-muted-foreground">
                      {isOn ? "Enabled" : "Disabled"}
                    </label>
                    <Switch id={switchId} checked={isOn} disabled={busy} onCheckedChange={(checked) => toggle(profile, checked)} />
                  </CardAction>
                </CardHeader>
                <CardContent className="flex-1">
                  <ProfileSummary draft={draftFromProfile(profile)} compact />
                </CardContent>
                <CardFooter className="flex-wrap justify-between gap-2 border-t pt-4">
                  <span className="text-xs text-muted-foreground">
                    v{profile.version} · Updated {formatDate(profile.updatedAt)}
                    {matched > 0 ? ` · ${matched} notified result${matched === 1 ? "" : "s"}` : ""}
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {saving.enabled ? (
                      <>
                        <DeleteProfileButton
                          profileId={profile.id}
                          profileName={profile.name}
                          matchCount={matched}
                          onDone={(outcome) =>
                            setNotice({ tone: "success", text: `${profile.name} ${outcome === "archived" ? "archived" : "deleted"}.` })
                          }
                        />
                        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => duplicate(profile)}>
                          <Copy /> Duplicate
                        </Button>
                      </>
                    ) : (
                      <FutureAction reason={saving.reason ?? undefined}>
                        <Copy /> Duplicate
                      </FutureAction>
                    )}
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/profiles/${profile.id}`}>
                        <Pencil /> Edit
                      </Link>
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
