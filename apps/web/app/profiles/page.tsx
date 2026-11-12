import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ProfilesList } from "@/components/profiles/profiles-list";
import { PreviewNotice } from "@/components/states";
import { Button } from "@/components/ui/button";
import { getSearchProfiles } from "@/lib/data";

export const metadata: Metadata = { title: "Search profiles" };

export default async function ProfilesPage() {
  const profiles = await getSearchProfiles();
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
      <PreviewNotice title="Demo profiles — not saved or evaluated">
        These example profiles show the configuration model. Toggles and edits are local to this page; matching jobs
        against profiles and sending notifications arrive in later milestones.
      </PreviewNotice>
      <ProfilesList profiles={profiles} />
    </div>
  );
}
