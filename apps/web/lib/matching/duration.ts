/**
 * Internship / co-op duration requirements (Milestone 2C). Pure.
 *
 * A posting satisfies a profile when its stated length satisfies ANY selected
 * requirement. A posting that states no length is accepted only when
 * "unspecified" is selected; otherwise it is `unknown` (needs review), never a
 * silent pass.
 */
import { DURATION_REQUIREMENT_LABELS } from "../labels";
import type { DurationRequirement } from "../types";

/** Whether a stated length (whole months) satisfies one requirement. */
export function durationSatisfies(requirement: DurationRequirement, months: number): boolean {
  switch (requirement) {
    case "4":
      return months >= 1 && months <= 4;
    case "8":
      return months >= 5 && months <= 8;
    case "12_plus":
      return months > 8;
    case "exactly_4":
      return months === 4;
    case "up_to_4":
      return months >= 1 && months <= 4;
    case "4_to_8":
      return months >= 4 && months <= 8;
    case "any":
      return months >= 1;
    case "legacy_5_to_8":
      return months >= 5 && months <= 8;
    case "legacy_over_8":
      return months > 8;
    case "unspecified":
      return false;
  }
}

export interface DurationCheck {
  result: "pass" | "fail" | "unknown" | "not_applicable";
  detail: string;
}

export function checkDuration(months: number | null, requirements: readonly DurationRequirement[]): DurationCheck {
  if (requirements.length === 0) return { result: "not_applicable", detail: "Duration not constrained" };
  if (months === null) {
    return requirements.includes("unspecified")
      ? { result: "pass", detail: "Duration not stated (accepted by profile)" }
      : { result: "unknown", detail: "Duration not stated — needs review" };
  }
  const stated = requirements.filter((r) => r !== "unspecified");
  const satisfied = stated.find((r) => durationSatisfies(r, months));
  if (satisfied) {
    return { result: "pass", detail: `${months} months (${DURATION_REQUIREMENT_LABELS[satisfied].label.toLowerCase()})` };
  }
  const wanted = stated.length > 0 ? stated.map((r) => DURATION_REQUIREMENT_LABELS[r].label).join(", ") : "an unstated duration";
  return { result: "fail", detail: `${months} months does not match ${wanted}` };
}

/** Old (2A/2B) bucket → requirement with IDENTICAL behaviour. Mirrors the 2C migration SQL. */
export const LEGACY_BUCKET_CONVERSION: Record<string, DurationRequirement> = {
  "4": "up_to_4",
  "8": "legacy_5_to_8",
  "12_plus": "legacy_over_8",
  unspecified: "unspecified",
};
