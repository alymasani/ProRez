/**
 * Employment classification for imported postings. Providers do not share a
 * vocabulary (Greenhouse has none, Lever uses free-text "commitment", Ashby
 * an enum, SmartRecruiters a label), so the title is the primary evidence.
 *
 * ProRez discovers internships, co-ops, new-grad and junior roles; other
 * roles are skipped with a reason. Profiles then decide what is prioritised —
 * no single duration or category is hard-coded here.
 */
import type { Discipline, JobType } from "../types";

export type Classification = { ok: true; jobType: JobType; evidence: string } | { ok: false; reason: string };

const SENIOR = /\b(senior|sr\.?|staff|principal|lead|manager|director|head of|vp|vice president|architect|distinguished)\b/i;
const CO_OP = /\b(co-?op|coop|work[- ]term)\b/i;
const INTERN = /\b(intern|interns|internship|stage|stagiaire|summer student|student)\b/i;
const NEW_GRAD = /\b(new[- ]grad(uate)?s?|recent graduate|university graduate|graduate (software|developer|engineer|program)|early[- ]career|campus hire)\b/i;
const JUNIOR = /\b(junior|jr\.?|entry[- ]level|associate (software|developer|engineer)|(engineer|developer) i|level 1|l1)\b/i;

export function classifyEmployment(title: string, employmentType: string | null): Classification {
  const t = title.replace(/\s+/g, " ");
  const type = (employmentType ?? "").toLowerCase();
  const internish = CO_OP.test(t) || INTERN.test(t) || /intern/.test(type);

  if (SENIOR.test(t) && !internish) return { ok: false, reason: "Senior or leadership role" };
  if (CO_OP.test(t)) return { ok: true, jobType: "co_op", evidence: "Title says co-op" };
  if (INTERN.test(t)) return { ok: true, jobType: "internship", evidence: "Title says intern/internship" };
  if (/intern/.test(type)) return { ok: true, jobType: "internship", evidence: `Provider employment type “${employmentType}”` };
  if (NEW_GRAD.test(t)) return { ok: true, jobType: "new_grad", evidence: "Title says new grad / graduate" };
  if (JUNIOR.test(t)) return { ok: true, jobType: "junior", evidence: "Title says junior / entry level" };
  return { ok: false, reason: "Not an internship, co-op, new-grad or junior role" };
}

const NUMBER_WORDS: Record<string, number> = { four: 4, eight: 8, twelve: 12, sixteen: 16, three: 3, six: 6, ten: 10, five: 5, two: 2 };

/**
 * Stated term length in months. Returns null when absent OR ambiguous (several
 * different lengths), so matching flags it for review instead of guessing.
 */
export function extractDurationMonths(texts: readonly string[]): number | null {
  const found = new Set<number>();
  const re = /\b(\d{1,2}|two|three|four|five|six|eight|ten|twelve|sixteen)[\s-]?(?:month|mo\.?)s?\b/gi;
  const NUM = "(\\d{1,2}|two|three|four|five|six|eight|ten|twelve|sixteen)";
  // "4 or 8 months", "4-8 months", "12 to 16 months": every number counts, so these stay ambiguous.
  const alternatives = new RegExp(`\\b${NUM}\\s*(?:or|to|and|-|–)\\s*${NUM}[\\s-]?(?:month|mo\\.?)s?\\b`, "gi");
  for (const text of texts) {
    for (const m of text.matchAll(alternatives)) {
      for (const token of [m[1], m[2]]) {
        const n = NUMBER_WORDS[token.toLowerCase()] ?? Number(token);
        if (n >= 1 && n <= 24) found.add(n);
      }
    }
    for (const m of text.matchAll(re)) {
      const n = NUMBER_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
      if (n >= 1 && n <= 24) found.add(n);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

export function extractTerm(texts: readonly string[]): string | null {
  for (const text of texts) {
    const m = /\b(Summer|Fall|Autumn|Winter|Spring)\s+(20\d\d)\b/i.exec(text);
    if (m) return `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}`;
  }
  return null;
}

const DISCIPLINE_PATTERNS: [Discipline, RegExp][] = [
  ["full_stack", /\bfull[- ]?stack\b/i],
  ["frontend", /\bfront[- ]?end\b|\bui engineer\b|\breact\b/i],
  ["backend", /\bback[- ]?end\b|\bapi\b|\bserver[- ]side\b/i],
  ["mobile", /\bmobile\b|\bios\b|\bandroid\b/i],
  ["infrastructure", /\binfrastructure\b|\bdevops\b|\bsite reliability\b|\bsre\b|\bplatform engineer/i],
  ["data", /\bdata engineer|\bdata platform\b|\betl\b/i],
  ["machine_learning", /\bmachine learning\b|\bml\b|\bai engineer\b|\bdeep learning\b/i],
  ["embedded", /\bembedded\b|\bfirmware\b/i],
  ["security", /\bsecurity\b/i],
  ["qa_automation", /\bqa\b|\btest automation\b|\bquality assurance\b|\bsdet\b/i],
];

/** Disciplines named in the TITLE only (descriptions mention too much to be reliable). */
export function inferDisciplines(title: string): Discipline[] {
  return DISCIPLINE_PATTERNS.filter(([, re]) => re.test(title)).map(([d]) => d);
}
