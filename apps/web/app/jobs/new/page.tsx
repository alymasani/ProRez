import type { Metadata } from "next";
import { ManualJobForm } from "@/components/jobs/manual-job-form";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Add a job" };

export default function NewJobPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Add a job manually"
        description="Bring in a posting ProRez didn't find on its own. In this milestone the form validates your input and shows a local preview only."
      />
      <ManualJobForm />
    </div>
  );
}
