import { describe, expect, it, vi } from "vitest";
import { AtsError, assertAllowedUrl, createFetchTransport, parseRetryAfter, resolveTransport, withRetries } from "./http";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

describe("ATS HTTP transport", () => {
  it("only allows approved provider hosts over https", () => {
    expect(() => assertAllowedUrl("https://boards-api.greenhouse.io/v1/boards/x/jobs")).not.toThrow();
    for (const url of [
      "http://boards-api.greenhouse.io/v1/boards/x/jobs",
      "https://evil.example/jobs",
      "https://boards-api.greenhouse.io:8443/x",
      "https://user:pw@api.lever.co/v0/postings/x",
      "https://169.254.169.254/latest/meta-data",
      "https://localhost/x",
    ]) {
      expect(() => assertAllowedUrl(url), url).toThrow(AtsError);
    }
  });

  it("refuses redirects and sends no credentials", async () => {
    const fetchImpl = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.redirect).toBe("error");
      return json({ ok: true });
    });
    await createFetchTransport(fetchImpl as typeof fetch).getJson("https://api.lever.co/v0/postings/x?mode=json", {});
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    [404, "not_found"],
    [429, "rate_limited"],
    [500, "http_error"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const t = createFetchTransport((async () => json({}, { status })) as typeof fetch);
    await expect(t.getJson("https://api.ashbyhq.com/posting-api/job-board/x", {})).rejects.toMatchObject({ code });
  });

  it("rejects non-JSON responses", async () => {
    const t = createFetchTransport((async () => new Response("<html>")) as typeof fetch);
    await expect(t.getJson("https://api.ashbyhq.com/posting-api/job-board/x", {})).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("times out and supports cancellation", async () => {
    const hanging = ((_u: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    const t = createFetchTransport(hanging);
    await expect(t.getJson("https://api.lever.co/v0/postings/x", { timeoutMs: 20 })).rejects.toMatchObject({ code: "timeout" });
    const controller = new AbortController();
    const pending = t.getJson("https://api.lever.co/v0/postings/x", { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
  });

  it("caps response size", async () => {
    const big = new Response("x".repeat(10), { headers: { "content-length": String(100 * 1024 * 1024) } });
    const t = createFetchTransport((async () => big) as typeof fetch);
    await expect(t.getJson("https://api.lever.co/v0/postings/x", {})).rejects.toMatchObject({ code: "too_large" });
  });

  it("only allows recorded responses against test databases", () => {
    expect(() => resolveTransport({ PROREZ_ATS_TRANSPORT: "fixtures", DATABASE_URL: "postgresql://u@h/prorez_dev" })).toThrow();
    expect(() => resolveTransport({ PROREZ_ATS_TRANSPORT: "fixtures", DATABASE_URL: "postgresql://u@h/prorez_e2e" })).not.toThrow();
  });
});

describe("retries (Milestone 3B)", () => {
  const policy = { maxRetries: 3, baseDelayMs: 100, maxDelayMs: 1_000 };
  function flaky(errors: (AtsError | null)[], value: unknown = { ok: true }) {
    let calls = 0;
    const transport = {
      async getJson() {
        const e = errors[calls++];
        if (e) throw e;
        return value;
      },
    };
    return { transport, calls: () => calls };
  }
  const sleeps: number[] = [];
  const hooks = { sleep: async (ms: number) => void sleeps.push(ms), random: () => 1 };

  it("retries 429 and 5xx with exponential backoff and returns the eventual response", async () => {
    sleeps.length = 0;
    const f = flaky([new AtsError("rate_limited", "429", 429), new AtsError("http_error", "500", 500), null]);
    await expect(withRetries(f.transport, policy, hooks).getJson("https://api.lever.co/x", {})).resolves.toEqual({ ok: true });
    expect(f.calls()).toBe(3);
    expect(sleeps).toEqual([100, 200]);
  });

  it("honours Retry-After when it fits, and rethrows when it is longer than allowed in-request", async () => {
    sleeps.length = 0;
    const fits = flaky([new AtsError("rate_limited", "429", 429, 700), null]);
    await withRetries(fits.transport, policy, hooks).getJson("u", {});
    expect(sleeps).toEqual([700]);
    const tooLong = flaky([new AtsError("rate_limited", "429", 429, 60_000), null]);
    await expect(withRetries(tooLong.transport, policy, hooks).getJson("u", {})).rejects.toMatchObject({ code: "rate_limited", retryAfterMs: 60_000 });
    expect(tooLong.calls()).toBe(1);
  });

  it("gives up after maxRetries (default 3) on persistent timeouts", async () => {
    const f = flaky(Array.from({ length: 10 }, () => new AtsError("timeout", "slow")));
    await expect(withRetries(f.transport, policy, hooks).getJson("u", {})).rejects.toMatchObject({ code: "timeout" });
    expect(f.calls()).toBe(4); // 1 + 3 retries
  });

  it("never retries permanent errors (404, malformed JSON, blocked host, 4xx)", async () => {
    for (const e of [new AtsError("not_found", "404", 404), new AtsError("invalid_response", "bad"), new AtsError("blocked_host", "no"), new AtsError("http_error", "403", 403)]) {
      const f = flaky([e, null]);
      await expect(withRetries(f.transport, policy, hooks).getJson("u", {})).rejects.toBe(e);
      expect(f.calls()).toBe(1);
    }
  });

  it("stops retrying once the sync is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const f = flaky([new AtsError("network", "down"), null]);
    await expect(withRetries(f.transport, policy, hooks).getJson("u", { signal: controller.signal })).rejects.toMatchObject({ code: "network" });
    expect(f.calls()).toBe(1);
  });

  it("parses Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfter("120")).toBe(120_000);
    expect(parseRetryAfter("Tue, 17 Nov 2026 12:01:00 GMT", Date.parse("2026-11-17T12:00:00Z"))).toBe(60_000);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("soon")).toBeUndefined();
  });

  it("reads Retry-After from real 429 responses", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 429, headers: { "retry-after": "30" } })) as unknown as typeof fetch;
    await expect(createFetchTransport(fetchImpl).getJson("https://api.lever.co/v0/postings/x?mode=json", {})).rejects.toMatchObject({
      code: "rate_limited",
      retryAfterMs: 30_000,
    });
  });
});
