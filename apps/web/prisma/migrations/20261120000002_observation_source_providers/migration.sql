-- Milestone 3D: job sightings from Workday career sites and company career
-- pages carry the same (provider, board token, posting id) identity as ATS
-- postings. Additive: widens the allowed providers; existing rows unaffected.
ALTER TABLE "source_observations" DROP CONSTRAINT "source_observations_ats_provider";
ALTER TABLE "source_observations" ADD CONSTRAINT "source_observations_ats_provider"
  CHECK ("ats_provider" IS NULL OR "ats_provider"::text IN ('greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workday', 'company_site'));
