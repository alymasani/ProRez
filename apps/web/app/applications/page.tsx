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

export default async function ApplicationsPage() {
  const [applications, jobs, resumes, coverLetters, projects, runs] = await Promise.all([
    getApplications(),
    getJobs(),
    getResumes(),
    getCoverLetters(),
    getProjects(),
    getApplicationRuns(),
  ]);
  const rows = buildApplicationRows({ applications, jobs, resumes, coverLetters, projects, runs });

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
