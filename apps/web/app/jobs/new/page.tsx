import type { Metadata } from "next";
import { ManualJobForm } from "@/components/jobs/manual-job-form";
import { PageHeader } from "@/components/page-header";

export const metadata: Metadata = { title: "Add a job" };

export default function NewJobPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Add a job manually"
        description="Save a posting from its URL, pasted description, or both. ProRez will evaluate it against every enabled search profile."
      />
      <ManualJobForm />
    </div>
  );
}
