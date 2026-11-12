import type { JobLocation, Province, WorkArrangement } from "@/lib/types";

/** Database row → domain location. `arrangementStated` is only emitted when false. */
export function mapJobLocation(l: {
  city: string;
  province: Province | null;
  arrangement: WorkArrangement;
  arrangementStated: boolean;
}): JobLocation {
  const base = { city: l.city, province: l.province, arrangement: l.arrangement };
  return l.arrangementStated ? base : { ...base, arrangementStated: false };
}
