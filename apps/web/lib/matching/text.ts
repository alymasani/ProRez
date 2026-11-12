/** Text helpers shared by the matching rules. Deterministic and locale-independent. */

/** Lowercase, strip accents, collapse non-alphanumerics to single spaces, pad with spaces. */
export function normalizeText(value: string): string {
  const core = value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
  return ` ${core} `;
}

/**
 * Whole-phrase containment on normalized text, so "intern" does not match
 * "internal" and "C++" / "C#" stay distinct tokens.
 */
export function containsPhrase(normalizedHaystack: string, phrase: string): boolean {
  const needle = normalizeText(phrase);
  return needle.trim() !== "" && normalizedHaystack.includes(needle);
}

export function findPhrases(normalizedHaystack: string, phrases: readonly string[]): string[] {
  return phrases.filter((p) => containsPhrase(normalizedHaystack, p));
}
