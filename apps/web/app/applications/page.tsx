import type { Metadata } from "next";
import { ApplicationsView } from "@/components/applications/applications-view";
import { PageHeader } from "@/components/page-header";
import { buildApplicationRows } from "@/lib/applications";
import {
  getApplicationRuns,
  getApplications,
  getCoverLetters,
  getJobs,
  getProjects,
  getResumes,
} from "@/lib/data";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage() {
  const rows = buildApplicationRows({
    applications: getApplications(),
    jobs: getJobs(),
    resumes: getResumes(),
    coverLetters: getCoverLetters(),
    projects: getProjects(),
    runs: getApplicationRuns(),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Applications"
        description="Preparation status tracks generated materials; submission status records what you've done with the employer. ProRez never submits applications on your behalf. All rows are demo data."
      />
      <ApplicationsView rows={rows} />
    </div>
  );
}
