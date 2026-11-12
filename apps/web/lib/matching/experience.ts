/**
 * Extracts a years-of-experience requirement from posting text.
 *
 * Postings rarely state experience in a structured way, so the result says
 * explicitly whether a requirement was found and whether it is ambiguous
 * (several different numbers, e.g. "2+ years required, 5 preferred").
 */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const NUM = String.raw`(\d{1,2}|zero|one|two|three|four|five|six|seven|eight|nine|ten)`;
// "2-4 years", "2 to 4 years", "3+ years", "5 years", "one year"
const RANGE = new RegExp(String.raw`\b${NUM}\s*(?:\+|plus)?\s*(?:-|–|—|to)\s*${NUM}\s*\+?\s*(?:years?|yrs?)\b`, "gi");
const SINGLE = new RegExp(String.raw`\b${NUM}\s*(?:\+|plus)?\s*(?:years?|yrs?)\b`, "gi");
const NO_EXPERIENCE = /\b(no (prior |previous )?(professional |work )?experience (is )?(required|needed|necessary)|entry[- ]level)\b/i;

export interface ExperienceRequirement {
  /** Smallest number of years mentioned; null when none is stated. */
  minYears: number | null;
  /** Largest number of years mentioned; null when none is stated. */
  maxYearsMentioned: number | null;
  /** True when different requirements are mentioned (e.g. required vs preferred). */
  ambiguous: boolean;
  /** Where the requirement came from, for explanations. */
  source: "stated" | "entry_level_language" | "not_stated";
  evidence: string[];
}

const toNumber = (token: string) => NUMBER_WORDS[token.toLowerCase()] ?? Number(token);

export function extractExperienceRequirement(texts: readonly string[]): ExperienceRequirement {
  const text = texts.join("\n");
  const values: number[] = [];
  const evidence: string[] = [];

  // Ranges first, then remove them so "2-4 years" is not also read as "4 years".
  const withoutRanges = text.replace(RANGE, (match, low: string) => {
    values.push(toNumber(low));
    evidence.push(match.trim());
    return " ";
  });
  for (const match of withoutRanges.matchAll(SINGLE)) {
    values.push(toNumber(match[1]));
    evidence.push(match[0].trim());
  }

  // Ignore implausible numbers (e.g. "a 16 year old company" is rare but "12-month" is not years).
  const plausible = values.filter((v) => Number.isFinite(v) && v >= 0 && v <= 20);
  if (plausible.length > 0) {
    const distinct = new Set(plausible);
    return {
      minYears: Math.min(...plausible),
      maxYearsMentioned: Math.max(...plausible),
      ambiguous: distinct.size > 1,
      source: "stated",
      evidence,
    };
  }

  if (NO_EXPERIENCE.test(text)) {
    return { minYears: 0, maxYearsMentioned: 0, ambiguous: false, source: "entry_level_language", evidence: [] };
  }

  return { minYears: null, maxYearsMentioned: null, ambiguous: false, source: "not_stated", evidence: [] };
}
