-- Milestone 3D: universal career sources. Additive only.
-- employer_boards becomes the general "career source" table: the four ATS
-- providers, Workday career sites (token "<tenant host>/<site>") and generic
-- company career pages (provider company_site, token "<host><path>").

-- Workday job source row, mirroring the existing ATS source rows' settings.
INSERT INTO "job_sources" ("id", "provider", "label", "description", "enabled", "integration_status", "updated_at")
SELECT 'src-workday', 'workday', 'Workday career sites', 'Public Workday career sites (*.myworkdayjobs.com) for employers you monitor.', g."enabled", g."integration_status", CURRENT_TIMESTAMP
FROM "job_sources" g WHERE g."provider" = 'greenhouse'
ON CONFLICT ("provider") DO NOTHING;
UPDATE "job_sources" c SET "enabled" = g."enabled", "integration_status" = g."integration_status", "updated_at" = CURRENT_TIMESTAMP
FROM "job_sources" g WHERE c."provider" = 'company_site' AND g."provider" = 'greenhouse';

-- Source metadata
ALTER TABLE "employer_boards"
  ADD COLUMN "locale" TEXT,
  ADD COLUMN "extraction_strategy" TEXT,
  ADD COLUMN "source_config" JSONB,
  ADD COLUMN "last_complete_snapshot_at" TIMESTAMPTZ(3);

ALTER TABLE "board_sync_runs"
  ADD COLUMN "extraction_strategy" TEXT,
  ADD COLUMN "pages_fetched" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "description_complete" BOOLEAN;

ALTER TABLE "discovery_candidates"
  ADD COLUMN "locale" TEXT,
  ADD COLUMN "extraction_strategy" TEXT,
  ADD COLUMN "source_config" JSONB;

-- Token rules per provider (ATS tokens unchanged).
ALTER TABLE "employer_boards" DROP CONSTRAINT "employer_boards_ats_provider";
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_source_provider"
  CHECK ("provider"::text IN ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'company_site'));
ALTER TABLE "employer_boards" DROP CONSTRAINT "employer_boards_token_format";
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_token_format" CHECK (
  CASE "provider"::text
    WHEN 'workday' THEN "board_token" ~ '^[a-z0-9][a-z0-9.-]{0,120}(/[a-z0-9][a-z0-9._-]{0,120}){1,2}$'
    WHEN 'company_site' THEN "board_token" ~ '^[a-z0-9][a-z0-9.-]{0,252}(/[A-Za-z0-9._~%!$&''()*+,;=:@-]*)*$' AND length("board_token") <= 500
    ELSE "board_token" ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
  END);
ALTER TABLE "employer_boards" ADD CONSTRAINT "employer_boards_strategy" CHECK (
  "extraction_strategy" IS NULL OR "extraction_strategy" IN ('ats_api', 'workday_cxs', 'json_ld', 'sitemap', 'static_html', 'rendered'));

ALTER TABLE "discovery_candidates" DROP CONSTRAINT "discovery_candidates_ats_provider";
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_source_provider"
  CHECK ("provider"::text IN ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'company_site'));
ALTER TABLE "discovery_candidates" DROP CONSTRAINT "discovery_candidates_token_format";
ALTER TABLE "discovery_candidates" ADD CONSTRAINT "discovery_candidates_token_format" CHECK (
  CASE "provider"::text
    WHEN 'workday' THEN "board_token" ~ '^[a-z0-9][a-z0-9.-]{0,120}(/[a-z0-9][a-z0-9._-]{0,120}){1,2}$'
    WHEN 'company_site' THEN "board_token" ~ '^[a-z0-9][a-z0-9.-]{0,252}(/[A-Za-z0-9._~%!$&''()*+,;=:@-]*)*$' AND length("board_token") <= 500
    ELSE "board_token" ~ '^[a-z0-9][a-z0-9._-]{0,99}$'
  END);

ALTER TABLE "board_sync_runs" ADD CONSTRAINT "board_sync_runs_pages_non_negative" CHECK ("pages_fetched" >= 0);

CREATE INDEX "employer_boards_provider_idx" ON "employer_boards" ("provider");
