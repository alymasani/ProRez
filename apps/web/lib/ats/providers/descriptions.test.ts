/**
 * Cross-provider: realistic long descriptions (headings, paragraphs, bullet
 * lists, links, plus hostile markup) survive each adapter, normalization and
 * the display parser with nothing lost. Responses are recorded-shape and
 * FICTIONAL; no network.
 */
import { describe, expect, it } from "vitest";
import { fakeTransport } from "../__fixtures__/transport";
import { normalizePosting } from "../normalize";
import { parseDescription } from "../../jobs/description";
import { ashbyAdapter } from "./ashby";
import { greenhouseAdapter } from "./greenhouse";
import { leverAdapter } from "./lever";
import { smartRecruitersAdapter } from "./smartrecruiters";

const ABOUT_HTML = `<h2>WHO ARE WE?</h2><p>Northwind Signals is a <strong>fictional</strong> Toronto company building search infrastructure for libraries across Canada. We are a team of forty engineers, designers and researchers.</p><p>Learn more at <a href="https://northwind.example/about">our about page</a>.</p><script>alert("x")</script>`;
const RESP_ITEMS = ["Build and test backend services in TypeScript and PostgreSQL", "Pair with a mentor on code reviews every week", "Present a demo of your work at the end of the term"];
const QUAL_ITEMS = ["Currently enrolled in a Canadian post-secondary program", "Comfortable with Git and a modern web framework", "Available for a 4-month co-op starting May 2027"];
const ul = (items: string[]) => `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
const FULL_HTML = `${ABOUT_HTML}<h3>Responsibilities</h3>${ul(RESP_ITEMS)}<h3>Qualifications</h3>${ul(QUAL_ITEMS)}<p>Questions? Email jobs at northwind.example or visit <a href="javascript:alert(1)">this link</a>.</p>`;

const LOCATION = "Toronto, ON";
const TITLE = "Software Developer Co-op (Summer 2027)";

async function viaGreenhouse() {
  const url = "https://boards-api.greenhouse.io/v1/boards/northwind/jobs?content=true";
  const html = FULL_HTML.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); // Greenhouse entity-encodes content
  const { transport } = fakeTransport({ [url]: { jobs: [{ id: 1, title: TITLE, absolute_url: "https://job-boards.greenhouse.io/northwind/jobs/1", location: { name: LOCATION }, content: html }] } });
  return (await greenhouseAdapter.fetchPostings("northwind", { transport })).postings[0];
}

async function viaLever() {
  const url = "https://api.lever.co/v0/postings/northwind?mode=json&skip=0&limit=100";
  const { transport } = fakeTransport({
    [url]: [
      {
        id: "a1b2c3d4-0000-4000-8000-000000000001",
        text: TITLE,
        hostedUrl: "https://jobs.lever.co/northwind/a1b2c3d4-0000-4000-8000-000000000001",
        categories: { location: LOCATION, commitment: "Co-op" },
        country: "CA",
        description: ABOUT_HTML,
        lists: [
          { text: "Responsibilities", content: RESP_ITEMS.map((i) => `<li>${i}</li>`).join("") },
          { text: "Qualifications", content: QUAL_ITEMS.map((i) => `<li>${i}</li>`).join("") },
        ],
        additional: `<p>Questions? Email jobs at northwind.example or visit <a href="javascript:alert(1)">this link</a>.</p>`,
      },
    ],
  });
  return (await leverAdapter.fetchPostings("northwind", { transport })).postings[0];
}

async function viaAshby() {
  const url = "https://api.ashbyhq.com/posting-api/job-board/northwind?includeCompensation=false";
  const { transport } = fakeTransport({
    [url]: { jobs: [{ id: "5f0c1d2e-0000-4000-8000-000000000001", title: TITLE, jobUrl: "https://jobs.ashbyhq.com/northwind/5f0c1d2e-0000-4000-8000-000000000001", location: LOCATION, isListed: true, workplaceType: "Hybrid", descriptionHtml: FULL_HTML }] },
  });
  return (await ashbyAdapter.fetchPostings("northwind", { transport })).postings[0];
}

async function viaSmartRecruiters() {
  const base = "https://api.smartrecruiters.com/v1/companies/northwind/postings";
  const { transport } = fakeTransport({
    [`${base}?limit=100&offset=0`]: { totalFound: 1, content: [{ id: "744000000001", name: TITLE, location: { city: "Toronto", region: "ON", country: "ca" } }] },
    [`${base}/744000000001`]: {
      postingUrl: "https://jobs.smartrecruiters.com/Northwind/744000000001",
      jobAd: {
        sections: {
          companyDescription: { title: "WHO ARE WE?", text: ABOUT_HTML.replace("<h2>WHO ARE WE?</h2>", "") },
          jobDescription: { title: "Responsibilities", text: ul(RESP_ITEMS) },
          qualifications: { title: "Qualifications", text: ul(QUAL_ITEMS) },
          additionalInformation: { title: "", text: `<p>Questions? Email jobs at northwind.example or visit <a href="javascript:alert(1)">this link</a>.</p>` },
        },
      },
    },
  });
  return (await smartRecruitersAdapter.fetchPostings("northwind", { transport })).postings[0];
}

describe.each([
  ["Greenhouse", viaGreenhouse],
  ["Lever", viaLever],
  ["Ashby", viaAshby],
  ["SmartRecruiters", viaSmartRecruiters],
])("%s long description", (_name, fetchOne) => {
  it("survives the adapter and normalization in full, with structure and safe links", async () => {
    const posting = await fetchOne();
    const normalized = normalizePosting(posting, "Northwind Signals");
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const text = normalized.job.description ?? "";

    // Every sentence and list item is present; no markup or script survives.
    for (const s of ["WHO ARE WE?", "forty engineers, designers and researchers", ...RESP_ITEMS, ...QUAL_ITEMS, "Questions? Email jobs at northwind.example"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toMatch(/<[a-z/]|alert\("x"\)|javascript:/i);
    expect(text).toContain("https://northwind.example/about");
    expect(normalized.job.summary).toMatch(/^Northwind Signals is a fictional Toronto company/);

    const blocks = parseDescription(text);
    const headings = blocks.filter((b) => b.kind === "heading").map((b) => (b.kind === "heading" ? b.text : ""));
    expect(headings).toEqual(expect.arrayContaining(["WHO ARE WE?", "Responsibilities", "Qualifications"]));
    const items = blocks.flatMap((b) => (b.kind === "list" ? b.items : []));
    expect(items).toEqual([...RESP_ITEMS, ...QUAL_ITEMS]);
  });
});
