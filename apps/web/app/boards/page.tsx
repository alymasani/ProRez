import type { Metadata } from "next";
import { BoardsManager } from "@/components/boards/boards-manager";
import { PageHeader } from "@/components/page-header";
import { getMutationAvailability } from "@/lib/auth/server-actor";
import { getEmployerBoards } from "@/lib/data";

export const metadata: Metadata = { title: "Employer boards" };

export default async function BoardsPage() {
  const boards = await getEmployerBoards();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Employer boards"
        description="The registry of employer job boards on Greenhouse, Lever, Ashby and SmartRecruiters that ProRez will monitor once polling is built. Registering a board does not contact it."
      />
      <BoardsManager boards={boards} saving={getMutationAvailability()} />
    </div>
  );
}
