-- Milestone 3A: manually triggered ATS board synchronization.
-- Generated with prisma migrate diff, plus hand-written constraints at the end.

-- CreateEnum
CREATE TYPE "published_at_kind" AS ENUM ('none', 'first_published', 'last_published', 'updated');

-- CreateEnum
CREATE TYPE "sync_run_status" AS ENUM ('running', 'succeeded', 'failed');

-- AlterTable
ALTER TABLE "job_locations" ALTER COLUMN "province" DROP NOT NULL;

-- AlterTable
ALTER TABLE "source_observations" ADD COLUMN     "closed_at" TIMESTAMPTZ(3),
ADD COLUMN     "content_hash" TEXT,
ADD COLUMN     "provider_published_at" TIMESTAMPTZ(3),
ADD COLUMN     "published_at_kind" "published_at_kind" NOT NULL DEFAULT 'none';

-- CreateTable
CREATE TABLE "board_sync_runs" (
    "id" UUID NOT NULL,
    "board_id" UUID NOT NULL,
    "status" "sync_run_status" NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "unchanged" INTEGER NOT NULL DEFAULT 0,
    "closed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "details" JSONB,

    CONSTRAINT "board_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "board_sync_runs_board_id_started_at_idx" ON "board_sync_runs"("board_id", "started_at" DESC);

-- AddForeignKey
ALTER TABLE "board_sync_runs" ADD CONSTRAINT "board_sync_runs_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "employer_boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written constraints (Prisma does not manage these; keep when editing)
-- ---------------------------------------------------------------------------
-- A missing province is only allowed for remote roles open anywhere in Canada.
ALTER TABLE "job_locations" ADD CONSTRAINT "job_locations_province_or_remote" CHECK ("province" IS NOT NULL OR "arrangement" = 'remote');

ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_content_hash_format" CHECK ("content_hash" IS NULL OR "content_hash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_published_kind" CHECK (("provider_published_at" IS NULL) = ("published_at_kind" = 'none'));
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_seen_order" CHECK ("last_seen_at" >= "first_seen_at");

-- At most one running sync per board; this is what prevents concurrent syncs.
CREATE UNIQUE INDEX "board_sync_runs_one_running_per_board" ON "board_sync_runs" ("board_id") WHERE "status" = 'running';
ALTER TABLE "board_sync_runs" ADD CONSTRAINT "board_sync_runs_counts_non_negative" CHECK (
  "fetched" >= 0 AND "created" >= 0 AND "updated" >= 0 AND "unchanged" >= 0 AND "closed" >= 0 AND "skipped" >= 0 AND "error_count" >= 0
);
ALTER TABLE "board_sync_runs" ADD CONSTRAINT "board_sync_runs_finished_consistency" CHECK (
  ("status" = 'running' AND "finished_at" IS NULL AND "duration_ms" IS NULL)
  OR ("status" <> 'running' AND "finished_at" IS NOT NULL AND "finished_at" >= "started_at" AND "duration_ms" >= 0)
);
ALTER TABLE "board_sync_runs" ADD CONSTRAINT "board_sync_runs_failure_has_code" CHECK ("status" <> 'failed' OR "error_code" IS NOT NULL);
