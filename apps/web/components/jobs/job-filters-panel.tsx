"use client";

import { useId } from "react";
import { CheckboxGroup, optionsFrom } from "@/components/forms/checkbox-group";
import { Checkbox } from "@/components/ui/checkbox";
import type { JobFilters } from "@/lib/jobs/filters";
import {
  ARRANGEMENT_LABELS,
  DISCIPLINE_LABELS,
  DURATION_LABELS,
  JOB_TYPE_LABELS,
  PROVINCE_LABELS,
} from "@/lib/labels";
import { DISCIPLINES, DURATION_BUCKETS, JOB_TYPES, PROVINCES, WORK_ARRANGEMENTS } from "@/lib/types";

const PROVINCE_OPTIONS = PROVINCES.map((p) => ({ value: p, label: PROVINCE_LABELS[p] }));

export function JobFiltersPanel({
  filters,
  onChange,
}: {
  filters: JobFilters;
  onChange: (patch: Partial<JobFilters>) => void;
}) {
  // The panel renders twice (desktop sidebar + mobile sheet), so ids must be unique per instance.
  const inactiveId = `${useId()}-include-inactive`;
  return (
    <div className="space-y-6">
      <CheckboxGroup
        legend="Job type"
        options={optionsFrom(JOB_TYPES, JOB_TYPE_LABELS)}
        value={filters.jobTypes}
        onChange={(jobTypes) => onChange({ jobTypes })}
      />
      <CheckboxGroup
        legend="Work arrangement"
        options={optionsFrom(WORK_ARRANGEMENTS, ARRANGEMENT_LABELS)}
        value={filters.arrangements}
        onChange={(arrangements) => onChange({ arrangements })}
      />
      <CheckboxGroup
        legend="Duration"
        description="Internship and co-op term length."
        options={optionsFrom(DURATION_BUCKETS, DURATION_LABELS)}
        value={filters.durations}
        onChange={(durations) => onChange({ durations })}
      />
      <CheckboxGroup
        legend="Discipline"
        options={optionsFrom(DISCIPLINES, DISCIPLINE_LABELS)}
        value={filters.disciplines}
        onChange={(disciplines) => onChange({ disciplines })}
      />
      <CheckboxGroup
        legend="Province / territory"
        options={PROVINCE_OPTIONS}
        value={filters.provinces}
        onChange={(provinces) => onChange({ provinces })}
      />
      <div className="flex items-start gap-2 border-t pt-4">
        <Checkbox
          id={inactiveId}
          checked={filters.includeInactive}
          onCheckedChange={(checked) => onChange({ includeInactive: checked === true })}
          className="mt-0.5"
        />
        <label htmlFor={inactiveId} className="cursor-pointer text-sm leading-snug">
          Show dismissed &amp; expired
        </label>
      </div>
    </div>
  );
}
