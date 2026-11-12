import type { IsoDateTime, JobLocation } from "@/lib/types";
import { ARRANGEMENT_LABELS } from "@/lib/labels";

/*
 * Dates are formatted with a fixed locale and time zone so that server and
 * client renders are byte-identical (no hydration mismatches) and output does
 * not depend on the machine running the build.
 */
const LOCALE = "en-CA";
const TIME_ZONE = "America/Toronto";

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function formatDate(value: IsoDateTime | null | undefined): string {
  if (!value) return "—";
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value: IsoDateTime | null | undefined): string {
  if (!value) return "—";
  return dateTimeFormatter.format(new Date(value));
}

export function formatDuration(months: number | null): string {
  if (months === null) return "Not specified";
  return `${months} month${months === 1 ? "" : "s"}`;
}

export function formatLocation(location: JobLocation): string {
  return `${location.city}, ${location.province}`;
}

/** "Toronto, ON · Hybrid" or "Toronto, ON +2 more". */
export function formatPrimaryLocation(locations: JobLocation[]): string {
  if (locations.length === 0) return "Location not specified";
  const [first, ...rest] = locations;
  const base = `${formatLocation(first)} · ${ARRANGEMENT_LABELS[first.arrangement]}`;
  return rest.length > 0 ? `${base} +${rest.length} more` : base;
}

// ---------------------------------------------------------------------------
// Calendar dates ("YYYY-MM-DD", no time zone): user-entered application and
// interview dates. Stored application dates use 12:00 UTC so they fall on the
// same calendar day in every Canadian time zone.
// ---------------------------------------------------------------------------

const calendarFormatter = new Intl.DateTimeFormat(LOCALE, {
  timeZone: "UTC",
  year: "numeric",
  month: "short",
  day: "numeric",
});

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real date such as "2026-11-05" (rejects "2026-02-30"). */
export function isCalendarDate(value: string): boolean {
  const m = CALENDAR_DATE.exec(value);
  if (!m) return false;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return date.toISOString().slice(0, 10) === value;
}

export function formatCalendarDate(value: string | null | undefined): string {
  if (!value || !isCalendarDate(value)) return "—";
  return calendarFormatter.format(new Date(`${value}T00:00:00Z`));
}

/** Today's date in ProRez's display time zone (Toronto). */
export function todayCalendarDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Adds whole days to a calendar date. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Stored timestamp for a user-entered calendar date (noon UTC). */
export function calendarDateToTimestamp(date: string): string {
  return `${date}T12:00:00.000Z`;
}

/** The calendar date a stored application timestamp represents. */
export function timestampToCalendarDate(iso: string): string {
  return todayCalendarDate(new Date(iso));
}
