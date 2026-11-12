-- Milestone 2C: persistent manual jobs, application tracking, settings, and
-- explicit internship-duration requirements.
--
-- Generated with `prisma migrate diff`, then edited by hand so that every
-- existing value is CONVERTED (never dropped) and every conversion that changes
-- meaning is recorded as an event or flagged for review:
--   discovery_status    new → discovered, shortlisted → saved,
--                       reviewed → discovered (logged in job_events)
--   preparation_status  needs_review / prepared → ready_for_review
--                       (logged in application_events)
--   profile durations   '4' → up_to_4 (identical behaviour: ≤ 4 months),
--                       '8' → legacy_5_to_8, '12_plus' → legacy_over_8,
--                       'unspecified' → unspecified. Affected profiles get a
--                       new version snapshot and duration_review_required.

-- ---------------------------------------------------------------------------
-- New enums
-- ---------------------------------------------------------------------------
CREATE TYPE "duration_requirement" AS ENUM ('exactly_4', 'up_to_4', '4_to_8', 'any', 'unspecified', 'legacy_5_to_8', 'legacy_over_8');
CREATE TYPE "job_origin" AS ENUM ('manual', 'automatic');
CREATE TYPE "salary_currency" AS ENUM ('CAD', 'USD');
CREATE TYPE "salary_period" AS ENUM ('hour', 'month', 'year');
CREATE TYPE "description_source" AS ENUM ('manual_submission', 'manual_edit', 'source_import');
CREATE TYPE "job_event_type" AS ENUM ('created', 'sighting_added', 'discovery_status_changed', 'details_updated', 'notes_updated', 'description_added', 'evaluation_changed');
CREATE TYPE "interview_stage" AS ENUM ('recruiter_screen', 'technical', 'take_home', 'onsite', 'final', 'other');

-- New values are only used by the application, never within this migration.
ALTER TYPE "application_event_type" ADD VALUE 'interview_recorded';
ALTER TYPE "application_event_type" ADD VALUE 'submission_date_changed';

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------
CREATE TABLE "job_description_snapshots" (
    "id" UUID NOT NULL,
    "job_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "source" "description_source" NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "job_description_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_events" (
    "id" UUID NOT NULL,
    "job_id" TEXT NOT NULL,
    "type" "job_event_type" NOT NULL,
    "from_value" TEXT,
    "to_value" TEXT,
    "message" TEXT,
    "data" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_demo" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "job_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "application_interviews" (
    "id" UUID NOT NULL,
    "application_id" TEXT NOT NULL,
    "stage" "interview_stage" NOT NULL,
    "occurred_on" DATE NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',
    "is_demo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_interviews_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "user_settings" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "version" INTEGER NOT NULL DEFAULT 1,
    "provinces" "province"[],
    "arrangements" "work_arrangement"[],
    "job_types" "job_type"[],
    "durations" "duration_requirement"[],
    "disciplines" "discipline"[],
    "include_remote_canada_wide" BOOLEAN NOT NULL DEFAULT true,
    "notifications_paused" BOOLEAN NOT NULL DEFAULT false,
    "default_notification_cadence" "notification_cadence" NOT NULL DEFAULT 'immediate',
    "default_application_mode" "application_mode" NOT NULL DEFAULT 'quick_apply',
    "default_automation_mode" "automation_mode" NOT NULL DEFAULT 'approval_required',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_settings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_description_snapshots_job_id_captured_at_idx" ON "job_description_snapshots"("job_id", "captured_at");
CREATE UNIQUE INDEX "job_description_snapshots_job_id_content_hash_key" ON "job_description_snapshots"("job_id", "content_hash");
CREATE INDEX "job_events_job_id_occurred_at_idx" ON "job_events"("job_id", "occurred_at");
CREATE INDEX "application_interviews_application_id_occurred_on_idx" ON "application_interviews"("application_id", "occurred_on");

ALTER TABLE "job_description_snapshots" ADD CONSTRAINT "job_description_snapshots_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job_postings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "application_interviews" ADD CONSTRAINT "application_interviews_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Discovery status: new → discovered, shortlisted → saved, reviewed → discovered
-- ---------------------------------------------------------------------------
INSERT INTO "job_events" ("id", "job_id", "type", "from_value", "to_value", "message", "is_demo")
SELECT gen_random_uuid(), "id", 'discovery_status_changed', 'reviewed', 'discovered',
       'Converted by migration: "reviewed" is no longer a separate discovery status.', "is_demo"
FROM "job_postings" WHERE "discovery_status" = 'reviewed';

CREATE TYPE "discovery_status_new" AS ENUM ('discovered', 'saved', 'dismissed', 'expired');
ALTER TABLE "job_postings" ALTER COLUMN "discovery_status" DROP DEFAULT;
ALTER TABLE "job_postings" ALTER COLUMN "discovery_status" TYPE "discovery_status_new" USING (
  CASE "discovery_status"::text
    WHEN 'new' THEN 'discovered'
    WHEN 'reviewed' THEN 'discovered'
    WHEN 'shortlisted' THEN 'saved'
    ELSE "discovery_status"::text
  END
)::"discovery_status_new";
ALTER TYPE "discovery_status" RENAME TO "discovery_status_old";
ALTER TYPE "discovery_status_new" RENAME TO "discovery_status";
DROP TYPE "discovery_status_old";
ALTER TABLE "job_postings" ALTER COLUMN "discovery_status" SET DEFAULT 'discovered';

-- ---------------------------------------------------------------------------
-- Preparation status: needs_review / prepared → ready_for_review
-- ---------------------------------------------------------------------------
INSERT INTO "application_events" ("id", "application_id", "type", "from_value", "to_value", "message", "is_demo")
SELECT gen_random_uuid(), "id", 'preparation_status_changed', "preparation_status"::text, 'ready_for_review',
       'Converted by migration: "' || "preparation_status"::text || '" is now "ready_for_review".', "is_demo"
FROM "applications" WHERE "preparation_status" IN ('needs_review', 'prepared');

CREATE TYPE "preparation_status_new" AS ENUM ('not_started', 'awaiting_approval', 'queued', 'generating', 'ready_for_review', 'failed');
ALTER TABLE "applications" ALTER COLUMN "preparation_status" DROP DEFAULT;
ALTER TABLE "applications" ALTER COLUMN "preparation_status" TYPE "preparation_status_new" USING (
  CASE "preparation_status"::text
    WHEN 'needs_review' THEN 'ready_for_review'
    WHEN 'prepared' THEN 'ready_for_review'
    ELSE "preparation_status"::text
  END
)::"preparation_status_new";
ALTER TYPE "preparation_status" RENAME TO "preparation_status_old";
ALTER TYPE "preparation_status_new" RENAME TO "preparation_status";
DROP TYPE "preparation_status_old";
ALTER TABLE "applications" ALTER COLUMN "preparation_status" SET DEFAULT 'not_started';

-- ---------------------------------------------------------------------------
-- Jobs: origin, details version, description, experience, salary, notes
-- ---------------------------------------------------------------------------
ALTER TABLE "job_postings" ADD COLUMN     "description" TEXT,
ADD COLUMN     "experience_requirement" TEXT,
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "origin" "job_origin" NOT NULL DEFAULT 'automatic',
ADD COLUMN     "salary_currency" "salary_currency",
ADD COLUMN     "salary_max" INTEGER,
ADD COLUMN     "salary_min" INTEGER,
ADD COLUMN     "salary_period" "salary_period",
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

UPDATE "job_postings" SET "origin" = 'manual' WHERE "primary_source_id" = 'src-manual';

CREATE INDEX "job_postings_origin_idx" ON "job_postings"("origin");

-- ---------------------------------------------------------------------------
-- Source observations: canonical URL and ATS posting identity
-- ---------------------------------------------------------------------------
ALTER TABLE "source_observations" ADD COLUMN     "ats_board_token" TEXT,
ADD COLUMN     "ats_posting_id" TEXT,
ADD COLUMN     "ats_provider" "source_provider",
ADD COLUMN     "canonical_url" TEXT;

CREATE UNIQUE INDEX "source_observations_canonical_url_key" ON "source_observations"("canonical_url");
CREATE UNIQUE INDEX "source_observations_ats_provider_ats_board_token_ats_postin_key" ON "source_observations"("ats_provider", "ats_board_token", "ats_posting_id");

-- ---------------------------------------------------------------------------
-- Profile durations: explicit requirements, behaviour preserved, flagged for review
-- ---------------------------------------------------------------------------
ALTER TABLE "search_profiles" ADD COLUMN     "duration_review_required" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "profile_criteria" ADD COLUMN "durations_converted" "duration_requirement"[];

UPDATE "profile_criteria" SET "durations_converted" = COALESCE(ARRAY(
  SELECT (CASE d::text
    WHEN '4' THEN 'up_to_4'
    WHEN '8' THEN 'legacy_5_to_8'
    WHEN '12_plus' THEN 'legacy_over_8'
    ELSE 'unspecified'
  END)::"duration_requirement"
  FROM unnest("durations") WITH ORDINALITY AS t(d, n)
  ORDER BY n
), ARRAY[]::"duration_requirement"[]);

-- Profiles whose stated-duration buckets changed name: new immutable version + review flag.
CREATE TEMPORARY TABLE "_converted_profiles" AS
SELECT "profile_id" FROM "profile_criteria"
WHERE "durations"::text[] && ARRAY['4', '8', '12_plus'];

UPDATE "search_profiles" SET "version" = "version" + 1, "duration_review_required" = true, "updated_at" = CURRENT_TIMESTAMP
WHERE "id" IN (SELECT "profile_id" FROM "_converted_profiles");

INSERT INTO "search_profile_versions" ("id", "profile_id", "version", "snapshot", "created_at")
SELECT gen_random_uuid(), sp."id", sp."version",
       jsonb_set(COALESCE(prev."snapshot", jsonb_build_object('criteria', '{}'::jsonb)), '{criteria,durations}', to_jsonb(pc."durations_converted"::text[]), true),
       CURRENT_TIMESTAMP
FROM "search_profiles" sp
JOIN "profile_criteria" pc ON pc."profile_id" = sp."id"
LEFT JOIN "search_profile_versions" prev ON prev."profile_id" = sp."id" AND prev."version" = sp."version" - 1
WHERE sp."id" IN (SELECT "profile_id" FROM "_converted_profiles");

DROP TABLE "_converted_profiles";

ALTER TABLE "profile_criteria" DROP COLUMN "durations";
ALTER TABLE "profile_criteria" RENAME COLUMN "durations_converted" TO "durations";
DROP TYPE "duration_bucket";

-- ---------------------------------------------------------------------------
-- Hand-written constraints (Prisma does not manage these; keep when editing)
-- ---------------------------------------------------------------------------
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_version_positive" CHECK ("version" >= 1);
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_company_not_blank" CHECK (btrim("company") <> '');
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_title_not_blank" CHECK (btrim("title") <> '');
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_description_not_blank" CHECK ("description" IS NULL OR btrim("description") <> '');
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_posting_url_http" CHECK ("posting_url" IS NULL OR "posting_url" ~ '^https?://');
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_notes_length" CHECK (char_length("notes") <= 10000);
-- Salary: amounts are non-negative and ordered; currency and period exist exactly when an amount does.
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_salary_non_negative" CHECK (("salary_min" IS NULL OR "salary_min" >= 0) AND ("salary_max" IS NULL OR "salary_max" >= 0));
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_salary_ordered" CHECK ("salary_min" IS NULL OR "salary_max" IS NULL OR "salary_min" <= "salary_max");
ALTER TABLE "job_postings" ADD CONSTRAINT "job_postings_salary_complete" CHECK (
  ("salary_min" IS NULL AND "salary_max" IS NULL AND "salary_currency" IS NULL AND "salary_period" IS NULL)
  OR (("salary_min" IS NOT NULL OR "salary_max" IS NOT NULL) AND "salary_currency" IS NOT NULL AND "salary_period" IS NOT NULL)
);

-- Observations: ATS identity is all-or-nothing, ATS providers only; canonical URLs are http(s).
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_ats_identity_complete" CHECK (
  ("ats_provider" IS NULL AND "ats_board_token" IS NULL AND "ats_posting_id" IS NULL)
  OR ("ats_provider" IS NOT NULL AND "ats_board_token" IS NOT NULL AND "ats_posting_id" IS NOT NULL)
);
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_ats_provider" CHECK ("ats_provider" IS NULL OR "ats_provider" IN ('greenhouse', 'lever', 'ashby', 'smartrecruiters'));
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_canonical_url_http" CHECK ("canonical_url" IS NULL OR "canonical_url" ~ '^https?://');

ALTER TABLE "job_description_snapshots" ADD CONSTRAINT "job_description_snapshots_content_not_blank" CHECK (btrim("content") <> '');
ALTER TABLE "job_description_snapshots" ADD CONSTRAINT "job_description_snapshots_hash_format" CHECK ("content_hash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "application_interviews" ADD CONSTRAINT "application_interviews_notes_length" CHECK (char_length("notes") <= 2000);
ALTER TABLE "applications" ADD CONSTRAINT "applications_notes_length" CHECK (char_length("notes") <= 10000);

ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_singleton" CHECK ("id" = 'default');
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_version_positive" CHECK ("version" >= 1);

-- Append-only history: captured descriptions and application events can never be edited.
CREATE FUNCTION "prorez_reject_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'rows in % are immutable', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "job_description_snapshots_immutable" BEFORE UPDATE ON "job_description_snapshots"
  FOR EACH ROW EXECUTE FUNCTION "prorez_reject_update"();
CREATE TRIGGER "application_events_immutable" BEFORE UPDATE ON "application_events"
  FOR EACH ROW EXECUTE FUNCTION "prorez_reject_update"();
CREATE TRIGGER "job_events_immutable" BEFORE UPDATE ON "job_events"
  FOR EACH ROW EXECUTE FUNCTION "prorez_reject_update"();
