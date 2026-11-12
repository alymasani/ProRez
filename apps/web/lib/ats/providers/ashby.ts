/**
 * Ashby public job posting API — https://developers.ashbyhq.com/docs/public-job-posting-api
 * GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}?includeCompensation=false
 * Public, not paginated. Structured `address.postalAddress` (addressCountry,
 * addressRegion, addressLocality), `workplaceType` (OnSite | Remote | Hybrid),
 * `employmentType` (FullTime | PartTime | Intern | Contract | Temporary).
 * `publishedAt` is when the job was LAST published (a republish resets it), so
 * it is stored but never used for discovery latency. No job id is documented;
 * the `id` field is used when present, otherwise the id in `jobUrl`.
 * Unlisted jobs (`isListed: false`) are skipped.
 */
import { htmlToText } from "../html";
import { AtsError } from "../http";
import { completeness, MALFORMED_REASON, type AtsAdapter, type ProviderPosting } from "../types";
import type { StructuredLocation } from "../canada";
import type { WorkArrangement } from "../../types";
import { boardPath, expectObject, idString, isObject, published, safeUrl, str, timestamp, type Json } from "./util";

const WORKPLACE: Record<string, WorkArrangement> = { onsite: "onsite", remote: "remote", hybrid: "hybrid" };

function address(a: unknown, workplace: WorkArrangement | null): StructuredLocation | null {
  const postal = isObject(a) && isObject(a.postalAddress) ? a.postalAddress : isObject(a) ? a : null;
  if (!postal) return null;
  const country = str(postal.addressCountry);
  if (!country) return null;
  return {
    country,
    region: str(postal.addressRegion),
    city: str(postal.addressLocality),
    remote: workplace === "remote",
    hybrid: workplace === "hybrid",
  };
}

export const ashbyAdapter: AtsAdapter = {
  provider: "ashby",
  documentation: "https://developers.ashbyhq.com/docs/public-job-posting-api",
  async fetchPostings(boardToken, { transport, signal, timeoutMs }) {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${boardPath(boardToken)}?includeCompensation=false`;
    const data = expectObject(await transport.getJson(url, { signal, timeoutMs }), "Ashby");
    if (!Array.isArray(data.jobs)) throw new AtsError("invalid_response", "Ashby response has no jobs list.");

    const postings: ProviderPosting[] = [];
    const warnings: string[] = [];
    let unlisted = 0;
    let malformed = 0;
    for (const item of data.jobs as unknown[]) {
      if (!isObject(item)) {
        warnings.push("Skipped a malformed Ashby job.");
        malformed++;
        continue;
      }
      const jobUrl = safeUrl(item.jobUrl);
      const id = idString(item.id) ?? (jobUrl ? new URL(jobUrl).pathname.split("/").filter(Boolean).pop() ?? null : null);
      const title = str(item.title);
      if (!id || !title) {
        warnings.push("Skipped an Ashby job without an id or title.");
        malformed++;
        continue;
      }
      if (item.isListed === false) {
        unlisted++;
        continue;
      }
      const workplace = WORKPLACE[String(item.workplaceType ?? "").toLowerCase()] ?? (item.isRemote === true ? "remote" : null);
      const secondary = Array.isArray(item.secondaryLocations) ? item.secondaryLocations.filter(isObject) : [];
      postings.push({
        postingId: id,
        title,
        url: jobUrl,
        descriptionText: str(item.descriptionPlain) ?? htmlToText(str(item.descriptionHtml)),
        locationTexts: [str(item.location), ...secondary.map((s: Json) => str(s.location))].filter((x): x is string => !!x),
        structuredLocations: [address(item.address, workplace), ...secondary.map((s: Json) => address(s.address, workplace))].filter(
          (x): x is StructuredLocation => x !== null,
        ),
        workplace,
        employmentType: str(item.employmentType),
        department: str(item.department) ?? str(item.team),
        ...published(timestamp(item.publishedAt), "last_published"),
        metadata: {
          department: item.department ?? null,
          team: item.team ?? null,
          employmentType: item.employmentType ?? null,
          workplaceType: item.workplaceType ?? null,
          isRemote: item.isRemote ?? null,
          publishedAt: item.publishedAt ?? null,
          location: item.location ?? null,
        },
      });
    }
    if (unlisted > 0) warnings.push(`Skipped ${unlisted} unlisted job${unlisted === 1 ? "" : "s"} (direct-link only).`);
    // Unlisted (direct-link-only) jobs are excluded on purpose, not lost.
    return { postings, warnings, requests: 1, invalidItems: malformed, ...completeness(MALFORMED_REASON(malformed)) };
  },
};
