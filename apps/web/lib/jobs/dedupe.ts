/**
 * Canonical identity for a job posting, used to merge sightings of the same
 * role from different sources into one `job_postings` row.
 *
 * Format: `company|title|city-province`, each part slugified, e.g.
 * "northlight-robotics|software-engineering-intern-embedded-systems|waterloo-on".
 */
import type { JobLocation } from "../types";

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildDedupeKey(company: string, title: string, primaryLocation: JobLocation | null): string {
  const location = primaryLocation ? slugify(`${primaryLocation.city} ${primaryLocation.province ?? "canada"}`) : "unspecified";
  const key = [slugify(company), slugify(title), location].join("|");
  if (key.startsWith("|") || key.includes("||")) {
    throw new Error("Cannot build a dedupe key without a company and title.");
  }
  return key;
}
