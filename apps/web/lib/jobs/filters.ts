/**
 * Pure job search & filter logic. No React, no Next.js — unit tested in
 * `filters.test.ts`. Filter state round-trips through URL search params so
 * results are shareable and survive navigation.
 */
import {
  DISCIPLINES,
  DURATION_BUCKETS,
  JOB_TYPES,
  PROVINCES,
  WORK_ARRANGEMENTS,
  type Discipline,
  type DurationBucket,
  type JobType,
  type JobWithMatch,
  type Province,
  type WorkArrangement,
} from "../types";

export const SORT_OPTIONS = ["newest", "fit"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export interface JobFilters {
  query: string;
  provinces: Province[];
  arrangements: WorkArrangement[];
  jobTypes: JobType[];
  durations: DurationBucket[];
  disciplines: Discipline[];
  /** Hide dismissed and expired postings unless explicitly included. */
  includeInactive: boolean;
  sort: SortOption;
}

export const EMPTY_FILTERS: JobFilters = {
  query: "",
  provinces: [],
  arrangements: [],
  jobTypes: [],
  durations: [],
  disciplines: [],
  includeInactive: false,
  sort: "newest",
};

export function durationBucket(months: number | null): DurationBucket {
  if (months === null) return "unspecified";
  if (months <= 4) return "4";
  if (months <= 8) return "8";
  return "12_plus";
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

function matchesQuery({ job }: JobWithMatch, query: string): boolean {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const haystack = normalize(
    [
      job.title,
      job.company,
      job.summary,
      ...job.locations.map((l) => `${l.city} ${l.province ?? "Canada"}`),
    ].join(" "),
  );
  return terms.every((term) => haystack.includes(term));
}

/** Empty selection means "no constraint" for every multi-select facet. */
function anyOf<T>(selected: readonly T[], values: readonly T[]): boolean {
  return selected.length === 0 || values.some((v) => selected.includes(v));
}

export function isInactive({ job }: JobWithMatch): boolean {
  return job.discoveryStatus === "dismissed" || job.discoveryStatus === "expired";
}

export function filterJobs(items: readonly JobWithMatch[], filters: JobFilters): JobWithMatch[] {
  const result = items.filter((item) => {
    const { job } = item;
    if (!filters.includeInactive && isInactive(item)) return false;
    if (!matchesQuery(item, filters.query)) return false;
    // A province-less (Canada-wide remote) location is open in every province.
    if (
      filters.provinces.length > 0 &&
      !job.locations.some((l) => l.province === null || filters.provinces.includes(l.province))
    ) {
      return false;
    }
    if (!anyOf(filters.arrangements, job.locations.map((l) => l.arrangement))) return false;
    if (!anyOf(filters.jobTypes, [job.jobType])) return false;
    if (!anyOf(filters.durations, [durationBucket(job.durationMonths)])) return false;
    if (!anyOf(filters.disciplines, job.disciplines)) return false;
    return true;
  });

  return result.sort((a, b) => compareJobs(a, b, filters.sort));
}

function compareJobs(a: JobWithMatch, b: JobWithMatch, sort: SortOption): number {
  const byNewest = b.job.discoveredAt.localeCompare(a.job.discoveredAt);
  if (sort === "fit") {
    // Unscored jobs sort last.
    const scoreA = a.match?.fitScore ?? -1;
    const scoreB = b.match?.fitScore ?? -1;
    return scoreB - scoreA || byNewest;
  }
  return byNewest || a.job.id.localeCompare(b.job.id);
}

export function countActiveFilters(filters: JobFilters): number {
  return (
    filters.provinces.length +
    filters.arrangements.length +
    filters.jobTypes.length +
    filters.durations.length +
    filters.disciplines.length +
    (filters.includeInactive ? 1 : 0)
  );
}

// ---------------------------------------------------------------------------
// URL serialization
// ---------------------------------------------------------------------------

/** Minimal read interface satisfied by URLSearchParams and Next's ReadonlyURLSearchParams. */
export interface SearchParamsReader {
  get(name: string): string | null;
}

const PARAM = {
  query: "q",
  provinces: "province",
  arrangements: "arrangement",
  jobTypes: "type",
  durations: "duration",
  disciplines: "discipline",
  includeInactive: "inactive",
  sort: "sort",
} as const;

function parseList<T extends string>(raw: string | null, allowed: readonly T[]): T[] {
  if (!raw) return [];
  const values = raw.split(",").filter((v): v is T => (allowed as readonly string[]).includes(v));
  return Array.from(new Set(values));
}

export function parseFilters(params: SearchParamsReader): JobFilters {
  const sort = params.get(PARAM.sort);
  return {
    query: params.get(PARAM.query) ?? "",
    provinces: parseList(params.get(PARAM.provinces), PROVINCES),
    arrangements: parseList(params.get(PARAM.arrangements), WORK_ARRANGEMENTS),
    jobTypes: parseList(params.get(PARAM.jobTypes), JOB_TYPES),
    durations: parseList(params.get(PARAM.durations), DURATION_BUCKETS),
    disciplines: parseList(params.get(PARAM.disciplines), DISCIPLINES),
    includeInactive: params.get(PARAM.includeInactive) === "1",
    sort: (SORT_OPTIONS as readonly string[]).includes(sort ?? "") ? (sort as SortOption) : "newest",
  };
}

export function serializeFilters(filters: JobFilters): URLSearchParams {
  const params = new URLSearchParams();
  const query = filters.query.trim();
  if (query) params.set(PARAM.query, query);
  const lists = [
    [PARAM.provinces, filters.provinces],
    [PARAM.arrangements, filters.arrangements],
    [PARAM.jobTypes, filters.jobTypes],
    [PARAM.durations, filters.durations],
    [PARAM.disciplines, filters.disciplines],
  ] as const;
  for (const [key, values] of lists) {
    if (values.length > 0) params.set(key, values.join(","));
  }
  if (filters.includeInactive) params.set(PARAM.includeInactive, "1");
  if (filters.sort !== "newest") params.set(PARAM.sort, filters.sort);
  return params;
}
