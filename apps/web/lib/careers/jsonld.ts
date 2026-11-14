/**
 * Strategy 1 — schema.org JobPosting structured data (JSON-LD).
 *
 * Reads every <script type="application/ld+json"> block as TEXT (never
 * executed), parses it with JSON.parse, and walks objects, arrays, `@graph`
 * and nested values for `@type` JobPosting. Malformed blocks are skipped and
 * counted. Values are validated; nothing missing is invented.
 */
import { decodeEntities, htmlToText } from "../ats/html";

export interface StructuredJob {
  title: string;
  /** Plain text (HTML converted); "" when the block has none. */
  description: string;
  url: string | null;
  identifier: string | null;
  hiringOrganization: string | null;
  hiringOrganizationUrl: string | null;
  locations: string[];
  /** Country codes/names stated in jobLocation addresses. */
  countries: string[];
  remote: boolean;
  employmentType: string | null;
  datePosted: string | null;
  validThrough: string | null;
  /** Salary text when stated ("CAD 25–30 per HOUR"); display only. */
  salary: string | null;
}

export interface JsonLdResult {
  jobs: StructuredJob[];
  /** Blocks that were not valid JSON. */
  malformedBlocks: number;
  /** JobPosting objects rejected by validation (e.g. no title). */
  invalidPostings: number;
  /** Organization name stated by Organization/WebSite blocks, if any. */
  organization: string | null;
}

const SCRIPT = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
const MAX_BLOCK_CHARS = 2_000_000;
const MAX_NODES = 20_000;

type J = Record<string, unknown>;
const isObj = (v: unknown): v is J => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? decodeEntities(v.trim()) : typeof v === "number" ? String(v) : null);
const types = (o: J): string[] => {
  const t = o["@type"];
  return (Array.isArray(t) ? t : [t]).filter((x): x is string => typeof x === "string").map((x) => x.replace(/^https?:\/\/schema\.org\//, ""));
};

function absUrl(v: unknown, base: string): string | null {
  const s = text(v);
  if (!s) return null;
  try {
    const u = new URL(s, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function orgName(v: unknown): string | null {
  if (typeof v === "string") return text(v);
  if (Array.isArray(v)) return orgName(v[0]);
  return isObj(v) ? text(v.name) : null;
}

function addressParts(place: unknown): { text: string | null; country: string | null } {
  if (!isObj(place)) return { text: text(place), country: null };
  const addr = isObj(place.address) ? place.address : typeof place.address === "string" ? { streetAddress: place.address } : place;
  const country = isObj(addr.addressCountry) ? text(addr.addressCountry.name) ?? text(addr.addressCountry.identifier) : text(addr.addressCountry);
  const parts = [text(addr.addressLocality), text(addr.addressRegion), country].filter((x): x is string => !!x);
  return { text: parts.length ? parts.join(", ") : text(place.name), country };
}

function salaryText(v: unknown): string | null {
  if (!isObj(v)) return text(v);
  const value = isObj(v.value) ? v.value : v;
  const min = text(value.minValue);
  const max = text(value.maxValue);
  const single = text(value.value);
  const amount = min && max ? `${min}–${max}` : (single ?? min ?? max);
  if (!amount) return null;
  return [text(v.currency), amount, text(value.unitText) ? `per ${text(value.unitText)}` : null].filter(Boolean).join(" ").slice(0, 120);
}

function toJob(o: J, base: string): StructuredJob | null {
  const title = text(o.title) ?? text(o.name);
  if (!title || title.length > 300) return null;
  const rawDesc = typeof o.description === "string" ? o.description : "";
  // Descriptions are often HTML, sometimes entity-encoded HTML.
  const description = htmlToText(rawDesc).slice(0, 60_000);
  const placesRaw = o.jobLocation === undefined ? [] : Array.isArray(o.jobLocation) ? o.jobLocation : [o.jobLocation];
  const places = placesRaw.slice(0, 50).map(addressParts);
  const remote = /TELECOMMUTE/i.test(String(o.jobLocationType ?? "")) || isObj(o.applicantLocationRequirements) || Array.isArray(o.applicantLocationRequirements);
  const applicantCountries = (Array.isArray(o.applicantLocationRequirements) ? o.applicantLocationRequirements : [o.applicantLocationRequirements])
    .map((r) => (isObj(r) ? text(r.name) : null))
    .filter((x): x is string => !!x);
  const identifier = isObj(o.identifier) ? text(o.identifier.value) ?? text(o.identifier.name) : text(o.identifier);
  const employment = Array.isArray(o.employmentType) ? o.employmentType.map(text).filter(Boolean).join(", ") : text(o.employmentType);
  return {
    title: title.replace(/\s+/g, " "),
    description,
    url: absUrl(o.url, base) ?? absUrl(o.sameAs, base),
    identifier: identifier ? identifier.slice(0, 200) : null,
    hiringOrganization: orgName(o.hiringOrganization),
    hiringOrganizationUrl: isObj(o.hiringOrganization) ? absUrl(o.hiringOrganization.sameAs ?? o.hiringOrganization.url, base) : null,
    locations: places.map((p) => p.text).filter((x): x is string => !!x),
    countries: [...places.map((p) => p.country).filter((x): x is string => !!x), ...applicantCountries],
    remote,
    employmentType: employment || null,
    datePosted: text(o.datePosted),
    validThrough: text(o.validThrough),
    salary: salaryText(o.baseSalary ?? o.estimatedSalary),
  };
}

/** Extracts JobPosting objects from a page's JSON-LD blocks. */
export function extractJsonLd(html: string, baseUrl: string): JsonLdResult {
  const out: JsonLdResult = { jobs: [], malformedBlocks: 0, invalidPostings: 0, organization: null };
  let nodes = 0;
  const visit = (v: unknown, depth: number) => {
    if (depth > 12 || nodes++ > MAX_NODES) return;
    if (Array.isArray(v)) return v.forEach((x) => visit(x, depth + 1));
    if (!isObj(v)) return;
    const t = types(v);
    if (t.includes("JobPosting")) {
      const job = toJob(v, baseUrl);
      if (job) out.jobs.push(job);
      else out.invalidPostings++;
      return;
    }
    if (!out.organization && (t.includes("Organization") || t.includes("Corporation"))) out.organization = text(v.name);
    for (const [k, child] of Object.entries(v)) if (k !== "@context" && typeof child === "object") visit(child, depth + 1);
  };
  for (const m of html.matchAll(SCRIPT)) {
    const raw = m[1].trim();
    if (!raw || raw.length > MAX_BLOCK_CHARS) {
      if (raw) out.malformedBlocks++;
      continue;
    }
    try {
      // Some sites wrap JSON in CDATA or HTML comments.
      visit(JSON.parse(raw.replace(/^<!\[CDATA\[|\]\]>$/g, "").replace(/^<!--|-->$/g, "").trim()), 0);
    } catch {
      out.malformedBlocks++;
    }
  }
  return out;
}
