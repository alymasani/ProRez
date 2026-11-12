import { describe, expect, it } from "vitest";
import { canonicalBoardUrl, isValidBoardToken, parseBoardUrl } from "./board-url";

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
