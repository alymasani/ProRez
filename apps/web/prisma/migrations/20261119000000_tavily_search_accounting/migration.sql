-- Additive accounting for pluggable discovery search providers.
ALTER TABLE "discovery_runs"
ADD COLUMN "search_provider" TEXT,
ADD COLUMN "search_credits" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "discovery_runs"
ADD CONSTRAINT "discovery_runs_search_credits_non_negative"
CHECK ("search_credits" >= 0);

CREATE INDEX "discovery_runs_search_provider_started_at_idx"
ON "discovery_runs" ("search_provider", "started_at" DESC);
