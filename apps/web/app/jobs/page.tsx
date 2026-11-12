import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { JobsExplorer } from "@/components/jobs/jobs-explorer";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ExplorerSkeleton } from "@/components/page-skeletons";
import { getJobsWithMatches } from "@/lib/data";
import { resolveDataSource } from "@/lib/repositories/source";

export const metadata: Metadata = { title: "Job discovery" };

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Job discovery"
        description={
          resolveDataSource(process.env) === "database"
            ? "Software engineering internships, co-ops, and new grad roles across Canada, from employer boards you sync and jobs you add. Records marked Demo are fictional."
            : "Software engineering internships, co-ops, and new grad roles across Canada. Listings and fit scores are fictional demo data; live source monitoring arrives in a later milestone."
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/jobs/new">
              <Plus /> Add a job
            </Link>
          </Button>
        }
      />
      {/* Request-time jobs and URL filter state (useSearchParams) both resolve inside this boundary. */}
      <Suspense fallback={<ExplorerSkeleton />}>
        <JobsResults />
      </Suspense>
    </div>
  );
}

async function JobsResults() {
  return <JobsExplorer items={await getJobsWithMatches()} />;
}
