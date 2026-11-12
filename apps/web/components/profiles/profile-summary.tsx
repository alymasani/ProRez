import type { ReactNode } from "react";
import {
  ARRANGEMENT_LABELS,
  AUTOMATION_MODE_LABELS,
  DISCIPLINE_LABELS,
  DURATION_REQUIREMENT_LABELS,
  EXPERIENCE_LEVEL_LABELS,
  JOB_TYPE_LABELS,
  NOTIFICATION_CADENCE_LABELS,
} from "@/lib/labels";
import { durationApplies } from "@/lib/profiles/draft";
import type { SearchProfileDraft } from "@/lib/types";

function list(values: string[], empty = "Any"): string {
  return values.length === 0 ? empty : values.join(", ");
}

/** Read-only, human-readable description of a profile's configuration. */
export function ProfileSummary({ draft, compact = false }: { draft: SearchProfileDraft; compact?: boolean }) {
  const c = draft.criteria;
  const locations =
    c.provinces.length === 0
      ? "Anywhere in Canada"
      : `${c.provinces.join(", ")}${c.includeRemoteCanadaWide ? " + remote Canada-wide" : ""}`;

  const rows: [string, ReactNode][] = [
    ["Employment", list(c.jobTypes.map((t) => JOB_TYPE_LABELS[t]), "None selected")],
    ...(durationApplies(draft)
      ? ([["Duration", list(c.durations.map((d) => DURATION_REQUIREMENT_LABELS[d].label))]] as [string, ReactNode][])
      : []),
    ["Locations", locations],
    ["Arrangement", list(c.arrangements.map((a) => ARRANGEMENT_LABELS[a]))],
    ["Min fit score", `${draft.minFitScore} / 100`],
    ["Automation", AUTOMATION_MODE_LABELS[draft.automationMode].label],
    [
      "Notifications",
      draft.notifications.enabled
        ? `Telegram · ${NOTIFICATION_CADENCE_LABELS[draft.notifications.cadence]}`
        : "Off",
    ],
  ];

  if (!compact) {
    rows.splice(
      1,
      0,
      ["Title keywords", list(c.titleKeywords)],
      ["Excluded", list(c.excludedTitleKeywords, "None")],
      ["Specialties", list(c.disciplines.map((d) => DISCIPLINE_LABELS[d]))],
      [
        "Experience",
        `${list(c.experienceLevels.map((e) => EXPERIENCE_LEVEL_LABELS[e]))}${
          c.maxYearsExperience !== null ? ` · ≤ ${c.maxYearsExperience} yrs` : ""
        }`,
      ],
    );
  }

  return (
    <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 text-sm sm:grid-cols-[8rem_1fr]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="mb-1 min-w-0 sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
