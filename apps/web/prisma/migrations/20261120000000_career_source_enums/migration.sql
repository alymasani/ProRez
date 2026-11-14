-- Milestone 3D: new enum values (separate migration: PostgreSQL does not allow
-- a newly added enum value to be used in the same transaction).
ALTER TYPE "source_provider" ADD VALUE IF NOT EXISTS 'workday';
ALTER TYPE "discovery_candidate_status" ADD VALUE IF NOT EXISTS 'unsupported';
ALTER TYPE "discovery_source" ADD VALUE IF NOT EXISTS 'career_page';
ALTER TYPE "discovery_source" ADD VALUE IF NOT EXISTS 'company_domain';
ALTER TYPE "discovery_evidence_type" ADD VALUE IF NOT EXISTS 'career_page_extraction';
ALTER TYPE "discovery_evidence_type" ADD VALUE IF NOT EXISTS 'routed_to_ats';
