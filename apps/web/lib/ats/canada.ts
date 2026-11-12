/**
 * Decides whether a posting is open in Canada, from structured provider data
 * and employer-provided location text. Pure.
 *
 * Evidence accepted:
 * - a structured country of Canada ("CA", "CAN", "Canada");
 * - a Canadian province or territory (name or code after a comma, e.g. "Toronto, ON");
 * - an unambiguous Canadian city (Toronto, Montréal, Waterloo, …);
 * - remote roles whose text names Canada ("Remote - Canada", "Remote (Canada)").
 *
 * NOT accepted: "Remote", "Anywhere", "Worldwide", "Global", "North America",
 * "Americas", or ambiguous cities alone (London, Victoria, Kingston, Hamilton…).
 * A globally remote role is never assumed to be open to Canadians.
 */
import { PROVINCES, type JobLocation, type Province, type WorkArrangement } from "../types";

const PROVINCE_NAMES: Record<string, Province> = {
  alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB",
  "newfoundland and labrador": "NL", newfoundland: "NL", "nova scotia": "NS", "northwest territories": "NT",
  nunavut: "NU", ontario: "ON", "prince edward island": "PE", quebec: "QC", "québec": "QC",
  saskatchewan: "SK", yukon: "YT",
};

/** Cities that are unambiguously Canadian when named alone. */
const CITIES: Record<string, Province> = {
  toronto: "ON", ottawa: "ON", waterloo: "ON", kitchener: "ON", mississauga: "ON", markham: "ON", brampton: "ON",
  "richmond hill": "ON", oakville: "ON", guelph: "ON", burlington: "ON", vaughan: "ON",
  vancouver: "BC", burnaby: "BC", surrey: "BC", kelowna: "BC",
  montreal: "QC", "montréal": "QC", "quebec city": "QC", "québec city": "QC", laval: "QC", gatineau: "QC",
  calgary: "AB", edmonton: "AB",
  winnipeg: "MB", saskatoon: "SK", regina: "SK", halifax: "NS", fredericton: "NB", moncton: "NB",
  "st. john's": "NL", "st john's": "NL", charlottetown: "PE", whitehorse: "YT", yellowknife: "NT", iqaluit: "NU",
};

export interface StructuredLocation {
  country?: string | null;
  region?: string | null;
  city?: string | null;
  remote?: boolean | null;
  hybrid?: boolean | null;
}

export interface LocationEvidence {
  /** Free-text location strings from the provider. */
  texts: readonly string[];
  structured: readonly StructuredLocation[];
  /** Workplace type the provider reports for the whole posting, if any. */
  workplace: WorkArrangement | null;
}

export type CanadaResult =
  | { canadian: true; locations: JobLocation[]; arrangementStated: boolean }
  | { canadian: false; reason: string };

const AMBIGUOUS_CODES = new Set<Province>(["NL", "SK", "PE"]);

const norm = (s: string) => s.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

export function provinceFrom(value: string | null | undefined): Province | null {
  if (!value) return null;
  const v = norm(value).replace(/\./g, "");
  const upper = v.toUpperCase();
  if ((PROVINCES as readonly string[]).includes(upper)) return upper as Province;
  return PROVINCE_NAMES[v] ?? null;
}

const isCanadaCountry = (c: string | null | undefined) => !!c && ["ca", "can", "canada"].includes(norm(c));

function arrangementFromText(text: string): WorkArrangement | null {
  const t = norm(text);
  if (/\bhybrid\b/.test(t)) return "hybrid";
  if (/\bremote\b|\bwork from home\b|\btélétravail\b/.test(t)) return "remote";
  if (/\bon-?site\b|\bin[- ]office\b/.test(t)) return "onsite";
  return null;
}

/** One location string → a Canadian location, or null without evidence. */
function parseText(text: string, fallback: WorkArrangement | null): JobLocation | null {
  const t = norm(text);
  const arrangement = arrangementFromText(t) ?? fallback;
  const unstated = arrangement === null ? ({ arrangementStated: false } as const) : {};
  const mentionsCanada = /\bcanada\b|\bcanadian\b/.test(t);
  const parts = t.split(/[,(|\-–—/]/).map((p) => p.replace(/[)]/g, "").trim()).filter(Boolean);

  let province: Province | null = null;
  for (const part of parts.slice(1)) {
    const code = provinceFrom(part);
    // "NL", "SK" and "PE" are also country codes (Netherlands, Slovakia, Peru):
    // accept them only with corroborating evidence.
    if (code && part.length === 2 && AMBIGUOUS_CODES.has(code) && !mentionsCanada && !parts.some((p) => CITIES[p])) continue;
    province ??= code;
  }
  for (const part of parts) province ??= PROVINCE_NAMES[part] ?? null;

  const cityPart = parts.find((p) => CITIES[p]);
  const city = cityPart ? titleCase(cityPart) : null;
  if (!province && cityPart) province = CITIES[cityPart];

  if (province) {
    const named = city ?? (parts[0] && !provinceFrom(parts[0]) && !/remote|hybrid|canada/.test(parts[0]) ? titleCase(parts[0]) : null);
    return { city: named ?? (arrangement === "remote" ? "Remote" : provinceCityFallback(province)), province, arrangement: arrangement ?? "onsite", ...unstated };
  }
  if (mentionsCanada && (arrangement === "remote" || /\bremote\b/.test(t))) {
    return { city: "Remote", province: null, arrangement: "remote" };
  }
  if (mentionsCanada && arrangement) {
    // "Canada (Hybrid)" without a province: not enough to place the role.
    return null;
  }
  return null;
}

const provinceCityFallback = (p: Province) => `Unspecified city (${p})`;
const titleCase = (s: string) => s.replace(/(^|[\s'-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

export function resolveCanadianLocations(evidence: LocationEvidence): CanadaResult {
  const found: JobLocation[] = [];
  let arrangementStated = evidence.workplace !== null;

  for (const s of evidence.structured) {
    if (!isCanadaCountry(s.country)) continue;
    const arrangement: WorkArrangement = s.remote ? "remote" : s.hybrid ? "hybrid" : (evidence.workplace ?? "onsite");
    const stated = !!(s.remote || s.hybrid || evidence.workplace);
    if (s.remote || s.hybrid) arrangementStated = true;
    const province = provinceFrom(s.region) ?? (s.city ? CITIES[norm(s.city)] ?? null : null);
    if (!province && arrangement !== "remote") {
      // Canada without a province can only be represented as Canada-wide remote.
      continue;
    }
    found.push({
      city: s.city?.trim() || (province ? provinceCityFallback(province) : "Remote"),
      province,
      arrangement,
      ...(stated ? {} : { arrangementStated: false as const }),
    });
  }

  for (const text of evidence.texts) {
    for (const piece of text.split(/;|\bor\b|\s\|\s|\n/i)) {
      if (!piece.trim()) continue;
      const loc = parseText(piece, evidence.workplace);
      if (loc) {
        if (arrangementFromText(piece)) arrangementStated = true;
        found.push(loc);
      }
    }
  }

  const unique = dedupe(found);
  if (unique.length > 0) return { canadian: true, locations: unique, arrangementStated };

  const all = norm(evidence.texts.join(" "));
  if (/\b(anywhere|worldwide|global|north america|americas)\b|^remote$/.test(all)) {
    return { canadian: false, reason: "Remote without stating that Canada is eligible" };
  }
  if (/\bcanada\b/.test(all)) return { canadian: false, reason: "Mentions Canada without a province or remote eligibility" };
  return { canadian: false, reason: all ? `Not a Canadian location (${all.slice(0, 80)})` : "No location stated" };
}

function dedupe(locations: JobLocation[]): JobLocation[] {
  const seen = new Set<string>();
  const out: JobLocation[] = [];
  // A specific location makes a duplicate generic "Remote, Canada" redundant only if both are remote in that province; keep both otherwise.
  for (const l of locations) {
    const key = `${norm(l.city)}|${l.province ?? ""}|${l.arrangement}|${l.arrangementStated ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(l);
    }
  }
  return out;
}
