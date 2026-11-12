/**
 * DEMO FIXTURES — employer boards for fictional companies. Tokens are made up;
 * nothing is ever fetched from these URLs, and demo boards are never scheduled
 * for automatic syncing.
 */
import type { EmployerBoard } from "@/lib/types";

const CREATED = "2026-11-01T12:00:00Z";

function board(b: Pick<EmployerBoard, "id" | "provider" | "employerName" | "boardToken" | "boardUrl"> & Partial<EmployerBoard>): EmployerBoard {
  return {
    enabled: true,
    pollIntervalMinutes: 360,
    nextSyncAt: null,
    syncing: false,
    activeJobCount: 0,
    lastErrorCode: null,
    lastCheckedAt: null,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    lastErrorAt: null,
    lastErrorMessage: null,
    createdAt: CREATED,
    updatedAt: CREATED,
    isDemo: true,
    ...b,
  };
}

export const DEMO_EMPLOYER_BOARDS: EmployerBoard[] = [
  board({
    id: "00000000-0000-4000-8000-0000000000b1",
    provider: "greenhouse",
    employerName: "Northlight Robotics",
    boardToken: "prorez-demo-northlight",
    boardUrl: "https://job-boards.greenhouse.io/prorez-demo-northlight",
  }),
  board({
    id: "00000000-0000-4000-8000-0000000000b2",
    provider: "lever",
    employerName: "Maplewave Analytics",
    boardToken: "prorez-demo-maplewave",
    boardUrl: "https://jobs.lever.co/prorez-demo-maplewave",
    pollIntervalMinutes: 720,
  }),
  board({
    id: "00000000-0000-4000-8000-0000000000b3",
    provider: "ashby",
    employerName: "Glacier Labs",
    boardToken: "prorez-demo-glacier",
    boardUrl: "https://jobs.ashbyhq.com/prorez-demo-glacier",
    enabled: false,
  }),
];
