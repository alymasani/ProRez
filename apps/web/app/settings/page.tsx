import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "@/components/settings/settings-form";
import { getAppSettings, getJobSources } from "@/lib/data";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [settings, sources] = await Promise.all([getAppSettings(), getJobSources()]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Persistent search defaults, notification preferences, workflow defaults, and enabled job sources."
      />
      <SettingsForm initialSettings={settings} initialSources={sources} />
    </div>
  );
}
