-- Audit fix: an unstated work arrangement must not be treated as on-site.
-- Additive and non-destructive; existing rows keep arrangement_stated = true.
ALTER TABLE "job_locations" ADD COLUMN "arrangement_stated" BOOLEAN NOT NULL DEFAULT true;
