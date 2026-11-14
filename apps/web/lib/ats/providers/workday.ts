/**
 * Workday career sites (Milestone 3D).
 *
 * Workday career sites are single-page apps backed by a browser-facing JSON
 * interface ("CXS") on the same public host:
 *   List:   POST https://{host}/wday/cxs/{tenant}/{site}/jobs
 *           body {"appliedFacets":{},"limit":20,"offset":N,"searchText":""}
 *           → { total, jobPostings: [{ title, externalPath, locationsText, postedOn, bulletFields }] }
 *           `total` is reported on the FIRST page only (later pages say 0).
 *   Detail: GET  https://{host}/wday/cxs/{tenant}/{site}{externalPath}
 *           → { jobPostingInfo: { title, jobDescription (HTML), location,
 *               additionalLocations, timeType, jobReqId, startDate, externalUrl,
 *               country, remoteType? }, hiringOrganization }
 * This is NOT a documented, stable public integration API. It is what the
 * public career site itself calls anonymously; we use it read-only, paced,
 * through the allow-listed transport (no cookies, no authentication, no
 * CAPTCHA or bot-protection workarounds). Any 401/403 is reported as a
 * blocked source, and an unexpected shape fails loudly rather than guessing.
 *
 * Identity: posting id = last segment of `externalPath` ("{slug}_{req}"),
 * which is unique per posting within the career site; the requisition id is
 * kept as metadata (one requisition can have several postings). Postings
 * listed again under another locale share the same path, so they collapse.
 *
 * Completeness: every page up to the first page's `total` must be read, the
 * unique postings must reconcile with `total`, nothing malformed, and no page
 * cap reached. Description enrichment (one request per posting) is capped and
 * tracked separately — it never affects listing completeness.
 */
import { workdayEndpoints } from "../../boards/board-url";
import { provinceFrom } from "../canada";
import { htmlToText } from "../html";
import { AtsError } from "../http";
import { completeness, MALFORMED_REASON, type AtsAdapter, type ExtractionLimits, type ProviderPosting } from "../types";
import { expectObject, isObject, published, safeUrl, str, type Json } from "./util";
import type { WorkArrangement } from "../../types";

export const WORKDAY_PAGE_SIZE = 20;
export const WORKDAY_DEFAULT_LIMITS: ExtractionLimits = { maxListingPages: 100, maxDetailPages: 60, maxRenders: 0, minIntervalMs: 250 };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AtsError("cancelled", "The sync was cancelled."));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new AtsError("cancelled", "The sync was cancelled."))), { once: true });
  });
}

/** "/job/Toronto/Software-Intern_R123" → "software-intern_r123" (null if unusable). */
export function workdayPostingId(externalPath: string): string | null {
  // The path is appended to the CXS base URL, so it must stay a plain /job/… path.
  if (!/^\/job\/[^?#\s\\]+$/.test(externalPath) || externalPath.split("/").some((seg) => seg === ".." || seg === ".")) return null;
  const last = externalPath.split("/").filter(Boolean).pop() ?? "";
  // Slugs may start with "_" or "-" (titles in non-Latin scripts are stripped).
  // Lowercase: the same identity manual job URLs get (lib/jobs/url.ts).
  return WORKDAY_POSTING_ID.test(last) && last !== "job" ? last.toLowerCase() : null;
}

export const WORKDAY_POSTING_ID = /^[A-Za-z0-9_~()-][A-Za-z0-9._~()-]{0,199}$/;
/**
 * Workday's listing reports at most this many postings (observed live: the
 * listing continues past offset 2000 while `total` says 2000), so a total at
 * or above it cannot prove completeness.
 */
export const WORKDAY_TOTAL_CAP = 2000;

const REMOTE: Record<string, WorkArrangement> = { remote: "remote", hybrid: "hybrid", "on-site": "onsite", onsite: "onsite", "on site": "onsite" };

/** "Toronto, ON" style hints for the Canada filter from Workday's "Canada, Ontario, Toronto" texts. */
function locationTexts(info: Json | null, listing: string | null): string[] {
  const out: string[] = [];
  if (info) {
    const loc = str(info.location);
    if (loc) out.push(loc);
    if (Array.isArray(info.additionalLocations)) for (const l of info.additionalLocations) if (str(l)) out.push(str(l)!);
  } else if (listing && !/^\d+ Locations?$/i.test(listing)) {
    out.push(listing);
  }
  return out.slice(0, 20);
}

function structured(info: Json | null): ProviderPosting["structuredLocations"] {
  if (!info) return [];
  const req = isObject(info.jobRequisitionLocation) ? info.jobRequisitionLocation : null;
  const country = req && isObject(req.country) ? str(req.country.alpha2Code) ?? str(req.country.descriptor) : isObject(info.country) ? str(info.country.descriptor) : null;
  if (!country) return [];
  // Workday location descriptors are tenant-defined ("CA-ON-Toronto", "Toronto, Ontario"); only a recognisable province is used.
  const text = str(info.location) ?? (req ? str(req.descriptor) : null) ?? "";
  const region = text.split(/[,\-–]/).map((p) => p.trim()).find((p) => provinceFrom(p)) ?? null;
  return [{ country, region, city: null, remote: null, hybrid: null }];
}

function siteFor(transport: { site?: () => import("../../discovery/net").SiteFetcher }) {
  return transport.site?.() ?? null;
}

export const workdayAdapter: AtsAdapter = {
  provider: "workday",
  documentation: "Public Workday career site JSON (CXS); undocumented — see docs/career-sources.md",
  async fetchPostings(boardToken, { transport, signal, timeoutMs, enrichedPostingIds, limits }) {
    const ep = workdayEndpoints(boardToken);
    if (!ep) throw new AtsError("invalid_board", "The Workday career-site identifier is not valid.");
    if (!transport.postJson) throw new AtsError("blocked_host", "This transport cannot read Workday career sites.");
    const lim = { ...WORKDAY_DEFAULT_LIMITS, ...limits };
    const warnings: string[] = [];
    let requests = 0;

    // robots.txt of the career-site host is honoured for the JSON endpoints too.
    const site = siteFor(transport);
    if (site?.allowed) {
      const allowed = await site.allowed(`${ep.cxsBase}/jobs`, signal);
      requests += 1;
      if (!allowed.ok && allowed.failure === "robots_disallowed") throw new AtsError("blocked_host", `Workday site ${ep.host}: ${allowed.message}`);
      if (!allowed.ok && allowed.failure !== "network") throw new AtsError("blocked_host", `Workday site ${ep.host} was refused by the network policy: ${allowed.message}`);
    }

    // --- Listing
    const byId = new Map<string, { title: string; path: string; locations: string | null; bullets: string[]; postedOn: string | null }>();
    let total: number | null = null;
    let malformed = 0;
    let truncated = false;
    let shortPage = false;
    for (let page = 0; ; page++) {
      if (page >= lim.maxListingPages) {
        truncated = true;
        break;
      }
      if (page > 0) await sleep(lim.minIntervalMs, signal);
      const data = expectObject(
        await transport.postJson(`${ep.cxsBase}/jobs`, { appliedFacets: {}, limit: WORKDAY_PAGE_SIZE, offset: page * WORKDAY_PAGE_SIZE, searchText: "" }, { signal, timeoutMs }),
        "Workday",
      );
      requests++;
      if (!Array.isArray(data.jobPostings)) throw new AtsError("invalid_response", "Workday response has no jobPostings list.");
      if (page === 0) {
        if (typeof data.total !== "number" || !Number.isInteger(data.total) || data.total < 0) throw new AtsError("invalid_response", "Workday response has no total.");
        total = data.total;
      }
      for (const item of data.jobPostings) {
        const path = isObject(item) ? str(item.externalPath) : null;
        const id = path ? workdayPostingId(path) : null;
        const title = isObject(item) ? str(item.title) : null;
        if (!isObject(item) || !id || !title || !path) {
          malformed++;
          continue;
        }
        if (!byId.has(id)) {
          byId.set(id, {
            title,
            path,
            locations: str(item.locationsText),
            bullets: Array.isArray(item.bulletFields) ? item.bulletFields.map(str).filter((b): b is string => !!b).slice(0, 5) : [],
            postedOn: str(item.postedOn),
          });
        }
      }
      const seenSoFar = (page + 1) * WORKDAY_PAGE_SIZE;
      if (seenSoFar >= (total ?? 0)) break;
      if (data.jobPostings.length < WORKDAY_PAGE_SIZE) {
        shortPage = true; // fewer than promised before reaching total: a gap
        break;
      }
    }
    if (malformed > 0) warnings.push(`Skipped ${malformed} Workday listing${malformed === 1 ? "" : "s"} without a usable path or title.`);

    // --- Details (description, full locations), capped and prioritised:
    // not-yet-enriched first; among them, ones whose listing mentions Canada or
    // has several locations (only the detail says where).
    const ids = [...byId.keys()];
    const likelyRelevant = (id: string) => {
      const l = byId.get(id)!.locations ?? "";
      return /canada|\b(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|YT|NT|NU)\b|toronto|montr[eé]al|vancouver|ottawa|waterloo|calgary|edmonton|remote|\d+ locations?/i.test(l);
    };
    const order = [...ids].sort((a, b) => {
      const ea = enrichedPostingIds?.has(a) ? 1 : 0;
      const eb = enrichedPostingIds?.has(b) ? 1 : 0;
      return ea - eb || Number(likelyRelevant(b)) - Number(likelyRelevant(a));
    });
    const details = new Map<string, Json>();
    let detailFailures = 0;
    for (const id of order.slice(0, lim.maxDetailPages)) {
      if (signal?.aborted) throw new AtsError("cancelled", "The sync was cancelled.");
      await sleep(lim.minIntervalMs, signal);
      try {
        const data = expectObject(await transport.getJson(`${ep.cxsBase}${byId.get(id)!.path}`, { signal, timeoutMs }), "Workday");
        requests++;
        if (isObject(data.jobPostingInfo)) details.set(id, data.jobPostingInfo);
        else detailFailures++;
      } catch (error) {
        requests++;
        if (error instanceof AtsError && (error.code === "cancelled" || error.code === "rate_limited")) throw error;
        detailFailures++;
      }
    }
    if (detailFailures > 0) warnings.push(`${detailFailures} Workday job detail${detailFailures === 1 ? "" : "s"} could not be loaded; their stored descriptions are kept.`);

    const postings: ProviderPosting[] = ids.map((id) => {
      const l = byId.get(id)!;
      const info = details.get(id) ?? null;
      const remote = info ? str(info.remoteType)?.toLowerCase() : null;
      return {
        postingId: id,
        title: (info && str(info.title)) || l.title,
        url: (info && safeUrl(info.externalUrl)) || `https://${ep.host}/${ep.site}${l.path}`,
        descriptionText: info ? htmlToText(str(info.jobDescription)) : "",
        descriptionFetched: info !== null,
        locationTexts: locationTexts(info, l.locations),
        structuredLocations: structured(info),
        workplace: remote ? (REMOTE[remote] ?? null) : null,
        employmentType: info ? str(info.timeType) : null,
        department: null,
        ...published(info && str(info.startDate) && !Number.isNaN(Date.parse(str(info.startDate)!)) ? new Date(str(info.startDate)!).toISOString() : null, "last_published"),
        metadata: {
          requisitionId: (info && str(info.jobReqId)) ?? l.bullets[0] ?? null,
          externalPath: l.path,
          timeType: info ? str(info.timeType) : null,
          postedOn: l.postedOn,
          listingLocations: l.locations,
          ...(info && isObject(info.country) ? { country: str(info.country.descriptor) } : {}),
        },
      };
    });

    const deferred = postings.filter((p) => p.descriptionFetched === false).length;
    return {
      postings,
      warnings,
      requests,
      invalidItems: malformed,
      enrichmentDeferred: deferred,
      strategy: "workday_cxs",
      ...completeness(
        MALFORMED_REASON(malformed),
        truncated && `Stopped listing after ${lim.maxListingPages} pages of ${WORKDAY_PAGE_SIZE}.`,
        shortPage && "Workday returned a short page before the reported total.",
        total !== null && total >= WORKDAY_TOTAL_CAP && `Workday reports at most ${WORKDAY_TOTAL_CAP} postings, so a listing this large cannot be proven complete.`,
        total !== null && total < WORKDAY_TOTAL_CAP && !truncated && !shortPage && malformed === 0 && byId.size !== total && `Workday reported ${total} jobs but ${byId.size} distinct postings were listed.`,
      ),
    };
  },
};
