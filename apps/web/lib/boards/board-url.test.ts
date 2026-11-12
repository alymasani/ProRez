import { describe, expect, it } from "vitest";
import { boardIdentity, canonicalBoardUrl, isValidBoardToken, parseBoardUrl, recognizeAtsUrl } from "./board-url";

describe("canonicalBoardUrl", () => {
  it("builds one canonical, lowercase URL per provider", () => {
    expect(canonicalBoardUrl("greenhouse", "Acme")).toBe("https://job-boards.greenhouse.io/acme");
    expect(canonicalBoardUrl("lever", "acme")).toBe("https://jobs.lever.co/acme");
    expect(canonicalBoardUrl("ashby", " Acme ")).toBe("https://jobs.ashbyhq.com/acme");
    expect(canonicalBoardUrl("smartrecruiters", "AcmeInc")).toBe("https://jobs.smartrecruiters.com/acmeinc");
  });
});

describe("parseBoardUrl", () => {
  it.each([
    ["https://boards.greenhouse.io/acme", "greenhouse", "acme"],
    ["https://job-boards.greenhouse.io/Acme/jobs/123", "greenhouse", "acme"],
    ["https://boards-api.greenhouse.io/v1/boards/acme/jobs", "greenhouse", "acme"],
    ["https://jobs.lever.co/acme/abc-123", "lever", "acme"],
    ["https://api.lever.co/v0/postings/acme?mode=json", "lever", "acme"],
    ["https://jobs.ashbyhq.com/acme", "ashby", "acme"],
    ["https://api.ashbyhq.com/posting-api/job-board/acme", "ashby", "acme"],
    ["https://jobs.smartrecruiters.com/AcmeInc/744000", "smartrecruiters", "acmeinc"],
    ["https://api.smartrecruiters.com/v1/companies/acmeinc/postings", "smartrecruiters", "acmeinc"],
  ])("%s → %s/%s", (url, provider, boardToken) => {
    expect(parseBoardUrl(url)).toEqual({ provider, boardToken });
  });

  it.each([
    "not a url",
    "ftp://jobs.lever.co/acme",
    "https://example.com/acme",
    "https://jobs.lever.co/",
    "https://boards-api.greenhouse.io/v2/other/acme",
    "https://jobs.lever.co/-bad-token",
  ])("rejects %s", (url) => {
    expect(parseBoardUrl(url)).toBeNull();
  });
});

describe("isValidBoardToken", () => {
  it("accepts typical tokens and rejects unsafe ones", () => {
    for (const t of ["acme", "acme-inc", "acme_inc", "Acme.Inc2"]) expect(isValidBoardToken(t)).toBe(true);
    for (const t of ["", "-acme", "acme/inc", "acme inc", "a".repeat(101), "../etc"]) expect(isValidBoardToken(t)).toBe(false);
  });
});

describe("recognizeAtsUrl (Milestone 3C)", () => {
  it.each([
    // Greenhouse: board, posting, embeds (board in the query), API, old host
    ["https://job-boards.greenhouse.io/Acme/", "greenhouse", "acme", null, "board", null],
    ["https://boards.greenhouse.io/acme/jobs/4012345?gh_src=abc#apply", "greenhouse", "acme", null, "posting", "4012345"],
    ["https://boards.greenhouse.io/embed/job_board?for=Acme&b=https://acme.com", "greenhouse", "acme", null, "board", null],
    ["https://boards.greenhouse.io/embed/job_board/js?for=acme", "greenhouse", "acme", null, "board", null],
    ["https://boards.greenhouse.io/embed/job_app?for=acme&token=777", "greenhouse", "acme", null, "posting", "777"],
    ["https://boards-api.greenhouse.io/v1/boards/acme/jobs/55", "greenhouse", "acme", null, "posting", "55"],
    // Lever: US and EU, posting and apply pages
    ["https://jobs.lever.co/acme/0f1e2d3c-aaaa-bbbb-cccc-1234567890ab/apply", "lever", "acme", null, "posting", "0f1e2d3c-aaaa-bbbb-cccc-1234567890ab"],
    ["https://jobs.eu.lever.co/acme", "lever", "acme", "eu", "board", null],
    ["https://api.eu.lever.co/v0/postings/acme?mode=json", "lever", "acme", "eu", "board", null],
    // Ashby
    ["https://jobs.ashbyhq.com/acme/5f0c1d2e-0000-4000-8000-000000000001/application?utm_source=x", "ashby", "acme", null, "posting", "5f0c1d2e-0000-4000-8000-000000000001"],
    // SmartRecruiters (posting id before the slug)
    ["https://jobs.smartrecruiters.com/AcmeInc/744000012345678-software-developer", "smartrecruiters", "acmeinc", null, "posting", "744000012345678"],
    ["https://careers.smartrecruiters.com/AcmeInc", "smartrecruiters", "acmeinc", null, "board", null],
  ])("%s", (url, provider, boardToken, region, kind, postingId) => {
    expect(recognizeAtsUrl(url)).toMatchObject({ provider, boardToken, region, kind, postingId });
  });

  it("collapses URL variants of one board to one canonical URL and identity", () => {
    const variants = [
      "https://boards.greenhouse.io/acme",
      "https://job-boards.greenhouse.io/ACME/jobs/1",
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs",
      "https://boards.greenhouse.io/embed/job_board?for=acme",
    ].map((u) => recognizeAtsUrl(u)!);
    expect(new Set(variants.map((v) => v.canonicalBoardUrl))).toEqual(new Set(["https://job-boards.greenhouse.io/acme"]));
    expect(new Set(variants.map(boardIdentity))).toEqual(new Set(["greenhouse:acme"]));
    expect(recognizeAtsUrl("https://jobs.eu.lever.co/acme/x")!.canonicalBoardUrl).toBe("https://jobs.eu.lever.co/acme");
  });

  it.each([
    "https://evil.example/jobs.lever.co/acme", // host appears only in the path
    "https://jobs.lever.co.evil.example/acme", // look-alike host
    "https://jobs.lever.co@evil.example/acme", // userinfo trick (host is evil.example)
    "https://user:pw@jobs.lever.co/acme", // credentials
    "https://jobs.lever.co:8443/acme", // non-default port
    "javascript:alert(1)//jobs.lever.co/acme",
    "https://boards.greenhouse.io/embed/job_board", // embed without a board
    "https://jobs.smartrecruiters.com/", // no token
    "https://boards.greenhouse.io/assets/app.js", // reserved path
    "https://jobs.ashbyhq.com/%E0%A4%A", // malformed escape
    `https://jobs.lever.co/${"a".repeat(3000)}`,
  ])("rejects %s", (url) => {
    expect(recognizeAtsUrl(url)).toBeNull();
  });

  it("keeps parseBoardUrl backward compatible and adds the region", () => {
    expect(parseBoardUrl("https://jobs.lever.co/acme")).toEqual({ provider: "lever", boardToken: "acme" });
    expect(parseBoardUrl("https://jobs.eu.lever.co/acme")).toEqual({ provider: "lever", boardToken: "acme", region: "eu" });
    expect(canonicalBoardUrl("lever", "Acme", "eu")).toBe("https://jobs.eu.lever.co/acme");
  });
});
