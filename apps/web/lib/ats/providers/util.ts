import { isValidBoardToken } from "../../boards/board-url";
import { AtsError } from "../http";
import type { PublishedAtKind } from "../types";

export type Json = Record<string, unknown>;

export const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
export const idString = (v: unknown): string | null =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : str(v);

/** Validates the board token before it can become part of a request URL. */
export function boardPath(token: string): string {
  if (!isValidBoardToken(token)) throw new AtsError("invalid_board", "The board identifier is not valid.");
  return encodeURIComponent(token);
}

/** ISO timestamp, or null for missing/invalid values (never a guess). */
export function timestamp(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function published(at: string | null, kind: PublishedAtKind): { publishedAt: string | null; publishedAtKind: PublishedAtKind } {
  return at ? { publishedAt: at, publishedAtKind: kind } : { publishedAt: null, publishedAtKind: "none" };
}

/** Only allow http(s) display URLs from providers. */
export function safeUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function expectObject(data: unknown, what: string): Json {
  if (!isObject(data)) throw new AtsError("invalid_response", `Unexpected ${what} response shape.`);
  return data;
}
