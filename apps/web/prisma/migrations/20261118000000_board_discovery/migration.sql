-- Milestone 3C: companies, automatic board discovery, sync accounting, Lever EU region.
-- Generated with prisma migrate diff, plus hand-written constraints and seed rows at the end.
-- CreateEnum
CREATE TYPE "board_origin" AS ENUM ('manual', 'discovered');

-- CreateEnum
CREATE TYPE "discovery_candidate_status" AS ENUM ('discovered', 'validating', 'verified', 'pending_review', 'rejected', 'registered');

-- CreateEnum
CREATE TYPE "discovery_source" AS ENUM ('search', 'common_crawl', 'existing_jobs', 'manual');

-- CreateEnum
CREATE TYPE "discovery_evidence_type" AS ENUM ('ats_board_response', 'official_site_link', 'official_site_redirect', 'search_result', 'common_crawl', 'existing_job_url', 'existing_board', 'manual_review');

-- CreateEnum
CREATE TYPE "discovery_evidence_status" AS ENUM ('validated', 'unvalidated', 'failed');

-- CreateEnum
CREATE TYPE "discovery_run_status" AS ENUM ('running', 'succeeded', 'partial', 'failed');

-- AlterTable
ALTER TABLE "board_sync_runs" ADD COLUMN     "duplicate" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "eligible" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "enrichment_incomplete" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "filtered_employment_type" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "filtered_location" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ingest_errors" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "invalid" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "employer_boards" ADD COLUMN     "company_id" UUID,
ADD COLUMN     "origin" "board_origin" NOT NULL DEFAULT 'manual',
ADD COLUMN     "region" TEXT;

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "origin" "board_origin" NOT NULL DEFAULT 'discovered',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_candidates" (
    "id" UUID NOT NULL,
    "provider" "source_provider" NOT NULL,
    "board_token" TEXT NOT NULL,
    "region" TEXT,
    "board_url" TEXT NOT NULL,
    "company_name" TEXT,
    "company_domain" TEXT,
    "discovered_url" TEXT NOT NULL,
    "source" "discovery_source" NOT NULL,
    "status" "discovery_candidate_status" NOT NULL DEFAULT 'discovered',
    "status_reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "validating_until" TIMESTAMPTZ(3),
    "last_verified_at" TIMESTAMPTZ(3),
    "posting_count" INTEGER,
    "first_discovered_at" TIMESTAMPTZ(3) NOT NULL,
    "last_discovered_at" TIMESTAMPTZ(3) NOT NULL,
    "registered_board_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discovery_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_evidence" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "type" "discovery_evidence_type" NOT NULL,
    "status" "discovery_evidence_status" NOT NULL,
    "source_url" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "observed_at" TIMESTAMPTZ(3) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_runs" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "trigger" "sync_trigger" NOT NULL,
    "status" "discovery_run_status" NOT NULL DEFAULT 'running',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "search_requests" INTEGER NOT NULL DEFAULT 0,
    "candidate_urls" INTEGER NOT NULL DEFAULT 0,
    "unique_candidates" INTEGER NOT NULL DEFAULT 0,
    "new_candidates" INTEGER NOT NULL DEFAULT 0,
    "validated" INTEGER NOT NULL DEFAULT 0,
    "registered" INTEGER NOT NULL DEFAULT 0,
    "pending_review" INTEGER NOT NULL DEFAULT 0,
    "rejected" INTEGER NOT NULL DEFAULT 0,
    "api_errors" INTEGER NOT NULL DEFAULT 0,
    "ats_requests" INTEGER NOT NULL DEFAULT 0,
    "site_requests" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "details" JSONB,

    CONSTRAINT "discovery_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_queries" (
    "id" UUID NOT NULL,
    "provider" "source_provider" NOT NULL,
    "category" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "results" INTEGER NOT NULL DEFAULT 0,
    "new_candidates" INTEGER NOT NULL DEFAULT 0,
    "verified" INTEGER NOT NULL DEFAULT 0,
    "requests" INTEGER NOT NULL DEFAULT 0,
    "next_offset" INTEGER NOT NULL DEFAULT 0,
    "exhausted" BOOLEAN NOT NULL DEFAULT false,
    "last_run_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_schedule" (
    "id" TEXT NOT NULL,
    "next_run_at" TIMESTAMPTZ(3),
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(3),
    "requested_at" TIMESTAMPTZ(3),
    "last_run_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discovery_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_domain_key" ON "companies"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_candidates_registered_board_id_key" ON "discovery_candidates"("registered_board_id");

-- CreateIndex
CREATE INDEX "discovery_candidates_status_next_attempt_at_idx" ON "discovery_candidates"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_candidates_provider_board_token_key" ON "discovery_candidates"("provider", "board_token");

-- CreateIndex
CREATE UNIQUE INDEX "discovery_evidence_candidate_id_dedupe_key_key" ON "discovery_evidence"("candidate_id", "dedupe_key");

-- CreateIndex
CREATE INDEX "discovery_runs_started_at_idx" ON "discovery_runs"("started_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "discovery_queries_text_key" ON "discovery_queries"("text");

-- CreateIndex
CREATE INDEX "discovery_queries_last_run_at_idx" ON "discovery_queries"("last_run_at");

-- CreateIndex
CREATE INDEX "employer_boards_company_id_idx" ON "employer_boards"("company_id");

-- AddForeignKey
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_registered_board_id_fkey" FOREIGN KEY ("registered_board_id") REFERENCES "employer_boards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_evidence" ADD CONSTRAINT "discovery_evidence_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "discovery_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written constraints (Prisma does not manage these; keep when editing)
-- ---------------------------------------------------------------------------
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_region" CHECK ("region" IS NULL OR ("provider" = 'lever' AND "region" = 'eu'));
ALTER TABLE "board_sync_runs" ADD CONSTRAINT "board_sync_runs_accounting_non_negative" CHECK (
  "eligible" >= 0 AND "filtered_location" >= 0 AND "filtered_employment_type" >= 0 AND "duplicate" >= 0
  AND "invalid" >= 0 AND "ingest_errors" >= 0 AND "enrichment_incomplete" >= 0
);
ALTER TABLE "companies" ADD CONSTRAINT "companies_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "companies" ADD CONSTRAINT "companies_domain_format" CHECK ("domain" IS NULL OR "domain" ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$');
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_token_format" CHECK ("board_token" ~ '^[a-z0-9][a-z0-9._-]{0,99}$');
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_ats_provider" CHECK ("provider" IN ('greenhouse', 'lever', 'ashby', 'smartrecruiters'));
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_region" CHECK ("region" IS NULL OR ("provider" = 'lever' AND "region" = 'eu'));
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_url_https" CHECK ("board_url" LIKE 'https://%');
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_attempts_non_negative" CHECK ("attempts" >= 0);
-- A registered candidate always points at its board.
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_registered_has_board" CHECK ("status" <> 'registered' OR "registered_board_id" IS NOT NULL);
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_counts_non_negative" CHECK (
  "search_requests" >= 0 AND "candidate_urls" >= 0 AND "unique_candidates" >= 0 AND "new_candidates" >= 0 AND "validated" >= 0
  AND "registered" >= 0 AND "pending_review" >= 0 AND "rejected" >= 0 AND "api_errors" >= 0 AND "ats_requests" >= 0 AND "site_requests" >= 0
);
ALTER TABLE "discovery_runs" ADD CONSTRAINT "discovery_runs_finished_consistency" CHECK (("status" = 'running') = ("finished_at" IS NULL));
-- At most one discovery run at a time (the schedule lease is the primary guard).
CREATE UNIQUE INDEX "discovery_runs_one_running" ON "discovery_runs" ((true)) WHERE "status" = 'running';
ALTER TABLE "discovery_schedule" ADD CONSTRAINT "discovery_schedule_lease_consistency" CHECK (("lease_owner" IS NULL) = ("lease_expires_at" IS NULL));
ALTER TABLE "discovery_queries" ADD CONSTRAINT "discovery_queries_offset_range" CHECK ("next_offset" BETWEEN 0 AND 9);

-- The single discovery schedule row (due now; the worker only runs it when discovery is enabled).
INSERT INTO "discovery_schedule" ("id", "next_run_at", "updated_at") VALUES ('default', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
