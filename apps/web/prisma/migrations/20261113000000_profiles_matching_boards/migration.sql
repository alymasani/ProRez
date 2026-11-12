-- CreateEnum
CREATE TYPE "profile_match_status" AS ENUM ('eligible', 'needs_review');

-- AlterEnum
ALTER TYPE "job_type" ADD VALUE 'junior';

-- DropForeignKey
ALTER TABLE "job_profile_matches" DROP CONSTRAINT "job_profile_matches_profile_id_fkey";

-- DropIndex
DROP INDEX "search_profiles_enabled_idx";

-- DropIndex
DROP INDEX "search_profiles_name_key";

-- AlterTable (backfilled: evaluations stored before 2B came from the hand-written 2A demo data)
ALTER TABLE "job_profile_evaluations" ADD COLUMN     "engine_version" TEXT NOT NULL DEFAULT '2a.fixture';
ALTER TABLE "job_profile_evaluations" ALTER COLUMN "engine_version" DROP DEFAULT;

-- AlterTable (existing matches point at version 1, created by the backfill below)
ALTER TABLE "job_profile_matches" ADD COLUMN     "profile_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "reasons" TEXT[],
ADD COLUMN     "relevance" INTEGER,
ADD COLUMN     "status" "profile_match_status" NOT NULL DEFAULT 'eligible';
ALTER TABLE "job_profile_matches" ALTER COLUMN "profile_version" DROP DEFAULT,
ALTER COLUMN "status" DROP DEFAULT;

-- AlterTable
ALTER TABLE "profile_criteria" ADD COLUMN     "exclude_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "include_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "search_profiles" ADD COLUMN     "archived_at" TIMESTAMPTZ(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "source_observations" ADD COLUMN     "board_id" UUID;

-- CreateTable
CREATE TABLE "search_profile_versions" (
    "id" UUID NOT NULL,
    "profile_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_profile_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employer_boards" (
    "id" UUID NOT NULL,
    "provider" "source_provider" NOT NULL,
    "employer_name" TEXT NOT NULL,
    "board_token" TEXT NOT NULL,
    "board_url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "poll_interval_minutes" INTEGER NOT NULL DEFAULT 360,
    "last_checked_at" TIMESTAMPTZ(3),
    "last_success_at" TIMESTAMPTZ(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error_at" TIMESTAMPTZ(3),
    "last_error_message" TEXT,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "employer_boards_pkey" PRIMARY KEY ("id")
);

-- Backfill: a version-1 snapshot (SearchProfileDraft shape) for every existing profile,
-- so existing and future matches can reference the criteria they were evaluated against.
INSERT INTO "search_profile_versions" ("id", "profile_id", "version", "snapshot", "created_at")
SELECT
  gen_random_uuid(),
  p."id",
  p."version",
  jsonb_build_object(
    'name', p."name",
    'description', p."description",
    'enabled', p."enabled",
    'minFitScore', p."min_fit_score",
    'automationMode', p."automation_mode",
    'notifications', jsonb_build_object(
      'enabled', p."notifications_enabled",
      'channel', p."notification_channel",
      'cadence', p."notification_cadence"
    ),
    'criteria', jsonb_build_object(
      'titleKeywords', to_jsonb(COALESCE(c."title_keywords", ARRAY[]::TEXT[])),
      'excludedTitleKeywords', to_jsonb(COALESCE(c."excluded_title_keywords", ARRAY[]::TEXT[])),
      'includeKeywords', to_jsonb(COALESCE(c."include_keywords", ARRAY[]::TEXT[])),
      'excludeKeywords', to_jsonb(COALESCE(c."exclude_keywords", ARRAY[]::TEXT[])),
      'disciplines', to_jsonb(COALESCE(c."disciplines", ARRAY[]::"discipline"[])),
      'jobTypes', to_jsonb(COALESCE(c."job_types", ARRAY[]::"job_type"[])),
      'durations', to_jsonb(COALESCE(c."durations", ARRAY[]::"duration_bucket"[])),
      'provinces', to_jsonb(COALESCE(c."provinces", ARRAY[]::"province"[])),
      'arrangements', to_jsonb(COALESCE(c."arrangements", ARRAY[]::"work_arrangement"[])),
      'includeRemoteCanadaWide', COALESCE(c."include_remote_canada_wide", true),
      'experienceLevels', to_jsonb(COALESCE(c."experience_levels", ARRAY[]::"experience_level"[])),
      'maxYearsExperience', c."max_years_experience"
    )
  ),
  p."updated_at"
FROM "search_profiles" p
LEFT JOIN "profile_criteria" c ON c."profile_id" = p."id";

-- CreateIndex
CREATE UNIQUE INDEX "search_profile_versions_profile_id_version_key" ON "search_profile_versions"("profile_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "employer_boards_board_url_key" ON "employer_boards"("board_url");

-- CreateIndex
CREATE INDEX "employer_boards_enabled_last_checked_at_idx" ON "employer_boards"("enabled", "last_checked_at");

-- CreateIndex
CREATE UNIQUE INDEX "employer_boards_provider_board_token_key" ON "employer_boards"("provider", "board_token");

-- CreateIndex
CREATE INDEX "search_profiles_enabled_archived_at_idx" ON "search_profiles"("enabled", "archived_at");

-- CreateIndex
CREATE INDEX "source_observations_board_id_idx" ON "source_observations"("board_id");

-- AddForeignKey
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "employer_boards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "search_profile_versions" ADD CONSTRAINT "search_profile_versions_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "search_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_profile_matches" ADD CONSTRAINT "job_profile_matches_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "search_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_profile_matches" ADD CONSTRAINT "job_profile_matches_profile_id_profile_version_fkey" FOREIGN KEY ("profile_id", "profile_version") REFERENCES "search_profile_versions"("profile_id", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_provider_fkey" FOREIGN KEY ("provider") REFERENCES "job_sources"("provider") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Reference data: one job source per provider. These are provider definitions,
-- not demo data, so they exist in every environment (boards reference them).
-- ---------------------------------------------------------------------------
INSERT INTO "job_sources" ("id", "provider", "label", "description", "enabled", "integration_status", "updated_at") VALUES
  ('src-greenhouse', 'greenhouse', 'Greenhouse job boards', 'Public Greenhouse job board API for employers you choose to monitor.', false, 'planned', CURRENT_TIMESTAMP),
  ('src-lever', 'lever', 'Lever postings', 'Public Lever postings API for employers you choose to monitor.', false, 'planned', CURRENT_TIMESTAMP),
  ('src-ashby', 'ashby', 'Ashby job boards', 'Public Ashby job board API for employers you choose to monitor.', false, 'planned', CURRENT_TIMESTAMP),
  ('src-smartrecruiters', 'smartrecruiters', 'SmartRecruiters postings', 'Public SmartRecruiters posting API for employers you choose to monitor.', false, 'planned', CURRENT_TIMESTAMP),
  ('src-company-site', 'company_site', 'Company career sites', 'Employer career pages that are not on a supported ATS.', false, 'planned', CURRENT_TIMESTAMP),
  ('src-manual', 'manual', 'Manual submissions', 'Jobs you paste in yourself via the Add job form.', true, 'planned', CURRENT_TIMESTAMP)
ON CONFLICT ("provider") DO NOTHING;

-- ---------------------------------------------------------------------------
-- Constraints Prisma cannot express (see the note in the init migration).
-- ---------------------------------------------------------------------------

-- Profiles: case-insensitive unique names among non-archived profiles.
CREATE UNIQUE INDEX "search_profiles_active_name_key" ON "search_profiles" (lower(btrim("name"))) WHERE "archived_at" IS NULL;
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_version_positive" CHECK ("version" >= 1);
-- Archived profiles are never evaluated.
ALTER TABLE "search_profiles" ADD CONSTRAINT "search_profiles_archived_disabled" CHECK ("archived_at" IS NULL OR NOT "enabled");
ALTER TABLE "search_profile_versions" ADD CONSTRAINT "search_profile_versions_version_positive" CHECK ("version" >= 1);
ALTER TABLE "search_profile_versions" ADD CONSTRAINT "search_profile_versions_snapshot_object" CHECK (jsonb_typeof("snapshot") = 'object');

-- Matches
ALTER TABLE "job_profile_matches" ADD CONSTRAINT "job_profile_matches_relevance_range" CHECK ("relevance" IS NULL OR "relevance" BETWEEN 0 AND 100);

-- Employer boards: ATS providers only, lowercase safe tokens, sane polling, consistent health fields.
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_ats_provider" CHECK ("provider" IN ('greenhouse', 'lever', 'ashby', 'smartrecruiters'));
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_token_format" CHECK ("board_token" ~ '^[a-z0-9][a-z0-9._-]{0,99}$');
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_employer_not_blank" CHECK (btrim("employer_name") <> '');
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_url_https" CHECK ("board_url" LIKE 'https://%');
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_poll_interval_range" CHECK ("poll_interval_minutes" BETWEEN 15 AND 10080);
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_failures_non_negative" CHECK ("consecutive_failures" >= 0);
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_success_after_check" CHECK ("last_success_at" IS NULL OR ("last_checked_at" IS NOT NULL AND "last_success_at" <= "last_checked_at"));
