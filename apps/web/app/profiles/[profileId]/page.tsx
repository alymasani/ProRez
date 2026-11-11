import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProfileEditor } from "@/components/profiles/profile-editor";
import { DemoBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { getSearchProfile, getSearchProfiles } from "@/lib/data";
import { draftFromProfile } from "@/lib/profiles/draft";

export function generateStaticParams() {
  return getSearchProfiles().map((p) => ({ profileId: p.id }));
}

export async function generateMetadata({ params }: PageProps<"/profiles/[profileId]">): Promise<Metadata> {
  const { profileId } = await params;
  return { title: getSearchProfile(profileId)?.name ?? "Profile not found" };
}

export default async function EditProfilePage({ params }: PageProps<"/profiles/[profileId]">) {
  const { profileId } = await params;
  const profile = getSearchProfile(profileId);
  if (!profile) notFound();

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/profiles">
          <ArrowLeft /> All profiles
        </Link>
      </Button>
      <PageHeader eyebrow={<DemoBadge label="Demo profile" />} title={profile.name} description={profile.description} />
      {/* key resets editor state when switching between profiles */}
      <ProfileEditor key={profile.id} initial={draftFromProfile(profile)} isNew={false} />
    </div>
  );
}
