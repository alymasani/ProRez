import type { Metadata } from "next";
import { Suspense } from "react";
import { BoardsManager } from "@/components/boards/boards-manager";
import { DiscoveryPanel } from "@/components/boards/discovery-panel";
import { PageHeader } from "@/components/page-header";
import { TableSkeleton } from "@/components/page-skeletons";
import { getMutationAvailability } from "@/lib/auth/server-actor";
import { getBoardSyncRuns, getDiscoveryDashboard, getEmployerBoards } from "@/lib/data";

export const metadata: Metadata = { title: "Employer boards" };

export default function BoardsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Employer boards"
        description="Employer job boards on Greenhouse, Lever, Ashby and SmartRecruiters. Enabled boards are synced automatically by the background worker; Sync now imports a board's published Canadian entry-level postings immediately, through the provider's official public API."
      />
      <Suspense fallback={<TableSkeleton label="Loading employer boards…" rows={4} />}>
        <BoardsContent />
      </Suspense>
      <Suspense fallback={<TableSkeleton label="Loading board discovery…" rows={3} />}>
        <DiscoveryContent />
      </Suspense>
    </div>
  );
}

/** Database mode only: candidates, evidence and discovery runs (Milestone 3C). */
async function DiscoveryContent() {
  const data = await getDiscoveryDashboard();
  return data ? <DiscoveryPanel data={data} saving={getMutationAvailability()} /> : null;
}

/** Request-time data (boards, sync history) streams in below the static header. */
async function BoardsContent() {
  const [boards, runs] = await Promise.all([getEmployerBoards(), getBoardSyncRuns()]);
  return <BoardsManager boards={boards} runs={runs} saving={getMutationAvailability()} />;
}
