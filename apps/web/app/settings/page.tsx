import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { FormSkeleton } from "@/components/page-skeletons";
import { SettingsForm } from "@/components/settings/settings-form";
import { getAppSettings, getJobSources } from "@/lib/data";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Persistent search defaults, notification preferences, workflow defaults, and enabled job sources."
      />
      <Suspense fallback={<FormSkeleton label="Loading settings…" />}>
        <SettingsContent />
      </Suspense>
    </div>
  );
}

async function SettingsContent() {
  const [settings, sources] = await Promise.all([getAppSettings(), getJobSources()]);
  return <SettingsForm initialSettings={settings} initialSources={sources} />;
}
