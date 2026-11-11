import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Plus } from "lucide-react";
import { JobsExplorer } from "@/components/jobs/jobs-explorer";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getJobsWithMatches } from "@/lib/data";

export const metadata: Metadata = { title: "Job discovery" };

function ExplorerSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[15rem_1fr]" role="status" aria-live="polite">
      <span className="sr-only">Loading jobs…</span>
      <Skeleton className="hidden h-[32rem] rounded-xl lg:block" />
      <div className="space-y-3">
        <Skeleton className="h-9 w-full" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

export default function JobsPage() {
  const items = getJobsWithMatches();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Job discovery"
        description="Software engineering internships, co-ops, and new grad roles across Canada. Listings and fit scores are fictional demo data; live source monitoring arrives in a later milestone."
        actions={
          <Button asChild variant="outline">
            <Link href="/jobs/new">
              <Plus /> Add a job
            </Link>
          </Button>
        }
      />
      {/* Filter state lives in the URL, so the explorer reads search params inside Suspense. */}
      <Suspense fallback={<ExplorerSkeleton />}>
        <JobsExplorer items={items} />
      </Suspense>
    </div>
  );
}
