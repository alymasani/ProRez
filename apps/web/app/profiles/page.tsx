import type { Metadata } from "next";
import Link from "next/link";
import { Archive, Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProfilesList } from "@/components/profiles/profiles-list";
import { PreviewNotice } from "@/components/states";
import { Button } from "@/components/ui/button";
import { getMutationAvailability } from "@/lib/auth/server-actor";
import { getArchivedSearchProfiles, getProfileHistoryCounts, getSearchProfiles } from "@/lib/data";

export const metadata: Metadata = { title: "Search profiles" };

export default async function ProfilesPage() {
  const saving = getMutationAvailability();
  const [profiles, archived] = await Promise.all([getSearchProfiles(), getArchivedSearchProfiles()]);
  const matchCounts = await getProfileHistoryCounts(profiles.map((p) => p.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Search profiles"
        description="Describe each kind of role you're targeting. Enable as many profiles as you like — a job that matches several is deduplicated into one result and one notification."
        actions={
          <Button asChild>
            <Link href="/profiles/new">
              <Plus /> New profile
            </Link>
          </Button>
        }
      />
      {saving.enabled ? null : (
        <PreviewNotice title="Read-only demo profiles">
          {saving.reason} Toggles here are a local preview only. Matching results shown on job pages are computed by the
          real matching engine.
        </PreviewNotice>
      )}
      <ProfilesList profiles={profiles} matchCounts={matchCounts} saving={saving} />
      {archived.length > 0 ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Archive className="size-4" aria-hidden="true" />
          {archived.length} archived profile{archived.length === 1 ? " is" : "s are"} kept for notification history:
          {archived.map((p, i) => (
            <span key={p.id}>
              {i > 0 ? ", " : ""}
              <Link href={`/profiles/${p.id}`} className="underline-offset-2 hover:underline">
                {p.name}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
