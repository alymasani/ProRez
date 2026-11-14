/**
 * Generic company career pages (Milestone 3D). The board token is the
 * canonical careers URL without scheme ("acme.com/careers"). Extraction runs
 * the progressive strategies in lib/careers/extract.ts through the SSRF-safe
 * site fetcher. Snapshots are incomplete unless exhaustiveness is shown, so
 * the 3B pipeline never expires jobs from an unreliable generic snapshot.
 */
import { extractCareerSite, toProviderPostings } from "../../careers/extract";
import { isValidBoardToken } from "../../boards/board-url";
import { AtsError } from "../http";
import type { AtsAdapter } from "../types";

export const genericAdapter: AtsAdapter = {
  provider: "company_site",
  documentation: "docs/career-sources.md (JSON-LD JobPosting, sitemaps, static HTML, optional rendering)",
  async fetchPostings(boardToken, { transport, signal, site, limits }) {
    if (!isValidBoardToken(boardToken, "company_site")) throw new AtsError("invalid_board", "The careers URL is not valid.");
    const fetcher = site ?? transport.site?.();
    if (!fetcher) throw new AtsError("blocked_host", "Company career sites cannot be read with this transport.");
    const before = fetcher.requests;
    const x = await extractCareerSite(`https://${boardToken}`, fetcher, { limits, signal });
    if (signal?.aborted) throw new AtsError("cancelled", "The sync was cancelled.");
    if (x.status === "blocked" && x.failure) {
      const f = x.failure.failure;
      if (f === "robots_disallowed" || f === "blocked_url" || f === "blocked_address") throw new AtsError("blocked_host", x.failure.message);
      if (f === "timeout") throw new AtsError("timeout", x.failure.message);
      if (f === "network") throw new AtsError("network", x.failure.message);
      if (f === "too_large") throw new AtsError("too_large", x.failure.message);
      if (f === "not_html") throw new AtsError("invalid_response", x.failure.message);
      const status = Number(/HTTP (\d{3})/.exec(x.failure.message)?.[1] ?? 0) || undefined;
      throw new AtsError("http_error", x.failure.message, status);
    }
    const warnings: string[] = [];
    if (x.routedTo.length > 0) {
      warnings.push(`This careers page links to ${x.routedTo.map((t) => `${t.provider} (${t.canonicalBoardUrl})`).join(", ")}; adding that board directly gives complete, reliable syncs.`);
    }
    if (x.status === "routed" && x.jobs.length === 0) {
      throw new AtsError("invalid_board", `This careers page now leads to ${x.routedTo[0]?.canonicalBoardUrl ?? "an ATS board"}. Add that board instead.`);
    }
    return {
      postings: toProviderPostings(x.jobs),
      warnings,
      requests: fetcher.requests - before,
      complete: x.complete,
      incompleteReason: x.complete ? null : (x.incompleteReason ?? "Generic career pages are incomplete unless proven exhaustive."),
      invalidItems: 0,
      enrichmentDeferred: 0,
      strategy: x.strategy ?? undefined,
      sourceCompanyName: x.companyName,
      diagnostics: x.diagnostics,
    };
  },
};
