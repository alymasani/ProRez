/** Milestone 3D: generic career-site parsing (strategies 1–5) and Workday. No network. */
import { describe, expect, it } from "vitest";
import { workdayAdapter, workdayPostingId } from "../ats/providers/workday";
import { genericAdapter } from "../ats/providers/generic";
import { AtsError } from "../ats/http";
import { normalizePosting } from "../ats/normalize";
import { canonicalCareerUrl, isValidBoardToken, isWorkdayHost, recognizeAtsUrl, workdayEndpoints } from "../boards/board-url";
import { recognizeCareerPageUrl } from "../discovery/candidates";
import { detectAtsPosting } from "../jobs/url";
import { fakeSite, fakeWorkday, workdayDetail } from "./__fixtures__/fake";
import { extractCareerSite } from "./extract";
import { extractJsonLd } from "./jsonld";
import { parseSitemap, sitemapsFromRobots } from "./sitemap";
import { extractDetail, findJobLinks, findNextPage, isJobDetailUrl, looksLikeJobDescription } from "./static";

const DESC = "<p>About the role: you will build backend services and ship features.</p><h3>Responsibilities</h3><ul><li>Write tests</li><li>Review code</li></ul><h3>Qualifications</h3><p>Experience with TypeScript. Apply by sending your application.</p>".repeat(2);
const jobLd = (over: Record<string, unknown> = {}) => ({
  "@context": "https://schema.org",
  "@type": "JobPosting",
  title: "Software Developer Co-op",
  description: DESC,
  identifier: { "@type": "PropertyValue", value: "REQ-1" },
  hiringOrganization: { "@type": "Organization", name: "Acme Robotics", sameAs: "https://acme.ca" },
  jobLocation: { "@type": "Place", address: { addressLocality: "Toronto", addressRegion: "ON", addressCountry: "CA" } },
  employmentType: "INTERN",
  datePosted: "2030-01-10",
  url: "https://acme.ca/careers/software-developer-co-op",
  ...over,
});
const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const page = (body: string, head = "") => `<!doctype html><html><head>${head}</head><body><header><nav><a href="/">Home</a><a href="/careers">Careers</a><a href="/blog/our-culture">Life at Acme</a></nav></header><main>${body}</main><footer><a href="/privacy">Privacy</a></footer></body></html>`;

// ---------------------------------------------------------------------------
describe("JSON-LD JobPosting (strategy 1)", () => {
  it("reads single objects, arrays, @graph and nested postings; decodes HTML descriptions", () => {
    const html = [
      ld(jobLd()),
      ld([jobLd({ title: "Firmware Intern", identifier: "FW-2", url: "/careers/fw" }), { "@type": "Organization", name: "Acme Robotics" }]),
      ld({ "@context": "https://schema.org", "@graph": [{ "@type": "WebPage", mainEntity: jobLd({ title: "Data Engineer Intern", identifier: "DE-3" }) }] }),
    ].join("");
    const r = extractJsonLd(html, "https://acme.ca/careers");
    expect(r.jobs.map((j) => j.title)).toEqual(["Software Developer Co-op", "Firmware Intern", "Data Engineer Intern"]);
    expect(r.jobs[0]).toMatchObject({ identifier: "REQ-1", hiringOrganization: "Acme Robotics", locations: ["Toronto, ON, CA"], countries: ["CA"], employmentType: "INTERN" });
    expect(r.jobs[0].description).toMatch(/^About the role/);
    expect(r.jobs[0].description).not.toMatch(/</);
    expect(r.jobs[1].url).toBe("https://acme.ca/careers/fw");
    expect(r.organization).toBe("Acme Robotics");
  });

  it("skips malformed blocks and invalid postings without inventing data", () => {
    const html = `<script type="application/ld+json">{ not json</script>${ld({ "@type": "JobPosting", description: "no title" })}${ld(jobLd({ jobLocation: undefined, hiringOrganization: undefined, employmentType: undefined }))}`;
    const r = extractJsonLd(html, "https://acme.ca/");
    expect(r.malformedBlocks).toBe(1);
    expect(r.invalidPostings).toBe(1);
    expect(r.jobs).toHaveLength(1);
    expect(r.jobs[0]).toMatchObject({ locations: [], countries: [], hiringOrganization: null, employmentType: null });
  });

  it("handles entity-encoded descriptions, remote postings and salary", () => {
    const r = extractJsonLd(ld(jobLd({ description: "&lt;p&gt;Remote role&lt;/p&gt;", jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "Canada" }, baseSalary: { "@type": "MonetaryAmount", currency: "CAD", value: { "@type": "QuantitativeValue", minValue: 25, maxValue: 30, unitText: "HOUR" } } })), "https://acme.ca/");
    expect(r.jobs[0]).toMatchObject({ description: "Remote role", remote: true, salary: "CAD 25–30 per HOUR" });
    expect(r.jobs[0].countries).toContain("Canada");
  });
});

describe("sitemaps (strategy 2)", () => {
  it("parses url sets, indexes and robots.txt Sitemap lines", () => {
    expect(parseSitemap(`<?xml version="1.0"?><urlset><url><loc>https://acme.ca/careers/a</loc></url><url><loc><![CDATA[https://acme.ca/careers/b?x=1&amp;y=2]]></loc></url></urlset>`)).toEqual({ kind: "urlset", urls: ["https://acme.ca/careers/a", "https://acme.ca/careers/b?x=1&y=2"] });
    expect(parseSitemap(`<sitemapindex><sitemap><loc>https://acme.ca/sitemap-jobs.xml</loc></sitemap></sitemapindex>`).kind).toBe("index");
    expect(parseSitemap("<html>nope</html>")).toEqual({ kind: "unknown", urls: [] });
    expect(sitemapsFromRobots("User-agent: *\nDisallow:\nSitemap: https://acme.ca/sitemap.xml\nsitemap:https://acme.ca/jobs.xml")).toEqual(["https://acme.ca/sitemap.xml", "https://acme.ca/jobs.xml"]);
  });
});

describe("static HTML heuristics (strategy 3)", () => {
  const listing = page(`
    <h1>Open positions</h1>
    <ul>
      <li><a href="/careers/software-developer-intern">Software Developer Intern</a> Toronto</li>
      <li><a href="/careers/software-developer-intern?utm_source=x">Software Developer Intern</a></li>
      <li><a href="/careers/embedded-firmware-co-op#apply">Embedded Firmware Co-op</a></li>
      <li><a href="/careers/students">Students</a></li>
      <li><a href="/careers/benefits">Our benefits</a></li>
      <li><a href="/blog/2030/how-we-hire-engineers">How we hire engineers</a></li>
      <li><a href="https://other.com/careers/qa-analyst">QA Analyst</a></li>
      <li><a href="/careers/brochure.pdf">Careers brochure</a></li>
      <li><a href="mailto:jobs@acme.ca">Email us</a></li>
    </ul>`);

  it("finds job-detail links, deduplicated, without navigation, articles, assets or other sites", () => {
    expect(findJobLinks(listing, "https://acme.ca/careers").map((l) => l.url)).toEqual([
      "https://acme.ca/careers/software-developer-intern",
      "https://acme.ca/careers/embedded-firmware-co-op",
    ]);
  });

  it("classifies URLs conservatively", () => {
    const base = "https://acme.ca/careers";
    expect(isJobDetailUrl("https://acme.ca/careers", base)).toBe(false);
    expect(isJobDetailUrl("https://acme.ca/jobs/search", base)).toBe(false);
    expect(isJobDetailUrl("https://acme.ca/jobs/4821-backend-intern", base)).toBe(true);
    expect(isJobDetailUrl("https://acme.ca/apply?jobId=48213", base)).toBe(true);
    expect(isJobDetailUrl("https://acme.ca/about/team", base)).toBe(false);
    expect(isJobDetailUrl("https://acme.ca/news/jobs-report", base)).toBe(false);
  });

  it("follows rel=next / Next pagination on the same site only", () => {
    expect(findNextPage(`<a rel="next" href="?page=2">2</a>`, "https://acme.ca/careers")).toBe("https://acme.ca/careers?page=2");
    expect(findNextPage(`<a href="/careers?page=3">Next</a>`, "https://acme.ca/careers?page=2")).toBe("https://acme.ca/careers?page=3");
    expect(findNextPage(`<a href="https://evil.com/careers?page=2">Next</a>`, "https://acme.ca/careers")).toBeNull();
    expect(findNextPage(`<a href="/careers">Home</a>`, "https://acme.ca/careers")).toBeNull();
  });

  it("extracts a job page without structured data, ignoring header/nav/footer", () => {
    const d = extractDetail(page(`<h1>Embedded Firmware Co-op</h1><p>Location: Waterloo, ON</p>${DESC}<a href="/apply/77">Apply now</a>`), "https://acme.ca/careers/embedded-firmware-co-op");
    expect(d).toMatchObject({ title: "Embedded Firmware Co-op", location: "Waterloo, ON", applyUrl: "https://acme.ca/apply/77" });
    expect(d.description).not.toMatch(/Privacy|Home/);
    expect(looksLikeJobDescription(d.description)).toBe(true);
    expect(looksLikeJobDescription("Join our team! We are hiring.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("extractCareerSite (strategy orchestration)", () => {
  const detail = (title: string, extra = "") => page(`<h1>${title}</h1><p>Location: Toronto, ON</p>${DESC}${extra}`);

  it("JSON-LD on the listing with full descriptions → complete snapshot, no job pages needed", async () => {
    const site = fakeSite({ "https://acme.ca/careers": page("<h1>Jobs</h1>", ld([jobLd(), jobLd({ title: "Firmware Intern", identifier: "FW-2", url: "https://acme.ca/careers/fw" })])) });
    const x = await extractCareerSite("https://acme.ca/careers", site);
    expect(x).toMatchObject({ status: "ok", strategy: "json_ld", complete: true, companyName: "Acme Robotics" });
    expect(x.jobs.map((j) => j.postingId)).toEqual(["id:REQ-1", "id:FW-2"]);
    expect(site.calls).toEqual(["https://acme.ca/careers"]);
  });

  it("static links + job pages: identity from the requisition id; heuristic jobs make the snapshot incomplete", async () => {
    const site = fakeSite({
      "https://acme.ca/careers": page(`<a href="/careers/a-intern">Backend Developer Intern</a><a href="/careers/b-coop">QA Analyst Co-op</a>`),
      "https://acme.ca/careers/a-intern": page("<h1>Backend Developer Intern</h1>", ld(jobLd({ title: "Backend Developer Intern", identifier: "A1", url: "https://acme.ca/careers/a-intern" }))),
      "https://acme.ca/careers/b-coop": detail("QA Analyst Co-op"),
    });
    const x = await extractCareerSite("https://acme.ca/careers", site, { limits: { minIntervalMs: 0 } });
    expect(x.status).toBe("ok");
    expect(x.jobs.map((j) => [j.postingId, j.source])).toEqual([["id:A1", "structured"], ["u:/careers/b-coop", "static"]]);
    expect(x.complete).toBe(false);
    expect(x.incompleteReason).toMatch(/recognised heuristically/);
  });

  it("pagination is followed; an unreadable next page makes the snapshot incomplete", async () => {
    const detail = (title: string) => page(`<h1>${title}</h1>`, ld(jobLd({ title, identifier: title.replace(/\W/g, ""), url: undefined })));
    const pages = {
      "https://acme.ca/careers": page(`<a href="/careers/a-intern">Backend Developer Intern</a><a rel="next" href="/careers?page=2">Next</a>`),
      "https://acme.ca/careers?page=2": page(`<a href="/careers/b-intern">Data Analyst Intern</a>`),
      "https://acme.ca/careers/a-intern": detail("Backend Developer Intern"),
      "https://acme.ca/careers/b-intern": detail("Data Analyst Intern"),
    };
    const full = await extractCareerSite("https://acme.ca/careers", fakeSite(pages));
    expect(full.jobs).toHaveLength(2);
    expect(full.complete).toBe(true);
    const broken: Record<string, string> = { ...pages };
    delete broken["https://acme.ca/careers?page=2"];
    const partial = await extractCareerSite("https://acme.ca/careers", fakeSite(broken));
    expect(partial.jobs).toHaveLength(1);
    expect(partial.complete).toBe(false);
    expect(partial.incompleteReason).toMatch(/could not be read/);
  });

  it("caps job pages per sync and reports the snapshot incomplete", async () => {
    const links = Array.from({ length: 5 }, (_, i) => `<a href="/careers/role-${i}">Software Engineer Intern ${i}</a>`).join("");
    const pages: Record<string, string> = { "https://acme.ca/careers": page(links) };
    for (let i = 0; i < 5; i++) pages[`https://acme.ca/careers/role-${i}`] = detail(`Software Engineer Intern ${i}`);
    const x = await extractCareerSite("https://acme.ca/careers", fakeSite(pages), { limits: { maxDetailPages: 3 } });
    expect(x.jobs).toHaveLength(3);
    expect(x.complete).toBe(false);
    expect(x.incompleteReason).toMatch(/3 of 5 job pages/);
  });

  it("category, team and programme pages are not jobs (seen live on real careers sites)", async () => {
    const x = await extractCareerSite(
      "https://acme.ca/careers",
      fakeSite({
        "https://acme.ca/careers": page(`<a href="/careers/ml-engineers">Applied Machine Learning Engineers</a><a href="/careers/interns-graduates">Interns & Graduates</a><a href="/careers/internships-team">Join our Internships Team</a>`),
        "https://acme.ca/careers/ml-engineers": detail("Applied Machine Learning Engineers"),
        "https://acme.ca/careers/interns-graduates": detail("Interns & Graduates"),
        "https://acme.ca/careers/internships-team": detail("Join our Internships Team - Careers at Acme"),
        "xml:https://acme.ca/robots.txt": "",
      }),
    );
    expect(x.jobs).toEqual([]);
    expect(x.status).toBe("unsupported");
  });

  it("navigation and marketing pages linked like jobs are rejected, not ingested", async () => {
    const x = await extractCareerSite(
      "https://acme.ca/careers",
      fakeSite({
        "https://acme.ca/careers": page(`<a href="/careers/engineering-at-acme">Engineering at Acme</a><a href="/careers/a-intern">Backend Developer Intern</a>`),
        "https://acme.ca/careers/engineering-at-acme": page("<h1>Engineering at Acme</h1><p>We love building things together. Our culture is great.</p>"),
        "https://acme.ca/careers/a-intern": detail("Backend Developer Intern"),
      }),
    );
    expect(x.jobs.map((j) => j.title)).toEqual(["Backend Developer Intern"]);
    expect(x.rejectedCandidates).toBe(1);
    expect(x.complete).toBe(false); // an unconfirmed linked page means we cannot vouch for exhaustiveness
  });

  it("falls back to sitemaps only when the page lists nothing; sitemap snapshots are never complete", async () => {
    const site = fakeSite({
      "https://acme.ca/careers": page("<h1>Careers</h1><p>See our openings.</p>"),
      "xml:https://acme.ca/robots.txt": "User-agent: *\nSitemap: https://acme.ca/sitemap_index.xml",
      "xml:https://acme.ca/sitemap_index.xml": "<sitemapindex><sitemap><loc>https://acme.ca/sitemap-pages.xml</loc></sitemap><sitemap><loc>https://acme.ca/sitemap-jobs.xml</loc></sitemap></sitemapindex>",
      "xml:https://acme.ca/sitemap-jobs.xml": "<urlset><url><loc>https://acme.ca/careers/backend-intern</loc></url><url><loc>https://acme.ca/blog/post</loc></url></urlset>",
      "https://acme.ca/careers/backend-intern": detail("Backend Developer Intern"),
    });
    const x = await extractCareerSite("https://acme.ca/careers", site);
    expect(x).toMatchObject({ status: "ok", strategy: "sitemap", complete: false });
    expect(x.jobs.map((j) => j.title)).toEqual(["Backend Developer Intern"]);
    // Career-looking child sitemaps are read first; sitemap reads are bounded (≤ 4 documents).
    const xml = site.calls.filter((c) => c.startsWith("xml:") && !c.endsWith("robots.txt"));
    expect(xml.indexOf("xml:https://acme.ca/sitemap-jobs.xml")).toBeLessThan(xml.indexOf("xml:https://acme.ca/sitemap-pages.xml"));
    expect(xml.length).toBeLessThanOrEqual(4);
  });

  it("renders only when static strategies found nothing (never when static extraction works)", async () => {
    const shell = page(`<div id="root"></div><script src="/app.js"></script>`);
    const rendered = page(`<a href="/careers/a-intern">Backend Developer Intern</a>`);
    const jsSite = fakeSite({ "https://acme.ca/careers": shell, "render:https://acme.ca/careers": rendered, "https://acme.ca/careers/a-intern": detail("Backend Developer Intern"), "xml:https://acme.ca/robots.txt": "" }, { render: true });
    const x = await extractCareerSite("https://acme.ca/careers", jsSite);
    expect(x).toMatchObject({ status: "ok", strategy: "rendered", complete: false, rendered: 1 });

    const staticSite = fakeSite({ "https://acme.ca/careers": rendered, "https://acme.ca/careers/a-intern": detail("Backend Developer Intern") }, { render: true });
    const y = await extractCareerSite("https://acme.ca/careers", staticSite);
    expect(y.rendered).toBe(0);
    expect(staticSite.calls.some((c) => c.startsWith("render:"))).toBe(false);
  });

  it("unsupported sites report diagnostics and no jobs; blocked pages report the block", async () => {
    const x = await extractCareerSite("https://acme.ca/careers", fakeSite({ "https://acme.ca/careers": page("<h1>We are always hiring great people!</h1>"), "xml:https://acme.ca/robots.txt": "" }));
    expect(x).toMatchObject({ status: "unsupported", jobs: [], complete: false });
    expect(x.diagnostics.join(" ")).toMatch(/No job postings could be extracted/);
    const y = await extractCareerSite("https://acme.ca/careers", fakeSite({ "https://acme.ca/careers": { failure: "robots_disallowed" } }));
    expect(y).toMatchObject({ status: "blocked", failure: { failure: "robots_disallowed" } });
  });

  it("routes pages that link or redirect to a supported ATS / Workday board", async () => {
    const linked = await extractCareerSite("https://acme.ca/careers", fakeSite({ "https://acme.ca/careers": page(`<a href="https://acme.wd3.myworkdayjobs.com/en-US/External">See all jobs</a>`) }));
    expect(linked.status).toBe("routed");
    expect(linked.routedTo.map((r) => r.boardToken)).toEqual(["acme.wd3/external"]);
    const redirected = await extractCareerSite("https://acme.ca/careers", fakeSite({ "https://acme.ca/careers": { redirect: "https://job-boards.greenhouse.io/acme" } }));
    expect(redirected).toMatchObject({ status: "routed", routedTo: [{ provider: "greenhouse", boardToken: "acme" }] });
  });

  it("refuses private and local targets before any request", async () => {
    for (const url of ["https://localhost/careers", "https://127.0.0.1/careers", "https://2130706433/careers", "https://[::1]/careers", "http://acme.ca/careers", "https://acme.internal/careers"]) {
      const x = await extractCareerSite(url, fakeSite({}));
      expect(x.status, url).toBe("blocked");
    }
  });
});

describe("generic adapter (3B contract)", () => {
  it("maps extraction to provider postings; unreliable listings are incomplete; routed-only pages fail clearly", async () => {
    const site = fakeSite({
      "https://acme.ca/careers": page("", ld([jobLd(), jobLd({ title: "Senior Staff Engineer", identifier: "S-9", url: "https://acme.ca/careers/s9" })])),
    });
    const r = await genericAdapter.fetchPostings("acme.ca/careers", { transport: { getJson: async () => ({}) }, site });
    expect(r).toMatchObject({ complete: true, strategy: "json_ld" });
    const co = r.postings.find((p) => p.postingId === "id:REQ-1")!;
    expect(normalizePosting(co, "Acme Robotics")).toMatchObject({ ok: true, job: { jobType: "co_op", locations: [{ city: "Toronto", province: "ON" }] } });

    const routed = fakeSite({ "https://acme.ca/careers": { redirect: "https://jobs.lever.co/acme" } });
    await expect(genericAdapter.fetchPostings("acme.ca/careers", { transport: { getJson: async () => ({}) }, site: routed })).rejects.toMatchObject({ code: "invalid_board" });
    const robots = fakeSite({ "https://acme.ca/careers": { failure: "robots_disallowed" } });
    await expect(genericAdapter.fetchPostings("acme.ca/careers", { transport: { getJson: async () => ({}) }, site: robots })).rejects.toMatchObject({ code: "blocked_host" });
    const empty = fakeSite({ "https://acme.ca/careers": page("<p>No openings right now.</p>"), "xml:https://acme.ca/robots.txt": "" });
    expect(await genericAdapter.fetchPostings("acme.ca/careers", { transport: { getJson: async () => ({}) }, site: empty })).toMatchObject({ postings: [], complete: false });
  });
});

// ---------------------------------------------------------------------------
describe("Workday URLs", () => {
  it("recognises hosts label by label, never by substring", () => {
    expect(isWorkdayHost("acme.wd3.myworkdayjobs.com")).toBe(true);
    expect(isWorkdayHost("acme.wd105.myworkdayjobs.com")).toBe(true); // clusters are not a fixed list
    expect(isWorkdayHost("acme.myworkdayjobs.com")).toBe(true);
    expect(isWorkdayHost("wd5.myworkdaysite.com")).toBe(true);
    for (const h of ["myworkdayjobs.com", "acme.wd3.myworkdayjobs.com.evil.io", "evilmyworkdayjobs.com", "a.b.wd3.myworkdayjobs.com", "acme.prod.myworkdayjobs.com", "x.myworkdaysite.com"]) {
      expect(isWorkdayHost(h), h).toBe(false);
    }
  });

  it("extracts tenant, career site, locale and posting; the locale is not identity", () => {
    const a = recognizeAtsUrl("https://Acme.wd3.myworkdayjobs.com/en-US/External_Careers/job/Toronto-ON/Software-Developer-Intern_R-123?source=x");
    const b = recognizeAtsUrl("https://acme.wd3.myworkdayjobs.com/fr-CA/External_Careers");
    expect(a).toMatchObject({ provider: "workday", boardToken: "acme.wd3/external_careers", kind: "posting", postingId: "Software-Developer-Intern_R-123", locale: "en-US", canonicalBoardUrl: "https://acme.wd3.myworkdayjobs.com/external_careers" });
    expect(b).toMatchObject({ boardToken: "acme.wd3/external_careers", locale: "fr-CA", kind: "board" });
    expect(workdayEndpoints("acme.wd3/external_careers")).toMatchObject({ tenant: "acme", site: "external_careers", cxsBase: "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/external_careers" });
    expect(recognizeAtsUrl("https://wd5.myworkdaysite.com/en-US/recruiting/acme/Campus/job/X/Y_R9")).toMatchObject({ boardToken: "wd5.myworkdaysite/acme/campus", postingId: "Y_R9" });
    expect(recognizeAtsUrl("https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs")).toMatchObject({ boardToken: "acme.wd3/external" });
  });

  it("keeps multiple career sites of one tenant distinct", () => {
    const ext = recognizeAtsUrl("https://acme.wd3.myworkdayjobs.com/External")!;
    const campus = recognizeAtsUrl("https://acme.wd3.myworkdayjobs.com/Campus")!;
    expect(ext.boardToken).not.toBe(campus.boardToken);
  });

  it("rejects malformed Workday URLs and tokens", () => {
    for (const u of ["https://acme.wd3.myworkdayjobs.com/", "https://acme.wd3.myworkdayjobs.com/wday/cxs/other/External/jobs", "https://acme.wd3.myworkdayjobs.com/en-US/", "https://wd5.myworkdaysite.com/en-US/acme/External"]) {
      expect(recognizeAtsUrl(u), u).toBeNull();
    }
    expect(isValidBoardToken("acme.wd3/external", "workday")).toBe(true);
    for (const t of ["acme.wd3", "acme.x1/external", "../x/y", "acme.wd3/ext/../a"]) expect(isValidBoardToken(t, "workday"), t).toBe(false);
  });

  it("manual job URLs map to the adapter's posting identity", () => {
    expect(detectAtsPosting("https://acme.wd3.myworkdayjobs.com/en-US/External/job/Toronto/Dev-Intern_R1")).toEqual({ provider: "workday", boardToken: "acme.wd3/external", postingId: "dev-intern_r1" });
    expect(workdayPostingId("/job/Toronto/Dev-Intern_R1")).toBe("dev-intern_r1");
    expect(workdayPostingId("/careers/x")).toBeNull();
    // Real slugs from non-Latin titles start with "_" or "-".
    expect(workdayPostingId("/job/Shanghai/_JR26110445")).toBe("_jr26110445");
    expect(workdayPostingId("/job/Tokyo/-_JR26070780-5")).toBe("-_jr26070780-5");
    for (const bad of ["/job/../../admin", "/job/x/..", "/job/x?y=1", "/job/x#y", "job/x/y"]) expect(workdayPostingId(bad), bad).toBeNull();
  });
});

describe("Workday adapter", () => {
  const BASE = "https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/external";
  const items = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ title: `Software Developer Intern ${from + i}`, externalPath: `/job/Toronto-ON/Software-Developer-Intern_R${from + i}`, locationsText: "Toronto, ON", bulletFields: [`R${from + i}`] }));
  const fetch = (t: ReturnType<typeof fakeWorkday>, limits = {}) => workdayAdapter.fetchPostings("acme.wd3/external", { transport: t, limits: { minIntervalMs: 0, ...limits } });

  it("pages through the listing, reconciles with the first page's total and enriches details", async () => {
    const t = fakeWorkday({ [BASE]: { total: 45, items: items(45), details: { "/job/Toronto-ON/Software-Developer-Intern_R0": workdayDetail({ title: "Software Developer Intern 0", reqId: "R0", location: "Toronto, ON" }) } } });
    const r = await fetch(t, { maxDetailPages: 1 });
    expect(r.postings).toHaveLength(45);
    expect(r).toMatchObject({ complete: true, strategy: "workday_cxs", enrichmentDeferred: 44, invalidItems: 0 });
    expect(t.calls.filter((c) => c.startsWith("POST"))).toHaveLength(3);
    const first = r.postings[0];
    expect(first).toMatchObject({ postingId: "software-developer-intern_r0", descriptionFetched: true, employmentType: "Full time", metadata: { requisitionId: "R0" } });
    expect(first.descriptionText).toMatch(/backend services/);
    expect(normalizePosting(first, "Acme")).toMatchObject({ ok: true });
    expect(r.postings[1]).toMatchObject({ descriptionFetched: false, descriptionText: "" });
  });

  it("empty boards are complete; missing totals or lists are invalid responses", async () => {
    expect(await fetch(fakeWorkday({ [BASE]: { total: 0, items: [] } }))).toMatchObject({ postings: [], complete: true });
    await expect(fetch(fakeWorkday({ [BASE]: { total: 1, items: [], pageOverride: { 0: { jobPostings: [] } } } }))).rejects.toMatchObject({ code: "invalid_response" });
    await expect(fetch(fakeWorkday({ [BASE]: { total: 1, items: [], pageOverride: { 0: { total: 3 } } } }))).rejects.toMatchObject({ code: "invalid_response" });
    await expect(fetch(fakeWorkday({}))).rejects.toMatchObject({ code: "not_found" });
  });

  it("short pages, page caps, malformed items and total mismatches make the snapshot incomplete", async () => {
    const short = await fetch(fakeWorkday({ [BASE]: { total: 45, items: items(30) } }));
    expect(short).toMatchObject({ complete: false });
    expect(short.incompleteReason).toMatch(/short page/);
    const capped = await fetch(fakeWorkday({ [BASE]: { total: 100, items: items(100) } }), { maxListingPages: 2 });
    expect(capped.incompleteReason).toMatch(/Stopped listing after 2 pages/);
    const bad = await fetch(fakeWorkday({ [BASE]: { total: 3, items: [...items(2), { title: "", externalPath: "nope" }] } }));
    expect(bad).toMatchObject({ complete: false, invalidItems: 1 });
    // Duplicates across pages (a shifting listing) collapse; distinct count no longer reconciles.
    const dup = await fetch(fakeWorkday({ [BASE]: { total: 21, items: [...items(20), items(1)[0]] } }));
    expect(dup.postings).toHaveLength(20);
    expect(dup.incompleteReason).toMatch(/reported 21 jobs but 20 distinct/);
  });

  it("a reported total at Workday's 2,000 cap never counts as complete", async () => {
    const r = await fetch(fakeWorkday({ [BASE]: { total: 2000, items: items(2000) } }), { maxDetailPages: 0 });
    expect(r.postings).toHaveLength(2000);
    expect(r.complete).toBe(false);
    expect(r.incompleteReason).toMatch(/at most 2000 postings/);
  });

  it("detail failures keep the listing complete but are reported; access refusals fail the sync", async () => {
    const r = await fetch(fakeWorkday({ [BASE]: { total: 1, items: items(1), details: { "/job/Toronto-ON/Software-Developer-Intern_R0": new AtsError("http_error", "HTTP 500", 500) } } }));
    expect(r).toMatchObject({ complete: true, enrichmentDeferred: 1 });
    expect(r.warnings.join(" ")).toMatch(/could not be loaded/);
    await expect(fetch(fakeWorkday({ [BASE]: { total: 1, items: [], pageOverride: { 0: new AtsError("http_error", "The provider refused access (HTTP 403)", 403) } } }))).rejects.toMatchObject({ status: 403 });
  });

  it("honours robots.txt on the Workday host before reading anything", async () => {
    const site = { ...fakeSite({}), allowed: async () => ({ ok: false as const, failure: "robots_disallowed" as const, message: "robots.txt disallows /wday/cxs/acme/external/jobs." }) };
    const t = fakeWorkday({ [BASE]: { total: 1, items: items(1) } }, site);
    await expect(fetch(t)).rejects.toMatchObject({ code: "blocked_host" });
    expect(t.calls).toEqual([]);
  });

  it("prioritises descriptions not yet stored, and Canadian/multi-location postings", async () => {
    const list = [
      { title: "Intern A", externalPath: "/job/Austin/A_R1", locationsText: "Austin, TX" },
      { title: "Intern B", externalPath: "/job/x/B_R2", locationsText: "2 Locations" },
      { title: "Intern C", externalPath: "/job/Toronto/C_R3", locationsText: "Toronto, ON" },
    ];
    const t = fakeWorkday({ [BASE]: { total: 3, items: list, details: {} } });
    await workdayAdapter.fetchPostings("acme.wd3/external", { transport: t, enrichedPostingIds: new Set(["c_r3"]), limits: { minIntervalMs: 0, maxDetailPages: 1 } });
    expect(t.calls.filter((c) => c.startsWith("GET"))).toEqual([`GET ${BASE}/job/x/B_R2`]);
  });
});

describe("careers-page candidates", () => {
  it("recognises careers landing pages on company domains only", () => {
    expect(recognizeCareerPageUrl("https://www.acme.ca/careers/")).toMatchObject({ provider: "company_site", boardToken: "www.acme.ca/careers" });
    expect(recognizeCareerPageUrl("https://acme.ca/en/careers")).toMatchObject({ boardToken: "acme.ca/en/careers" });
    expect(recognizeCareerPageUrl("https://acme.ca/careers/backend-intern-123")).toMatchObject({ boardToken: "acme.ca/careers" });
    expect(recognizeCareerPageUrl("https://careers.acme.ca/")).toMatchObject({ boardToken: "careers.acme.ca" });
    for (const u of ["https://acme.ca/about", "https://www.linkedin.com/jobs/view/1", "https://ca.indeed.com/jobs", "https://jobs.lever.co/acme", "https://acme.wd3.myworkdayjobs.com/External"]) {
      expect(recognizeCareerPageUrl(u), u).toBeNull();
    }
    expect(canonicalCareerUrl("https://ACME.ca/Careers/?q=1#x")).toEqual({ token: "acme.ca/Careers", url: "https://acme.ca/Careers" });
    expect(canonicalCareerUrl("http://acme.ca/careers")).toBeNull();
  });
});
