import { ARRANGEMENT_LABELS } from "../labels";
import type { JobLocation, ProfileCriteria } from "../types";

export interface LocationCheck {
  result: "pass" | "fail" | "unknown" | "not_applicable";
  detail: string;
  /** The first job location that satisfied the profile. */
  matched: JobLocation | null;
}

/**
 * A job passes when ANY of its locations satisfies the profile:
 *   arrangement allowed  AND  (province allowed  OR  remote-anywhere-in-Canada accepted)
 * Empty province / arrangement lists mean "anywhere in Canada" / "any arrangement".
 * Every `Province` value is Canadian, so non-Canadian jobs cannot be represented yet.
 */
export function checkLocation(
  locations: readonly JobLocation[],
  criteria: Pick<ProfileCriteria, "provinces" | "arrangements" | "includeRemoteCanadaWide">,
): LocationCheck {
  const { provinces, arrangements, includeRemoteCanadaWide } = criteria;
  if (provinces.length === 0 && arrangements.length === 0) {
    return { result: "not_applicable", detail: "Any location in Canada", matched: null };
  }
  if (locations.length === 0) {
    return { result: "unknown", detail: "Posting does not state a location", matched: null };
  }

  let unstatedCandidate: JobLocation | null = null;
  for (const location of locations) {
    const arrangementOk = arrangements.length === 0 || arrangements.includes(location.arrangement);
    const provinceOk =
      provinces.length === 0 ||
      // No province = remote anywhere in Canada, which includes every selected province.
      location.province === null ||
      provinces.includes(location.province) ||
      (includeRemoteCanadaWide && location.arrangement === "remote");
    if (arrangementOk && provinceOk) {
      return {
        result: "pass",
        detail: `${location.city}, ${location.province ?? "Canada"} · ${arrangementLabel(location)}`,
        matched: location,
      };
    }
    // The province fits but the arrangement was never stated: it may well be
    // remote or hybrid, so this is a question for review, not a rejection.
    if (provinceOk && location.arrangementStated === false) unstatedCandidate ??= location;
  }

  if (unstatedCandidate) {
    return {
      result: "unknown",
      detail: `${unstatedCandidate.city}, ${unstatedCandidate.province ?? "Canada"} — work arrangement not stated — needs review`,
      matched: null,
    };
  }

  const listed = locations.map((l) => `${l.city}, ${l.province ?? "Canada"} (${arrangementLabel(l)})`).join("; ");
  return { result: "fail", detail: `No acceptable location: ${listed}`, matched: null };
}

const arrangementLabel = (l: JobLocation) =>
  l.arrangementStated === false ? "arrangement not stated" : ARRANGEMENT_LABELS[l.arrangement];
