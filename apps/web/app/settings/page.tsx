import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { getDefaultPreferences, getJobSources } from "@/lib/data";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [preferences, sources] = await Promise.all([getDefaultPreferences(), getJobSources()]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Default search preferences, job sources, and integration status. Changes are local to this page and are not saved in this milestone."
      />
      <SettingsForm initialPreferences={preferences} initialSources={sources} />
    </div>
  );
}
