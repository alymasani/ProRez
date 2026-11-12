import { describe, expect, it } from "vitest";
import { fakeTransport } from "../__fixtures__/transport";
import { AtsError } from "../http";
import { normalizePosting } from "../normalize";
import { ashbyAdapter } from "./ashby";
import { greenhouseAdapter } from "./greenhouse";
import { LEVER_PAGE_SIZE, leverAdapter } from "./lever";
import { smartRecruitersAdapter } from "./smartrecruiters";

const GH = "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true";

describe("Greenhouse adapter", () => {
  it("normalizes jobs, decodes content and keeps metadata", async () => {
    const { transport } = fakeTransport({
      [GH]: {
        jobs: [
          {
            id: 4012345,
            title: "Software Engineering Intern (Fall 2027)",
            absolute_url: "https://job-boards.greenhouse.io/acme/jobs/4012345",
            updated_at: "2026-11-01T10:00:00-04:00",
            location: { name: "Toronto, ON" },
            content: "&lt;p&gt;A 4-month internship.&lt;/p&gt;",
            departments: [{ id: 1, name: "Engineering" }],
            offices: [{ id: 2, name: "Toronto", location: "Toronto, Ontario, Canada" }],
            metadata: [{ name: "Employment Type", value: "Intern" }],
          },
          { id: null, title: "No id" },
          "garbage",
        ],
        meta: { total: 3 },
      },
    });
    const result = await greenhouseAdapter.fetchPostings("acme", { transport });
    expect(result.postings).toHaveLength(1);
    expect(result.warnings).toHaveLength(2);
    const p = result.postings[0];
    expect(p).toMatchObject({
      postingId: "4012345",
      descriptionText: "A 4-month internship.",
      employmentType: "Intern",
      department: "Engineering",
      publishedAtKind: "updated",
      url: "https://job-boards.greenhouse.io/acme/jobs/4012345",
    });
    const n = normalizePosting(p, "Acme");
    expect(n).toMatchObject({ ok: true, job: { jobType: "internship", durationMonths: 4, term: "Fall 2027", locations: [{ province: "ON" }] } });
  });

  it("rejects an invalid board token before making any request", async () => {
    const { transport, requested } = fakeTransport({});
    await expect(greenhouseAdapter.fetchPostings("../etc", { transport })).rejects.toMatchObject({ code: "invalid_board" });
    expect(requested).toEqual([]);
  });

  it("surfaces provider errors and malformed responses", async () => {
    await expect(greenhouseAdapter.fetchPostings("missing", { transport: fakeTransport({}).transport })).rejects.toMatchObject({ code: "not_found" });
    await expect(greenhouseAdapter.fetchPostings("acme", { transport: fakeTransport({ [GH]: { nope: true } }).transport })).rejects.toBeInstanceOf(AtsError);
  });
});

describe("Lever adapter", () => {
  const page = (skip: number) => `https://api.lever.co/v0/postings/acme?mode=json&skip=${skip}&limit=${LEVER_PAGE_SIZE}`;
  const posting = (i: number) => ({
    id: `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`,
    text: i === 0 ? "Backend Developer Co-op" : `Senior Engineer ${i}`,
    hostedUrl: `https://jobs.lever.co/acme/${i}`,
    categories: { location: "Vancouver, BC", commitment: "Co-op", department: "Eng", allLocations: ["Vancouver, BC"] },
    country: "CA",
    workplaceType: "hybrid",
    descriptionPlain: "Join us for an 8 month term.",
    lists: [{ text: "Requirements", content: "<li>Python</li>" }],
    createdAt: 1767225600000,
  });

  it("paginates with skip/limit until a short page", async () => {
    const { transport, requested } = fakeTransport({
      [page(0)]: Array.from({ length: LEVER_PAGE_SIZE }, (_, i) => posting(i)),
      [page(LEVER_PAGE_SIZE)]: [posting(LEVER_PAGE_SIZE)],
    });
    const result = await leverAdapter.fetchPostings("acme", { transport });
    expect(requested).toHaveLength(2);
    expect(result.postings).toHaveLength(LEVER_PAGE_SIZE + 1);
    const first = result.postings[0];
    expect(first).toMatchObject({ workplace: "hybrid", employmentType: "Co-op", publishedAtKind: "none", publishedAt: null });
    expect(first.descriptionText).toContain("- Python");
    expect(normalizePosting(first, "Acme")).toMatchObject({
      ok: true,
      job: { jobType: "co_op", durationMonths: 8, locations: [{ city: "Vancouver", province: "BC", arrangement: "hybrid" }] },
    });
  });

  it("rejects a non-list response", async () => {
    await expect(leverAdapter.fetchPostings("acme", { transport: fakeTransport({ [page(0)]: { ok: false } }).transport })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });
});

describe("Ashby adapter", () => {
  const URL_ = "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=false";
  it("uses structured addresses, skips unlisted jobs, treats publishedAt as last-published", async () => {
    const { transport } = fakeTransport({
      [URL_]: {
        apiVersion: "1",
        jobs: [
          {
            id: "a1b2c3d4-0000-0000-0000-000000000001",
            title: "New Grad Software Engineer",
            location: "Remote",
            workplaceType: "Remote",
            isRemote: true,
            isListed: true,
            employmentType: "FullTime",
            publishedAt: "2026-11-02T15:00:00.000Z",
            jobUrl: "https://jobs.ashbyhq.com/acme/a1b2c3d4-0000-0000-0000-000000000001",
            descriptionHtml: "<p>Remote across Canada.</p>",
            address: { postalAddress: { addressCountry: "Canada", addressRegion: "", addressLocality: "" } },
          },
          { title: "Unlisted Intern", isListed: false, jobUrl: "https://jobs.ashbyhq.com/acme/x-1" },
          { title: "Missing id and url" },
        ],
      },
    });
    const result = await ashbyAdapter.fetchPostings("acme", { transport });
    expect(result.postings).toHaveLength(1);
    expect(result.warnings.join(" ")).toMatch(/unlisted/);
    const p = result.postings[0];
    expect(p).toMatchObject({ publishedAtKind: "last_published", workplace: "remote", descriptionText: "Remote across Canada." });
    expect(normalizePosting(p, "Acme")).toMatchObject({ ok: true, job: { jobType: "new_grad", locations: [{ province: null, arrangement: "remote" }] } });
  });

  it("does not treat a globally remote job as Canadian", async () => {
    const { transport } = fakeTransport({
      [URL_]: { jobs: [{ id: "x", title: "Software Engineer Intern", location: "Remote", workplaceType: "Remote", jobUrl: "https://jobs.ashbyhq.com/acme/x" }] },
    });
    const [p] = (await ashbyAdapter.fetchPostings("acme", { transport })).postings;
    expect(normalizePosting(p, "Acme")).toMatchObject({ ok: false, reason: expect.stringMatching(/Canada/) });
  });
});

describe("SmartRecruiters adapter", () => {
  const list = (offset: number) => `https://api.smartrecruiters.com/v1/companies/acme/postings?limit=100&offset=${offset}`;
  const item = (id: string, country: string, name = "Software Developer Co-op") => ({
    id,
    name,
    releasedDate: "2026-11-05T12:00:00.000Z",
    location: { country, region: country === "ca" ? "ON" : "CA", city: country === "ca" ? "Ottawa" : "Austin", remote: false },
    typeOfEmployment: { id: "intern", label: "Internship" },
    department: { id: "1", label: "R&D" },
  });

  it("pages, fetches details only for Canadian postings, and reports first publication", async () => {
    const { transport, requested } = fakeTransport({
      [list(0)]: { totalFound: 101, limit: 100, offset: 0, content: [...Array.from({ length: 99 }, (_, i) => item(`9${i}`, "us")), item("744000000001", "ca")] },
      [list(100)]: { totalFound: 101, limit: 100, offset: 100, content: [item("744000000002", "ca", "Junior QA Analyst")] },
      "https://api.smartrecruiters.com/v1/companies/acme/postings/744000000001": {
        postingUrl: "https://jobs.smartrecruiters.com/Acme/744000000001-software-developer-co-op",
        jobAd: { sections: { jobDescription: { title: "Job Description", text: "<p>A four month co-op.</p>" } } },
      },
      "https://api.smartrecruiters.com/v1/companies/acme/postings/744000000002": { jobAd: { sections: {} } },
    });
    const result = await smartRecruitersAdapter.fetchPostings("acme", { transport });
    expect(result.postings).toHaveLength(101);
    expect(requested.filter((u) => /postings\/\d/.test(u))).toHaveLength(2);
    const ca = result.postings.find((p) => p.postingId === "744000000001")!;
    expect(ca).toMatchObject({ publishedAtKind: "first_published", employmentType: "Internship", url: expect.stringContaining("744000000001") });
    expect(normalizePosting(ca, "Acme")).toMatchObject({ ok: true, job: { jobType: "co_op", durationMonths: 4, locations: [{ city: "Ottawa", province: "ON" }] } });
    const us = result.postings.find((p) => p.postingId === "90")!;
    expect(normalizePosting(us, "Acme").ok).toBe(false);
  });

  it("keeps going when one detail request fails, but stops on rate limiting", async () => {
    const base = { [list(0)]: { totalFound: 1, content: [item("744000000003", "ca")] } };
    const ok = await smartRecruitersAdapter.fetchPostings("acme", { transport: fakeTransport(base).transport });
    expect(ok.postings).toHaveLength(1);
    expect(ok.warnings.join(" ")).toMatch(/Could not load details/);

    const limited = fakeTransport({
      ...base,
      "https://api.smartrecruiters.com/v1/companies/acme/postings/744000000003": () => {
        throw new AtsError("rate_limited", "slow down", 429);
      },
    });
    await expect(smartRecruitersAdapter.fetchPostings("acme", { transport: limited.transport })).rejects.toMatchObject({ code: "rate_limited" });
  });
});
