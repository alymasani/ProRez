"use client";

import { useState } from "react";
import Link from "next/link";
import { ListFilter, Pencil } from "lucide-react";
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

export function ProfilesList({ profiles }: { profiles: SearchProfile[] }) {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(profiles.map((p) => [p.id, p.enabled])),
  );
  const enabledCount = profiles.filter((p) => enabled[p.id]).length;
  const dirty = profiles.some((p) => enabled[p.id] !== p.enabled);

  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={ListFilter}
        title="No search profiles yet"
        description="Create a profile to describe the kinds of roles you want ProRez to look for."
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
        <span>
          <span className="font-medium text-foreground">{enabledCount}</span> of {profiles.length} profiles enabled
        </span>
        {dirty ? <Badge variant="warning">Unsaved toggle changes</Badge> : null}
      </p>
      <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {profiles.map((profile) => {
          const switchId = `enable-${profile.id}`;
          const isOn = enabled[profile.id] ?? false;
          return (
            <li key={profile.id}>
              <Card className={isOn ? "h-full" : "h-full opacity-75"}>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-center gap-2">
                    {profile.name}
                    <DemoBadge />
                  </CardTitle>
                  <CardDescription>{profile.description}</CardDescription>
                  <CardAction className="flex items-center gap-2">
                    <label htmlFor={switchId} className="text-xs text-muted-foreground">
                      {isOn ? "Enabled" : "Disabled"}
                    </label>
                    <Switch
                      id={switchId}
                      checked={isOn}
                      onCheckedChange={(checked) => setEnabled((s) => ({ ...s, [profile.id]: checked }))}
                    />
                  </CardAction>
                </CardHeader>
                <CardContent className="flex-1">
                  <ProfileSummary draft={draftFromProfile(profile)} compact />
                </CardContent>
                <CardFooter className="justify-between border-t pt-4">
                  <span className="text-xs text-muted-foreground">Updated {formatDate(profile.updatedAt)}</span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/profiles/${profile.id}`}>
                      <Pencil /> Edit
                    </Link>
                  </Button>
                </CardFooter>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
