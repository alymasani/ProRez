-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "province" AS ENUM ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT');

-- CreateEnum
CREATE TYPE "work_arrangement" AS ENUM ('onsite', 'hybrid', 'remote');

-- CreateEnum
CREATE TYPE "job_type" AS ENUM ('new_grad', 'internship', 'co_op');

-- CreateEnum
CREATE TYPE "discipline" AS ENUM ('backend', 'frontend', 'full_stack', 'mobile', 'infrastructure', 'data', 'machine_learning', 'embedded', 'security', 'qa_automation');

-- CreateEnum
CREATE TYPE "duration_bucket" AS ENUM ('4', '8', '12_plus', 'unspecified');

-- CreateEnum
CREATE TYPE "experience_level" AS ENUM ('student', 'new_grad', 'junior');

-- CreateEnum
CREATE TYPE "application_mode" AS ENUM ('quick_apply', 'full_build');

-- CreateEnum
CREATE TYPE "source_provider" AS ENUM ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'company_site', 'manual');

-- CreateEnum
CREATE TYPE "source_integration_status" AS ENUM ('planned', 'not_configured', 'connected', 'error');

-- CreateEnum
CREATE TYPE "discovery_status" AS ENUM ('new', 'reviewed', 'shortlisted', 'dismissed', 'expired');

-- CreateEnum
CREATE TYPE "automation_mode" AS ENUM ('approval_required', 'quick_generate', 'notify_only');

-- CreateEnum
CREATE TYPE "notification_channel" AS ENUM ('telegram');

-- CreateEnum
CREATE TYPE "notification_cadence" AS ENUM ('immediate', 'daily_digest');

-- CreateEnum
CREATE TYPE "preparation_status" AS ENUM ('not_started', 'queued', 'generating', 'needs_review', 'prepared', 'failed');

-- CreateEnum
CREATE TYPE "submission_status" AS ENUM ('not_submitted', 'submitted', 'interviewing', 'offer', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "application_event_type" AS ENUM ('created', 'mode_changed', 'preparation_status_changed', 'submission_status_changed', 'submission_recorded', 'artifact_linked', 'note_updated');

-- CreateEnum
CREATE TYPE "run_kind" AS ENUM ('resume', 'cover_letter', 'project', 'full_build');

-- CreateEnum
CREATE TYPE "run_status" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "generation_status" AS ENUM ('draft', 'generating', 'ready', 'failed');

-- CreateEnum
CREATE TYPE "cover_letter_tone" AS ENUM ('formal', 'conversational', 'concise');

-- CreateEnum
CREATE TYPE "check_status" AS ENUM ('not_run', 'pending', 'passing', 'failing');

-- CreateEnum
CREATE TYPE "repository_visibility" AS ENUM ('private', 'public');

-- CreateEnum
CREATE TYPE "approval_channel" AS ENUM ('telegram', 'dashboard');

-- CreateEnum
CREATE TYPE "approval_decision" AS ENUM ('pending', 'full_build', 'quick_apply', 'skip', 'expired');

-- CreateTable
CREATE TABLE "job_sources" (
    "id" TEXT NOT NULL,
    "provider" "source_provider" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "integration_status" "source_integration_status" NOT NULL DEFAULT 'planned',
    "last_checked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_postings" (
    "id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "company" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "job_type" "job_type" NOT NULL,
    "duration_months" INTEGER,
    "term" TEXT,
    "disciplines" "discipline"[],
    "summary" TEXT NOT NULL DEFAULT '',
    "responsibilities" TEXT[],
    "qualifications" TEXT[],
    "posting_url" TEXT,
    "posted_at" TIMESTAMPTZ(3),
    "first_discovered_at" TIMESTAMPTZ(3) NOT NULL,
    "discovery_status" "discovery_status" NOT NULL DEFAULT 'new',
    "primary_source_id" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_postings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_locations" (
    "id" UUID NOT NULL,
    "job_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "city" TEXT NOT NULL,
    "province" "province" NOT NULL,
    "arrangement" "work_arrangement" NOT NULL,

    CONSTRAINT "job_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_observations" (
    "id" UUID NOT NULL,
    "job_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "external_id" TEXT,
    "source_url" TEXT,
    "raw_title" TEXT,
    "payload" JSONB,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_matches" (
    "job_id" TEXT NOT NULL,
    "fit_score" INTEGER NOT NULL,
    "matched_skills" TEXT[],
    "missing_skills" TEXT[],
    "reasons" TEXT[],
    "computed_at" TIMESTAMPTZ(3) NOT NULL,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "job_matches_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "search_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "min_fit_score" INTEGER NOT NULL DEFAULT 70,
    "automation_mode" "automation_mode" NOT NULL DEFAULT 'approval_required',
    "notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notification_channel" "notification_channel" NOT NULL DEFAULT 'telegram',
    "notification_cadence" "notification_cadence" NOT NULL DEFAULT 'immediate',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "search_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_criteria" (
    "profile_id" TEXT NOT NULL,
    "title_keywords" TEXT[],
    "excluded_title_keywords" TEXT[],
    "disciplines" "discipline"[],
    "job_types" "job_type"[],
    "durations" "duration_bucket"[],
    "provinces" "province"[],
    "arrangements" "work_arrangement"[],
    "include_remote_canada_wide" BOOLEAN NOT NULL DEFAULT true,
    "experience_levels" "experience_level"[],
    "max_years_experience" INTEGER,

    CONSTRAINT "profile_criteria_pkey" PRIMARY KEY ("profile_id")
);

-- CreateTable
CREATE TABLE "job_profile_evaluations" (
    "job_id" TEXT NOT NULL,
    "evaluated_at" TIMESTAMPTZ(3) NOT NULL,
    "notified_at" TIMESTAMPTZ(3),
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "job_profile_evaluations_pkey" PRIMARY KEY ("job_id")
);

-- CreateTable
CREATE TABLE "job_profile_matches" (
    "job_id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "job_profile_matches_pkey" PRIMARY KEY ("job_id","profile_id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "mode" "application_mode" NOT NULL,
    "preparation_status" "preparation_status" NOT NULL DEFAULT 'not_started',
    "submission_status" "submission_status" NOT NULL DEFAULT 'not_submitted',
    "submitted_at" TIMESTAMPTZ(3),
    "resume_id" TEXT,
    "cover_letter_id" TEXT,
    "project_id" TEXT,
    "notes" TEXT NOT NULL DEFAULT '',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_events" (
    "id" UUID NOT NULL,
    "application_id" TEXT NOT NULL,
    "type" "application_event_type" NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "message" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "application_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_runs" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "kind" "run_kind" NOT NULL,
    "status" "run_status" NOT NULL DEFAULT 'queued',
    "started_at" TIMESTAMPTZ(3) NOT NULL,
    "finished_at" TIMESTAMPTZ(3),
    "summary" TEXT NOT NULL DEFAULT '',
    "error_message" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_artifacts" (
    "id" TEXT NOT NULL,
    "application_id" TEXT,
    "job_id" TEXT,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "generation_status" "generation_status" NOT NULL DEFAULT 'draft',
    "base_template" TEXT NOT NULL,
    "highlighted_skills" TEXT[],
    "page_count" INTEGER,
    "storage_key" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cover_letter_artifacts" (
    "id" TEXT NOT NULL,
    "application_id" TEXT,
    "job_id" TEXT,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "generation_status" "generation_status" NOT NULL DEFAULT 'draft',
    "base_template" TEXT NOT NULL,
    "tone" "cover_letter_tone" NOT NULL,
    "word_count" INTEGER,
    "storage_key" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cover_letter_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "technologies" TEXT[],
    "repo_owner" TEXT NOT NULL,
    "repo_name" TEXT NOT NULL,
    "repo_visibility" "repository_visibility" NOT NULL DEFAULT 'private',
    "repo_published" BOOLEAN NOT NULL DEFAULT false,
    "repo_url" TEXT,
    "build_status" "check_status" NOT NULL DEFAULT 'not_run',
    "test_status" "check_status" NOT NULL DEFAULT 'not_run',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_jobs" (
    "project_id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_jobs_pkey" PRIMARY KEY ("project_id","job_id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "channel" "approval_channel" NOT NULL,
    "decision" "approval_decision" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ(3) NOT NULL,
    "responded_at" TIMESTAMPTZ(3),
    "telegram_chat_id" TEXT,
    "telegram_message_id" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_sources_provider_key" ON "job_sources"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "job_postings_dedupe_key_key" ON "job_postings"("dedupe_key");

-- CreateIndex
CREATE INDEX "job_postings_discovery_status_idx" ON "job_postings"("discovery_status");

-- CreateIndex
CREATE INDEX "job_postings_first_discovered_at_idx" ON "job_postings"("first_discovered_at" DESC);

-- CreateIndex
CREATE INDEX "job_postings_job_type_idx" ON "job_postings"("job_type");

-- CreateIndex
CREATE INDEX "job_locations_province_idx" ON "job_locations"("province");

-- CreateIndex
CREATE UNIQUE INDEX "job_locations_job_id_position_key" ON "job_locations"("job_id", "position");

-- CreateIndex
CREATE INDEX "source_observations_job_id_idx" ON "source_observations"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_observations_source_id_external_id_key" ON "source_observations"("source_id", "external_id");

-- CreateIndex
CREATE INDEX "job_matches_fit_score_idx" ON "job_matches"("fit_score" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "search_profiles_name_key" ON "search_profiles"("name");

-- CreateIndex
CREATE INDEX "search_profiles_enabled_idx" ON "search_profiles"("enabled");

-- CreateIndex
CREATE INDEX "job_profile_matches_profile_id_idx" ON "job_profile_matches"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_profile_matches_job_id_rank_key" ON "job_profile_matches"("job_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "applications_job_id_key" ON "applications"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_resume_id_key" ON "applications"("resume_id");

-- CreateIndex
CREATE UNIQUE INDEX "applications_cover_letter_id_key" ON "applications"("cover_letter_id");

-- CreateIndex
CREATE INDEX "applications_preparation_status_idx" ON "applications"("preparation_status");

-- CreateIndex
CREATE INDEX "applications_submission_status_idx" ON "applications"("submission_status");

-- CreateIndex
CREATE INDEX "applications_updated_at_idx" ON "applications"("updated_at" DESC);

-- CreateIndex
CREATE INDEX "application_events_application_id_occurred_at_idx" ON "application_events"("application_id", "occurred_at");

-- CreateIndex
CREATE INDEX "workflow_runs_application_id_started_at_idx" ON "workflow_runs"("application_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "workflow_runs_status_idx" ON "workflow_runs"("status");

-- CreateIndex
CREATE INDEX "resume_artifacts_job_id_idx" ON "resume_artifacts"("job_id");

-- CreateIndex
CREATE INDEX "resume_artifacts_created_at_idx" ON "resume_artifacts"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "resume_artifacts_application_id_version_key" ON "resume_artifacts"("application_id", "version");

-- CreateIndex
CREATE INDEX "cover_letter_artifacts_job_id_idx" ON "cover_letter_artifacts"("job_id");

-- CreateIndex
CREATE INDEX "cover_letter_artifacts_created_at_idx" ON "cover_letter_artifacts"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cover_letter_artifacts_application_id_version_key" ON "cover_letter_artifacts"("application_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "projects_repo_owner_repo_name_key" ON "projects"("repo_owner", "repo_name");

-- CreateIndex
CREATE INDEX "project_jobs_job_id_idx" ON "project_jobs"("job_id");

-- CreateIndex
CREATE INDEX "approval_requests_job_id_idx" ON "approval_requests"("job_id");

-- CreateIndex
CREATE INDEX "approval_requests_decision_requested_at_idx" ON "approval_requests"("decision", "requested_at" DESC);

-- AddForeignKey
ALTER TABLE "job_locations" ADD CONSTRAINT "job_locations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "job_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_criteria" ADD CONSTRAINT "profile_criteria_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "search_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_profile_evaluations" ADD CONSTRAINT "job_profile_evaluations_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_profile_matches" ADD CONSTRAINT "job_profile_matches_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_profile_evaluations"("job_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_profile_matches" ADD CONSTRAINT "job_profile_matches_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "search_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resume_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_cover_letter_id_fkey" FOREIGN KEY ("cover_letter_id") REFERENCES "cover_letter_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_events" ADD CONSTRAINT "application_events_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_artifacts" ADD CONSTRAINT "resume_artifacts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_artifacts" ADD CONSTRAINT "resume_artifacts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cover_letter_artifacts" ADD CONSTRAINT "cover_letter_artifacts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cover_letter_artifacts" ADD CONSTRAINT "cover_letter_artifacts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_jobs" ADD CONSTRAINT "project_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_jobs" ADD CONSTRAINT "project_jobs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema language cannot express.
-- Prisma does not manage CHECK constraints or partial indexes; keep these in
-- sync by hand when the related columns change.
-- ---------------------------------------------------------------------------

-- Scores and limits
ALTER TABLE "job_matches" ADD CONSTRAINT "job_matches_fit_score_range" CHECK ("fit_score" BETWEEN 0 AND 100);
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_min_fit_score_range" CHECK ("min_fit_score" BETWEEN 0 AND 100);
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_name_not_blank" CHECK (btrim("name") <> '');
ALTER TABLE "profile_criteria" ADD CONSTRAINT "profile_criteria_max_years_range" CHECK ("max_years_experience" IS NULL OR "max_years_experience" BETWEEN 0 AND 15);
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_duration_range" CHECK ("duration_months" IS NULL OR "duration_months" BETWEEN 1 AND 24);
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_dedupe_key_not_blank" CHECK (btrim("dedupe_key") <> '');
ALTER TABLE "job_locations" ADD CONSTRAINT "job_locations_position_non_negative" CHECK ("position" >= 0);
ALTER TABLE "job_profile_matches" ADD CONSTRAINT "job_profile_matches_rank_non_negative" CHECK ("rank" >= 0);
ALTER TABLE "resume_artifacts" ADD CONSTRAINT "resume_artifacts_page_count_positive" CHECK ("page_count" IS NULL OR "page_count" >= 1);
ALTER TABLE "cover_letter_artifacts" ADD CONSTRAINT "cover_letter_artifacts_word_count_non_negative" CHECK ("word_count" IS NULL OR "word_count" >= 0);

-- Submission integrity: a submission date exists exactly when the status says
-- the application reached the employer. "withdrawn" may happen either way.
ALTER TABLE "applications" ADD CONSTRAINT "applications_submission_consistency" CHECK (
  ("submission_status" = 'not_submitted' AND "submitted_at" IS NULL)
  OR ("submission_status" IN ('submitted', 'interviewing', 'offer', 'rejected') AND "submitted_at" IS NOT NULL)
  OR "submission_status" = 'withdrawn'
);

-- Workflow runs: finished runs have an end time after their start; active runs do not.
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_finish_after_start" CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at");
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_active_unfinished" CHECK ("status" NOT IN ('queued', 'running') OR "finished_at" IS NULL);

-- Approvals: pending requests have no response, and each job has at most one pending request.
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_pending_unanswered" CHECK ("decision" <> 'pending' OR "responded_at" IS NULL);
CREATE UNIQUE INDEX "approval_requests_one_pending_per_job" ON "approval_requests" ("job_id") WHERE "decision" = 'pending';

-- Projects cannot claim to be published without a repository URL.
ALTER TABLE "projects" ADD CONSTRAINT "projects_published_requires_url" CHECK (NOT "repo_published" OR "repo_url" IS NOT NULL);
