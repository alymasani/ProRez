import type { PublishedAtKind } from "../types";

/**
 * Publication-to-discovery latency in ms. Only computed when the provider
 * reports a FIRST-publication time; "last published" (Ashby) and "updated"
 * (Greenhouse) times are not trustworthy for this, and Lever reports none.
 */
export function discoveryLatencyMs(
  publishedAt: string | Date | null,
  kind: PublishedAtKind,
  firstSeenAt: string | Date,
): number | null {
  if (!publishedAt || kind !== "first_published") return null;
  const ms = new Date(firstSeenAt).getTime() - new Date(publishedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

export function formatLatency(ms: number | null): string {
  if (ms === null) return "Not available";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${Math.round(hours / 24)} days`;
}
