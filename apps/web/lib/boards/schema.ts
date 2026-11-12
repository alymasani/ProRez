/** Strict server-side parsing for employer-board mutations. */
import { z } from "zod";
import { ATS_PROVIDERS, type AtsProvider } from "../types";
import { canonicalBoardUrl, isValidBoardToken, normalizeBoardToken } from "./board-url";

export const POLL_INTERVAL = { min: 15, max: 10_080, default: 360 } as const;

const boardInputSchema = z.strictObject({
  provider: z.enum(ATS_PROVIDERS),
  employerName: z.string().transform((s) => s.trim()),
  boardToken: z.string().transform(normalizeBoardToken),
  pollIntervalMinutes: z.number().int(),
  enabled: z.boolean(),
});

export type BoardInput = z.input<typeof boardInputSchema>;

export interface ParsedBoard {
  provider: AtsProvider;
  employerName: string;
  boardToken: string;
  boardUrl: string;
  pollIntervalMinutes: number;
  enabled: boolean;
}

export type BoardField = "provider" | "employerName" | "boardToken" | "pollIntervalMinutes";

export type ParseBoardResult =
  | { ok: true; board: ParsedBoard }
  | { ok: false; fieldErrors: Partial<Record<BoardField, string>>; formErrors: string[] };

export function parseBoardInput(input: unknown): ParseBoardResult {
  const parsed = boardInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      fieldErrors: {},
      formErrors: parsed.error.issues.map((i) =>
        i.code === "unrecognized_keys" ? `Unsupported field(s): ${i.keys.join(", ")}` : `${i.path.join(".") || "board"}: ${i.message}`,
      ),
    };
  }
  const b = parsed.data;
  const fieldErrors: Partial<Record<BoardField, string>> = {};
  if (!b.employerName) fieldErrors.employerName = "Enter the employer's name.";
  else if (b.employerName.length > 120) fieldErrors.employerName = "Keep the name under 120 characters.";
  if (!isValidBoardToken(b.boardToken)) {
    fieldErrors.boardToken = "Use the board identifier from the URL: letters, numbers, dots, dashes or underscores.";
  }
  if (b.pollIntervalMinutes < POLL_INTERVAL.min || b.pollIntervalMinutes > POLL_INTERVAL.max) {
    fieldErrors.pollIntervalMinutes = `Choose between ${POLL_INTERVAL.min} minutes and 7 days.`;
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors, formErrors: [] };

  return { ok: true, board: { ...b, boardUrl: canonicalBoardUrl(b.provider, b.boardToken) } };
}
