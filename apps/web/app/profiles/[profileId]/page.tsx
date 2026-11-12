import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { DetailSkeleton } from "@/components/page-skeletons";
import { ProfileEditor } from "@/components/profiles/profile-editor";
import { ProfileSummary } from "@/components/profiles/profile-summary";
import { PreviewNotice } from "@/components/states";
import { DemoBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getMutationAvailability } from "@/lib/auth/server-actor";
import { getProfileHistoryCounts, getSearchProfile } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { draftFromProfile } from "@/lib/profiles/draft";

export async function generateMetadata({ params }: PageProps<"/profiles/[profileId]">): Promise<Metadata> {
  const { profileId } = await params;
  return { title: (await getSearchProfile(profileId))?.name ?? "Profile not found" };
}

export default function EditProfilePage({ params, searchParams }: PageProps<"/profiles/[profileId]">) {
  return (
    <Suspense fallback={<DetailSkeleton label="Loading profile…" />}>
      <EditProfile params={params} searchParams={searchParams} />
    </Suspense>
  );
}

type EditProfileProps = Pick<PageProps<"/profiles/[profileId]">, "params" | "searchParams">;

async function EditProfile({ params, searchParams }: EditProfileProps) {
  const [{ profileId }, query] = await Promise.all([params, searchParams]);
  const profile = await getSearchProfile(profileId);
  if (!profile) notFound();
  const matchCount = (await getProfileHistoryCounts([profile.id]))[profile.id] ?? 0;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/profiles">
          <ArrowLeft /> All profiles
        </Link>
      </Button>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <DemoBadge when={profile.isDemo} label="Demo profile" />
            {profile.archivedAt ? <Badge variant="muted">Archived</Badge> : null}
          </span>
        }
        title={profile.name}
        description={profile.description}
      />
      {profile.archivedAt ? (
        <>
          <PreviewNotice title={`Archived on ${formatDate(profile.archivedAt)}`}>
            This profile was deleted while job results that already produced a notification referenced it, so it was archived instead. It is no longer evaluated and
            cannot be edited. Its settings (version {profile.version}) are kept below for reference.
          </PreviewNotice>
          <Card>
            <CardContent>
              <ProfileSummary draft={draftFromProfile(profile)} />
            </CardContent>
          </Card>
        </>
      ) : (
        // Keyed by profile only: the editor reconciles newer server versions itself
        // so a save's success message survives the post-save refresh.
        <ProfileEditor
          key={profile.id}
          initial={draftFromProfile(profile)}
          profileId={profile.id}
          version={profile.version}
          saving={getMutationAvailability()}
          matchCount={matchCount}
          justCreated={query.created === "1"}
        />
      )}
    </div>
  );
}
