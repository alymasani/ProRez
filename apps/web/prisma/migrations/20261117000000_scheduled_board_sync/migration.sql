-- Milestone 3B: automatic (scheduled) board synchronization.
-- Generated with prisma migrate diff, plus hand-written constraints and a backfill at the end.
-- CreateEnum
CREATE TYPE "sync_trigger" AS ENUM ('manual', 'scheduled');

-- AlterEnum


ALTER TYPE "sync_run_status" ADD VALUE 'partial';
ALTER TYPE "sync_run_status" ADD VALUE 'skipped';

-- AlterTable
ALTER TABLE "board_sync_runs" ADD COLUMN     "complete" BOOLEAN,
ADD COLUMN     "missing" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reactivated" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "trigger" "sync_trigger" NOT NULL DEFAULT 'manual';

-- AlterTable
ALTER TABLE "employer_boards" ADD COLUMN     "last_error_code" TEXT,
ADD COLUMN     "next_sync_at" TIMESTAMPTZ(3),
ADD COLUMN     "sync_lease_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "sync_lease_owner" TEXT;

-- AlterTable
ALTER TABLE "source_observations" ADD COLUMN     "missing_count" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "employer_boards_next_sync_at_idx" ON "employer_boards"("next_sync_at");


-- ---------------------------------------------------------------------------
-- Hand-written constraints (Prisma does not manage these; keep when editing)
-- ---------------------------------------------------------------------------
ALTER TABLE "board_sync_runs" ADD CONSTRAINT "board_sync_runs_new_counts_non_negative" CHECK ("reactivated" >= 0 AND "missing" >= 0);
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_missing_count_non_negative" CHECK ("missing_count" >= 0);
-- A lease has both an owner and an expiry, or neither.
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_lease_consistency" CHECK (("sync_lease_owner" IS NULL) = ("sync_lease_expires_at" IS NULL));

-- ---------------------------------------------------------------------------
-- Backfill: schedule existing enabled, real boards. Due now if never synced or
-- overdue; otherwise one interval after the last success. Demo boards are
-- never scheduled (their tokens are fictional).
-- ---------------------------------------------------------------------------
UPDATE "employer_boards"
SET "next_sync_at" = COALESCE("last_success_at" + make_interval(mins => "poll_interval_minutes"), CURRENT_TIMESTAMP)
WHERE "enabled" AND NOT "is_demo";
