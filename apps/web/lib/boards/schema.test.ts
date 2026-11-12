import { describe, expect, it } from "vitest";
import { parseBoardInput } from "./schema";

const valid = { provider: "greenhouse", employerName: " Acme ", boardToken: " AcmeInc ", pollIntervalMinutes: 360, enabled: true };

describe("parseBoardInput", () => {
  it("normalises the token and derives the canonical URL", () => {
    expect(parseBoardInput(valid)).toEqual({
      ok: true,
      board: {
        provider: "greenhouse",
        employerName: "Acme",
        boardToken: "acmeinc",
        boardUrl: "https://job-boards.greenhouse.io/acmeinc",
        pollIntervalMinutes: 360,
        enabled: true,
        region: null,
      },
    });
  });

  it("keeps the Lever EU region from the board URL and rejects it for other providers", () => {
    const eu = parseBoardInput({ ...valid, provider: "lever", region: "eu" });
    expect(eu).toMatchObject({ ok: true, board: { region: "eu", boardUrl: "https://jobs.eu.lever.co/acmeinc" } });
    expect(parseBoardInput({ ...valid, region: "eu" }).ok).toBe(false);
  });

  it("rejects non-ATS providers and unknown fields", () => {
    expect(parseBoardInput({ ...valid, provider: "manual" }).ok).toBe(false);
    expect(parseBoardInput({ ...valid, boardUrl: "https://evil.example" }).ok).toBe(false);
    expect(parseBoardInput({ ...valid, lastSuccessAt: "2026-01-01" }).ok).toBe(false);
  });

  it("validates employer, token and polling interval", () => {
    const result = parseBoardInput({ ...valid, employerName: " ", boardToken: "a/b", pollIntervalMinutes: 5 });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: { employerName: expect.any(String), boardToken: expect.any(String), pollIntervalMinutes: expect.any(String) },
    });
  });
});
