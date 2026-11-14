/** In-memory site and Workday fakes for tests (no network). */
import { AtsError, type HttpTransport } from "../../ats/http";
import { recognizeAtsUrl } from "../../boards/board-url";
import { checkSiteUrl, type PageResult, type SiteFetcher } from "../../discovery/net";

export type FakePage = string | { html?: string; redirect?: string; status?: number; failure?: "robots_disallowed" | "timeout" | "network" | "blocked_address" };

/** Pages keyed by exact URL (canonical, no trailing slash except the root). XML pages via `xml:<url>`; renders via `render:<url>`. */
export function fakeSite(pages: Record<string, FakePage>, options: { render?: boolean } = {}): SiteFetcher & { calls: string[] } {
  const calls: string[] = [];
  let requests = 0;
  const key = (u: string) => {
    const url = new URL(u);
    url.hash = "";
    if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString();
  };
  const lookup = (u: string, prefix = ""): PageResult => {
    const checked = checkSiteUrl(u);
    if (!checked.ok) return { ok: false, url: u, failure: "blocked_url", message: checked.reason };
    const page = pages[`${prefix}${key(u)}`] ?? pages[`${prefix}${u}`];
    if (page === undefined) return { ok: false, url: u, failure: "http_error", message: "HTTP 404 from site." };
    const p = typeof page === "string" ? { html: page } : page;
    if (p.failure) return { ok: false, url: u, failure: p.failure, message: `${p.failure}` };
    if (p.redirect) {
      if (recognizeAtsUrl(p.redirect)) return { ok: true, url: u, finalUrl: u, status: 302, html: null, redirects: [p.redirect], atsRedirect: p.redirect };
      return lookup(p.redirect, prefix);
    }
    if (p.status && p.status >= 400) return { ok: false, url: u, failure: "http_error", message: `HTTP ${p.status} from site.` };
    return { ok: true, url: u, finalUrl: u, status: 200, html: p.html ?? "", redirects: [] };
  };
  const fetcher: SiteFetcher & { calls: string[] } = {
    calls,
    get requests() {
      return requests;
    },
    async fetchPage(u, _signal, opts) {
      requests++;
      calls.push(`${opts?.accept === "xml" ? "xml:" : ""}${u}`);
      return lookup(u, opts?.accept === "xml" ? "xml:" : "");
    },
    async allowed(u) {
      const c = checkSiteUrl(u);
      return c.ok ? { ok: true } : { ok: false, failure: "blocked_url", message: c.reason };
    },
  };
  if (options.render) {
    fetcher.render = async (u) => {
      requests++;
      calls.push(`render:${u}`);
      return lookup(u, "render:");
    };
  }
  return fetcher;
}

export interface FakeWorkdaySite {
  total: number;
  /** Listing items in order; paged by 20 like Workday. */
  items: { title: string; externalPath: string; locationsText?: string; bulletFields?: string[] }[];
  details?: Record<string, unknown>;
  /** Override a page's response (by offset). */
  pageOverride?: Record<number, unknown>;
  /** Report total on later pages too (some tenants do). */
  totalOnEveryPage?: boolean;
}

/** Workday CXS fake keyed by cxs base ("https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/external"). */
export function fakeWorkday(sites: Record<string, FakeWorkdaySite>, site?: SiteFetcher): HttpTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async postJson(url, body) {
      calls.push(`POST ${url} ${JSON.stringify(body)}`);
      const base = url.replace(/\/jobs$/, "");
      const s = sites[base];
      if (!s) throw new AtsError("not_found", "The provider has no public board with this identifier.", 404);
      const offset = (body as { offset: number }).offset;
      if (s.pageOverride && offset in s.pageOverride) {
        const o = s.pageOverride[offset];
        if (o instanceof Error) throw o;
        return o;
      }
      const limit = (body as { limit: number }).limit;
      return { total: offset === 0 || s.totalOnEveryPage ? s.total : 0, jobPostings: s.items.slice(offset, offset + limit), facets: [] };
    },
    async getJson(url) {
      calls.push(`GET ${url}`);
      for (const [base, s] of Object.entries(sites)) {
        if (url.startsWith(base)) {
          const path = url.slice(base.length);
          const d = s.details?.[path];
          if (d instanceof Error) throw d;
          if (d) return d;
          throw new AtsError("not_found", "Not found", 404);
        }
      }
      throw new AtsError("not_found", "Not found", 404);
    },
    ...(site ? { site: () => site } : {}),
  };
}

export function workdayDetail(over: { title: string; location?: string; description?: string; reqId?: string; timeType?: string; externalUrl?: string }) {
  return {
    jobPostingInfo: {
      title: over.title,
      jobDescription: over.description ?? "<p>You will build backend services. Responsibilities include testing.</p><p>Qualifications: experience with TypeScript. Apply now.</p>".repeat(3),
      location: over.location ?? "Toronto, ON",
      timeType: over.timeType ?? "Full time",
      jobReqId: over.reqId ?? "R1",
      startDate: "2030-01-15",
      externalUrl: over.externalUrl,
    },
    hiringOrganization: { name: "Acme Corp", url: "" },
  };
}
