/**
 * Greenhouse Job Board API — https://developers.greenhouse.io/job-board.html
 * GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true
 * Public, unauthenticated, not paginated. `content` is entity-encoded HTML.
 * Location is free text (`location.name`, plus office names/locations).
 * No employment-type field (custom `metadata` may contain one). The list
 * exposes `updated_at` only — not a publication time — so no latency is claimed.
 */
import { htmlToText } from "../html";
import { AtsError } from "../http";
import { completeness, MALFORMED_REASON, type AtsAdapter, type ProviderPosting } from "../types";
import { boardPath, expectObject, idString, isObject, published, safeUrl, str, timestamp } from "./util";

export const greenhouseAdapter: AtsAdapter = {
  provider: "greenhouse",
  documentation: "https://developers.greenhouse.io/job-board.html",
  async fetchPostings(boardToken, { transport, signal, timeoutMs }) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${boardPath(boardToken)}/jobs?content=true`;
    const data = expectObject(await transport.getJson(url, { signal, timeoutMs }), "Greenhouse");
    const jobs = Array.isArray(data.jobs) ? data.jobs : null;
    if (!jobs) throw new AtsError("invalid_response", "Greenhouse response has no jobs list.");

    const postings: ProviderPosting[] = [];
    const warnings: string[] = [];
    let malformed = 0;
    for (const item of jobs) {
      const id = isObject(item) ? idString(item.id) : null;
      const title = isObject(item) ? str(item.title) : null;
      if (!isObject(item) || !id || !title) {
        warnings.push(`Skipped a Greenhouse job without an id or title.`);
        malformed++;
        continue;
      }
      const offices = Array.isArray(item.offices) ? item.offices.filter(isObject) : [];
      const metadata = Array.isArray(item.metadata) ? item.metadata.filter(isObject) : [];
      const employment = metadata.find((m) => /employment|job type|commitment/i.test(String(m.name ?? "")));
      postings.push({
        postingId: id,
        title,
        url: safeUrl(item.absolute_url),
        descriptionText: htmlToText(str(item.content)),
        locationTexts: [
          isObject(item.location) ? str(item.location.name) : null,
          ...offices.map((o) => str(o.location) ?? str(o.name)),
        ].filter((x): x is string => !!x),
        structuredLocations: [],
        workplace: null,
        employmentType: employment ? str(employment.value) : null,
        department: Array.isArray(item.departments) && isObject(item.departments[0]) ? str(item.departments[0].name) : null,
        ...published(timestamp(item.updated_at), "updated"),
        metadata: {
          internal_job_id: item.internal_job_id ?? null,
          requisition_id: item.requisition_id ?? null,
          updated_at: item.updated_at ?? null,
          language: item.language ?? null,
          location: isObject(item.location) ? item.location.name ?? null : null,
          offices: offices.map((o) => ({ name: o.name ?? null, location: o.location ?? null })),
        },
      });
    }
    // The list is unpaginated; `meta.total` (when present) must match what we received.
    const total = isObject(data.meta) && typeof data.meta.total === "number" ? data.meta.total : null;
    return {
      postings,
      warnings,
      requests: 1,
      invalidItems: malformed,
      ...completeness(
        MALFORMED_REASON(malformed),
        total !== null && total !== jobs.length && `Greenhouse reported ${total} jobs but returned ${jobs.length}.`,
      ),
    };
  },
};
