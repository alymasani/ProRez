/**
 * Display structure and completeness for job descriptions.
 *
 * Descriptions are stored as PLAIN TEXT (provider HTML is converted by
 * lib/ats/html.ts and never stored or rendered). This module only recovers
 * visual structure from that text — headings, paragraphs, bullet lists and
 * http(s) links — so the page can show the complete employer-provided text.
 * It never adds, rewrites or drops content: every non-blank input line appears
 * in exactly one block, in order. Output is rendered through React (escaped),
 * so description text can never become markup.
 */

export type InlineSegment = { kind: "text"; text: string } | { kind: "link"; text: string; href: string };

export type DescriptionBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] };

const BULLET = /^\s*(?:[-–•*·▪●◦]|\d{1,2}[.)])\s+/;
const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+/gi;
/** Punctuation that usually ends the sentence rather than the URL. */
const TRAILING = /[.,;:!?)\]}'"’”]+$/;

/**
 * A heading is a short standalone line that labels what follows: it ends with
 * ":" or "?", or is written in capitals, or is a short phrase without sentence
 * punctuation directly followed by a list. This only affects styling.
 */
function looksLikeHeading(line: string, nextIsList: boolean): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 80) return false;
  if (/[:?]$/.test(t)) return true;
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return true;
  return nextIsList && t.split(/\s+/).length <= 8 && !/[.!,;]$/.test(t);
}

export function parseDescription(text: string | null | undefined): DescriptionBlock[] {
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: DescriptionBlock[] = [];
  const nextNonBlank = (from: number) => {
    for (let j = from; j < lines.length; j++) if (lines[j].trim()) return lines[j];
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (BULLET.test(line)) {
      const item = line.replace(BULLET, "").trim();
      const last = blocks.at(-1);
      // Blank lines between bullets do not end a list.
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
      continue;
    }
    const next = nextNonBlank(i + 1);
    blocks.push(looksLikeHeading(line, next !== null && BULLET.test(next)) ? { kind: "heading", text: line } : { kind: "paragraph", text: line });
  }
  // A trailing heading with nothing after it is just text.
  const last = blocks.at(-1);
  if (last?.kind === "heading") blocks[blocks.length - 1] = { kind: "paragraph", text: last.text };
  return blocks;
}

/** Splits text into plain and link segments. Only absolute http(s) URLs become links. */
export function linkify(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const url = raw.replace(TRAILING, "");
    const start = match.index ?? 0;
    let href: string | null = null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") href = parsed.href;
    } catch {
      href = null;
    }
    if (!href) continue;
    if (start > cursor) segments.push({ kind: "text", text: text.slice(cursor, start) });
    segments.push({ kind: "link", text: url, href });
    cursor = start + url.length;
  }
  if (cursor < text.length) segments.push({ kind: "text", text: text.slice(cursor) });
  return segments;
}

/** First real paragraph (not a heading like "WHO ARE WE?"), for one-line summaries. */
export function firstParagraph(text: string | null | undefined): string {
  const blocks = parseDescription(text);
  const paragraph = blocks.find((b) => b.kind === "paragraph");
  if (paragraph?.kind === "paragraph") return paragraph.text;
  const first = blocks[0];
  if (!first) return "";
  return first.kind === "list" ? first.items.join("; ") : first.text;
}

/**
 * Below this many characters a description is treated as incomplete. Real
 * postings are typically thousands of characters; a sentence or two usually
 * means the provider (or a list endpoint) returned only a teaser.
 */
export const DESCRIPTION_MIN_COMPLETE_CHARS = 300;

export type DescriptionStatus = "complete" | "incomplete" | "missing";

export interface DescriptionAssessment {
  status: DescriptionStatus;
  characters: number;
  /** Plain-language reason, shown to the user and in sync run details. */
  message: string | null;
}

/**
 * Whether a stored description is usable as the basis for later work
 * (matching, tailoring). Derived from the text itself, so it is never stale.
 */
export function assessDescription(text: string | null | undefined): DescriptionAssessment {
  const characters = text?.trim().length ?? 0;
  if (characters === 0) {
    return { status: "missing", characters, message: "The source did not provide a job description." };
  }
  if (characters < DESCRIPTION_MIN_COMPLETE_CHARS) {
    return {
      status: "incomplete",
      characters,
      message: `The description is very short (${characters} characters) and may be incomplete. Check the original posting.`,
    };
  }
  return { status: "complete", characters, message: null };
}
