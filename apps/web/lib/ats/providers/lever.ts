/**
 * Lever Postings API — https://github.com/lever/postings-api
 * GET https://api.lever.co/v0/postings/{site}?mode=json&skip={n}&limit={n}
 * Public, offset-paginated (skip/limit). Published postings only.
 * Structured: `country` (ISO alpha-2, may be null), `workplaceType`
 * (on-site | remote | hybrid | unspecified), `categories.commitment`.
 * No documented publication timestamp (an undocumented `createdAt` is kept in
 * metadata only), so no latency is claimed.
 * EU-hosted accounts use https://api.eu.lever.co (board URL jobs.eu.lever.co);
 * the region comes from the registered board, never from the user's location.
 */
import { htmlToText } from "../html";
import { AtsError } from "../http";
import { completeness, MALFORMED_REASON, type AtsAdapter, type ProviderPosting } from "../types";
import { boardPath, idString, isObject, safeUrl, str } from "./util";
import type { WorkArrangement } from "../../types";

export const LEVER_PAGE_SIZE = 100;
export const LEVER_MAX_PAGES = 20;

const WORKPLACE: Record<string, WorkArrangement> = { "on-site": "onsite", onsite: "onsite", remote: "remote", hybrid: "hybrid" };

export const leverAdapter: AtsAdapter = {
  provider: "lever",
  documentation: "https://github.com/lever/postings-api",
  async fetchPostings(boardToken, { transport, signal, timeoutMs, region }) {
    const site = boardPath(boardToken);
    // EU-hosted Lever accounts are served from api.eu.lever.co (taken from the board URL).
    const apiHost = region === "eu" ? "api.eu.lever.co" : "api.lever.co";
    const postings: ProviderPosting[] = [];
    const warnings: string[] = [];
    let requests = 0;
    let malformed = 0;
    for (let page = 0; page < LEVER_MAX_PAGES; page++) {
      const url = `https://${apiHost}/v0/postings/${site}?mode=json&skip=${page * LEVER_PAGE_SIZE}&limit=${LEVER_PAGE_SIZE}`;
      const data = await transport.getJson(url, { signal, timeoutMs });
      requests++;
      if (!Array.isArray(data)) throw new AtsError("invalid_response", "Lever response is not a list of postings.");

      for (const item of data) {
        const id = isObject(item) ? idString(item.id) : null;
        const title = isObject(item) ? str(item.text) : null;
        if (!isObject(item) || !id || !title) {
          warnings.push("Skipped a Lever posting without an id or title.");
          malformed++;
          continue;
        }
        const cat = isObject(item.categories) ? item.categories : {};
        const allLocations = Array.isArray(cat.allLocations) ? cat.allLocations.map(str).filter((x): x is string => !!x) : [];
        const lists = Array.isArray(item.lists) ? item.lists.filter(isObject) : [];
        const country = str(item.country);
        const workplace = WORKPLACE[String(item.workplaceType ?? "").toLowerCase()] ?? null;
        const locationTexts = Array.from(new Set([str(cat.location), ...allLocations].filter((x): x is string => !!x)));
        postings.push({
          postingId: id,
          title,
          url: safeUrl(item.hostedUrl),
          descriptionText: [
            str(item.descriptionPlain) ?? htmlToText(str(item.description)),
            ...lists.map((l) => `${str(l.text) ?? ""}\n${htmlToText(str(l.content))}`),
            str(item.additionalPlain) ?? htmlToText(str(item.additional)),
          ]
            .filter((x) => x && x.trim())
            .join("\n\n")
            .trim(),
          locationTexts,
          // Lever's country applies to the posting; pair it with each location text.
          structuredLocations: country
            ? (locationTexts.length > 0 ? locationTexts : [null]).map((text) => ({
                country,
                region: text?.split(",")[1]?.trim() ?? null,
                city: text?.split(",")[0]?.trim() ?? null,
                remote: workplace === "remote",
                hybrid: workplace === "hybrid",
              }))
            : [],
          workplace,
          employmentType: str(cat.commitment),
          department: str(cat.department) ?? str(cat.team),
          publishedAt: null,
          publishedAtKind: "none",
          metadata: {
            categories: cat,
            country,
            workplaceType: item.workplaceType ?? null,
            createdAt_undocumented: item.createdAt ?? null,
            salaryRange: item.salaryRange ?? null,
          },
        });
      }
      // A short page is the end of the catalogue.
      if (data.length < LEVER_PAGE_SIZE) return { postings, warnings, requests, invalidItems: malformed, ...completeness(MALFORMED_REASON(malformed)) };
    }
    const truncated = `Stopped after ${LEVER_MAX_PAGES} pages (${LEVER_MAX_PAGES * LEVER_PAGE_SIZE} postings); later pages were not read.`;
    warnings.push(truncated);
    return { postings, warnings, requests, invalidItems: malformed, ...completeness(MALFORMED_REASON(malformed), truncated) };
  },
};
