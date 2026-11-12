import type { Metadata } from "next";
import { Suspense } from "react";
import { ApplicationsView } from "@/components/applications/applications-view";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/page-skeletons";
import { buildApplicationRows } from "@/lib/applications/rows";
import {
  getApplicationRuns,
  getApplicationEvents,
  getApplicationInterviews,
  getApplications,
  getCoverLetters,
  getJobs,
  getProjects,
  getResumes,
} from "@/lib/data";
import { mutationsConfigured } from "@/lib/auth/mutation-guard";
import { resolveDataSource } from "@/lib/repositories/source";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Applications"
        description="Preparation status tracks generated materials; application status records what you've done with the employer. ProRez never submits applications on your behalf."
      />
      <Suspense fallback={<TableSkeleton label="Loading applications…" />}>
        <ApplicationsContent />
      </Suspense>
    </div>
  );
}

async function ApplicationsContent() {
  const [applications, jobs, resumes, coverLetters, projects, runs, events, interviews] = await Promise.all([
    getApplications(),
    getJobs(),
    getResumes(),
    getCoverLetters(),
    getProjects(),
    getApplicationRuns(),
    getApplicationEvents(),
    getApplicationInterviews(),
  ]);
  const rows = buildApplicationRows({ applications, jobs, resumes, coverLetters, projects, runs, events, interviews });
  const mutation = mutationsConfigured({ dataSource: resolveDataSource(process.env), localMutations: process.env.PROREZ_LOCAL_MUTATIONS });

  return <ApplicationsView rows={rows} writable={mutation.enabled} />;
}
