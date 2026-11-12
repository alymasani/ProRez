/**
 * OPTIONAL live smoke test against real public boards. Never runs by default.
 *
 *   PROREZ_ATS_SMOKE="greenhouse:<token>,lever:<site>,ashby:<board>,smartrecruiters:<company>" npm run test:smoke
 *
 * Read-only: it fetches and normalizes postings and writes nothing.
 */
import { describe, expect, it } from "vitest";
import { createFetchTransport } from "@/lib/ats/http";
import { normalizePosting } from "@/lib/ats/normalize";
import { ATS_ADAPTERS } from "@/lib/ats/registry";
import { ATS_PROVIDERS, type AtsProvider } from "@/lib/types";

const boards = (process.env.PROREZ_ATS_SMOKE ?? "")
  .split(",")
  .map((s) => s.trim().split(":"))
  .filter((p): p is [AtsProvider, string] => p.length === 2 && (ATS_PROVIDERS as readonly string[]).includes(p[0]));

describe.skipIf(boards.length === 0)("live ATS smoke test", () => {
  for (const [provider, token] of boards) {
    it(`${provider}:${token}`, async () => {
      const result = await ATS_ADAPTERS[provider].fetchPostings(token, { transport: createFetchTransport(), timeoutMs: 30_000 });
      const normalized = result.postings.map((p) => normalizePosting(p, token));
      console.info(
        `${provider}:${token} — ${result.postings.length} postings, ${normalized.filter((n) => n.ok).length} importable, ${result.warnings.length} warnings`,
      );
      expect(result.postings.every((p) => p.postingId && p.title)).toBe(true);
    }, 120_000);
  }
});
