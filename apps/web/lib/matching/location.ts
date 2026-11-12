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

  for (const location of locations) {
    const arrangementOk = arrangements.length === 0 || arrangements.includes(location.arrangement);
    const provinceOk =
      provinces.length === 0 ||
      provinces.includes(location.province) ||
      (includeRemoteCanadaWide && location.arrangement === "remote");
    if (arrangementOk && provinceOk) {
      return {
        result: "pass",
        detail: `${location.city}, ${location.province} · ${ARRANGEMENT_LABELS[location.arrangement]}`,
        matched: location,
      };
    }
  }

  const listed = locations.map((l) => `${l.city}, ${l.province} (${ARRANGEMENT_LABELS[l.arrangement]})`).join("; ");
  return { result: "fail", detail: `No acceptable location: ${listed}`, matched: null };
}
