import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProfileEditor } from "@/components/profiles/profile-editor";
import { Button } from "@/components/ui/button";
import { getMutationAvailability } from "@/lib/auth/server-actor";
import { emptyProfileDraft } from "@/lib/profiles/draft";

export const metadata: Metadata = { title: "New search profile" };

export default function NewProfilePage() {
  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/profiles">
          <ArrowLeft /> All profiles
        </Link>
      </Button>
      <PageHeader title="New search profile" description="Define the roles, locations, and automation for a new search." />
      <ProfileEditor initial={emptyProfileDraft()} profileId={null} version={null} saving={getMutationAvailability()} />
    </div>
  );
}
