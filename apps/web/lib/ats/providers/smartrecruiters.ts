/**
 * SmartRecruiters Posting API — https://developers.smartrecruiters.com/docs/posting-api
 * List:   GET https://api.smartrecruiters.com/v1/companies/{companyIdentifier}/postings?limit=100&offset={n}
 * Detail: GET https://api.smartrecruiters.com/v1/companies/{companyIdentifier}/postings/{postingId}
 * Public postings need no credentials. Offset-paginated (limit max 100).
 * Structured `location` (country ISO-2, region, city, remote, hybrid) and
 * `typeOfEmployment`. `releasedDate` is "the date when a posting has been
 * released" and is the only first-publication time among the four providers.
 * The list omits descriptions and URLs, so details are fetched — only for
 * postings whose structured country is Canada, sequentially, and capped,
 * to stay well under the documented 10 requests/second limit.
 * Company identifiers are stored lowercase by the board registry; the API is
 * expected to match them case-insensitively (verify with the smoke test).
 */
import { htmlToText } from "../html";
import { AtsError } from "../http";
import { completeness, MALFORMED_REASON, type AtsAdapter, type ProviderPosting } from "../types";
import { boardPath, expectObject, idString, isObject, published, safeUrl, str, timestamp, type Json } from "./util";

export const SR_PAGE_SIZE = 100;
export const SR_MAX_PAGES = 10;
export const SR_MAX_DETAILS = 150;

export const smartRecruitersAdapter: AtsAdapter = {
  provider: "smartrecruiters",
  documentation: "https://developers.smartrecruiters.com/docs/posting-api",
  async fetchPostings(boardToken, { transport, signal, timeoutMs, enrichedPostingIds }) {
    const company = boardPath(boardToken);
    const base = `https://api.smartrecruiters.com/v1/companies/${company}/postings`;
    const items: Json[] = [];
    const warnings: string[] = [];
    let requests = 0;
    let reachedEnd = false;
    let reportedTotal: number | null = null;
    let rawCount = 0;

    for (let page = 0; page < SR_MAX_PAGES; page++) {
      const data = expectObject(
        await transport.getJson(`${base}?limit=${SR_PAGE_SIZE}&offset=${page * SR_PAGE_SIZE}`, { signal, timeoutMs }),
        "SmartRecruiters",
      );
      requests++;
      if (!Array.isArray(data.content)) throw new AtsError("invalid_response", "SmartRecruiters response has no content list.");
      items.push(...data.content.filter(isObject));
      rawCount += data.content.length;
      const total = typeof data.totalFound === "number" ? data.totalFound : 0;
      reportedTotal = typeof data.totalFound === "number" ? data.totalFound : reportedTotal;
      if (data.content.length < SR_PAGE_SIZE || (page + 1) * SR_PAGE_SIZE >= total) {
        reachedEnd = true;
        break;
      }
      if (page === SR_MAX_PAGES - 1) warnings.push(`Stopped listing after ${SR_MAX_PAGES} pages.`);
    }
    let malformed = rawCount - items.length;

    // Description enrichment (one request per posting) is capped at SR_MAX_DETAILS
    // Canadian postings per run. Postings without a stored description go first,
    // then refreshes, so capped runs resume where the last one stopped. This cap
    // affects descriptions only — never listing completeness.
    const canadianIds = items
      .filter((item) => isObject(item.location) && str(item.location.country)?.toLowerCase() === "ca")
      .map((item) => idString(item.id))
      .filter((id): id is string => !!id);
    const needsFirst = canadianIds.filter((id) => !enrichedPostingIds?.has(id.toLowerCase()));
    const refresh = canadianIds.filter((id) => enrichedPostingIds?.has(id.toLowerCase()));
    const toEnrich = new Set([...needsFirst, ...refresh].slice(0, SR_MAX_DETAILS));
    const enrichmentDeferred = canadianIds.length - toEnrich.size;

    const postings: ProviderPosting[] = [];
    for (const item of items) {
      const id = idString(item.id);
      const title = str(item.name);
      if (!id || !title) {
        warnings.push("Skipped a SmartRecruiters posting without an id or name.");
        malformed++;
        continue;
      }
      const loc = isObject(item.location) ? item.location : {};
      const country = str(loc.country);
      const structured = [
        { country, region: str(loc.region), city: str(loc.city), remote: loc.remote === true, hybrid: loc.hybrid === true },
      ];
      const workplace = loc.remote === true ? "remote" : loc.hybrid === true ? "hybrid" : country ? "onsite" : null;

      // Descriptions only for Canadian postings: avoids hundreds of irrelevant requests.
      let detail: Json | null = null;
      let detailFailed = false;
      if (toEnrich.has(id)) {
        try {
          detail = expectObject(await transport.getJson(`${base}/${encodeURIComponent(id)}`, { signal, timeoutMs }), "posting");
          requests++;
        } catch (error) {
          if (error instanceof AtsError && (error.code === "cancelled" || error.code === "rate_limited")) throw error;
          detailFailed = true;
          requests++;
          warnings.push(`Could not load details for posting ${id}: ${error instanceof Error ? error.message : "error"}`);
        }
      }
      const sections = detail && isObject(detail.jobAd) && isObject(detail.jobAd.sections) ? detail.jobAd.sections : {};
      const text = ["companyDescription", "jobDescription", "qualifications", "additionalInformation"]
        .map((key) => (isObject(sections[key]) ? sections[key] : null))
        .filter((s): s is Json => s !== null)
        .map((s) => `${str(s.title) ?? ""}\n${htmlToText(str(s.text))}`.trim())
        .join("\n\n");
      const typeOfEmployment = isObject(item.typeOfEmployment) ? str(item.typeOfEmployment.label) : null;

      postings.push({
        postingId: id,
        title,
        url: safeUrl(detail?.postingUrl) ?? `https://jobs.smartrecruiters.com/${company}/${encodeURIComponent(id)}`,
        descriptionText: text,
        // Canadian postings whose detail was not loaded this run keep their stored description.
        descriptionFetched: country?.toLowerCase() !== "ca" || (detail !== null && !detailFailed),
        locationTexts: [[str(loc.city), str(loc.region), country].filter(Boolean).join(", ")].filter(Boolean),
        structuredLocations: structured,
        workplace,
        employmentType: typeOfEmployment,
        department: isObject(item.department) ? str(item.department.label) : null,
        ...published(timestamp(item.releasedDate), "first_published"),
        metadata: {
          uuid: item.uuid ?? null,
          refNumber: item.refNumber ?? null,
          releasedDate: item.releasedDate ?? null,
          location: loc,
          typeOfEmployment: item.typeOfEmployment ?? null,
          experienceLevel: item.experienceLevel ?? null,
          function: item.function ?? null,
          active: detail?.active ?? null,
        },
      });
    }
    // Detail-page failures only cost a description; the listing itself still
    // identifies every posting, so they do not make the catalogue incomplete.
    return {
      postings,
      warnings,
      requests,
      invalidItems: malformed,
      enrichmentDeferred,
      ...completeness(
        MALFORMED_REASON(malformed),
        !reachedEnd && `Stopped listing after ${SR_MAX_PAGES} pages; later pages were not read.`,
        reachedEnd && reportedTotal !== null && rawCount < reportedTotal && `SmartRecruiters reported ${reportedTotal} postings but returned ${rawCount}.`,
      ),
    };
  },
};
