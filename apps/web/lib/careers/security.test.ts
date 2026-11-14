/** Milestone 3D security: transport host policy, browser egress proxy, renderer gating. */
import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { assertAllowedUrl, createFixtureTransport, fixtureName } from "../ats/http";
import { createSafeSiteFetcher } from "../discovery/net";
import { fakeSite } from "./__fixtures__/fake";
import { createPlaywrightRenderer, rendererFromEnv, startEgressProxy } from "./render";

describe("ATS transport host policy", () => {
  it("allows Workday career-site hosts label by label and nothing else", () => {
    expect(() => assertAllowedUrl("https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/External/jobs")).not.toThrow();
    expect(() => assertAllowedUrl("https://wd5.myworkdaysite.com/wday/cxs/acme/x/jobs")).not.toThrow();
    for (const u of [
      "https://acme.wd3.myworkdayjobs.com.evil.io/x",
      "https://myworkdayjobs.com/x",
      "http://acme.wd3.myworkdayjobs.com/x",
      "https://acme.wd3.myworkdayjobs.com:8443/x",
      "https://user@acme.wd3.myworkdayjobs.com/x",
      "https://acme.com/careers",
      "https://169.254.169.254/latest/meta-data",
    ]) {
      expect(() => assertAllowedUrl(u), u).toThrow(/Refused/);
    }
  });

  it("maps Workday POST bodies to fixture files deterministically", async () => {
    const t = createFixtureTransport("/nonexistent");
    await expect(t.postJson!("https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/external/jobs", { appliedFacets: {}, limit: 20, offset: 40, searchText: "" }, {})).rejects.toMatchObject({ code: "not_found" });
    expect(fixtureName(new URL("https://acme.wd3.myworkdayjobs.com/wday/cxs/acme/external/jobs?offset=40"))).toBe("acme.wd3.myworkdayjobs.com/wday/cxs/acme/external/jobs__offset=40.json");
  });
});

describe("company-site fetcher", () => {
  const resolver = (map: Record<string, string>) => async (host: string) => [{ address: map[host] ?? "93.184.216.34", family: net.isIP(map[host] ?? "93.184.216.34") }];

  it("refuses alternate IP encodings, private DNS answers and non-https before connecting", async () => {
    const f = createSafeSiteFetcher({ resolver: resolver({ "rebind.prorez-test.com": "10.0.0.5" }) });
    for (const u of ["https://0x7f.0.0.1/", "https://2130706433/", "https://[::ffff:127.0.0.1]/", "http://acme.ca/", "https://acme.ca:8443/"]) {
      expect((await f.fetchPage(u)).ok, u).toBe(false);
    }
    expect(await f.fetchPage("https://rebind.prorez-test.com/careers")).toMatchObject({ ok: false, failure: "blocked_address" });
    expect(await f.allowed!("https://rebind.prorez-test.com/careers")).toMatchObject({ ok: false });
  });
});

describe("browser egress proxy", () => {
  async function connect(port: number, target: string): Promise<string> {
    return new Promise((resolve) => {
      const s = net.connect(port, "127.0.0.1", () => s.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
      s.once("data", (d) => {
        resolve(d.toString().split("\r\n")[0]);
        s.destroy();
      });
      s.on("error", () => resolve("error"));
    });
  }

  it("only tunnels :443 to vetted public addresses; refuses loopback, private, metadata and plain HTTP", async () => {
    const proxy = await startEgressProxy(async (host) => {
      const map: Record<string, string> = { "rebind.prorez-test.com": "127.0.0.1", "meta.prorez-test.com": "169.254.169.254", "lan.prorez-test.com": "192.168.1.10" };
      return [{ address: map[host] ?? "127.0.0.1", family: 4 }];
    });
    try {
      expect(await connect(proxy.port, "localhost:443")).toMatch(/403/);
      expect(await connect(proxy.port, "127.0.0.1:443")).toMatch(/403/);
      expect(await connect(proxy.port, "acme.ca:80")).toMatch(/403/);
      expect(await connect(proxy.port, "rebind.prorez-test.com:443")).toMatch(/403/);
      expect(await connect(proxy.port, "meta.prorez-test.com:443")).toMatch(/403/);
      expect(await connect(proxy.port, "lan.prorez-test.com:443")).toMatch(/403/);
      const plain = await new Promise<number>((resolve) => http.get({ host: "127.0.0.1", port: proxy.port, path: "http://acme.ca/" }, (res) => resolve(res.statusCode ?? 0)).on("error", () => resolve(0)));
      expect(plain).toBe(403);
      expect(proxy.refused()).toBeGreaterThanOrEqual(7);
    } finally {
      await proxy.close();
    }
  });

  it("a real headless render cannot reach a local server through a rebinding DNS answer", { timeout: 60_000 }, async () => {
    const server = http.createServer((_q, r) => r.end("<html><body>SECRET-LOCAL-PAGE</body></html>"));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const renderer = createPlaywrightRenderer(fakeSite({}), { timeoutMs: 10_000, maxRequests: 20, maxHtmlBytes: 100_000, concurrency: 1 }, async () => [{ address: "127.0.0.1", family: 4 }]);
      const result = await renderer.render("https://rebind.prorez-test.com/");
      expect(result.ok).toBe(false);
      // Refused by the egress proxy (not merely "Playwright unavailable").
      expect(!result.ok && result.message).toMatch(/TUNNEL_CONNECTION_FAILED|ERR_PROXY|ERR_TUNNEL/);
      expect(JSON.stringify(result)).not.toMatch(/SECRET-LOCAL-PAGE/);
      expect(await renderer.render("https://localhost/")).toMatchObject({ ok: false, failure: "blocked_url" });
    } finally {
      server.close();
    }
  });
});

describe("renderer configuration", () => {
  it("is off by default, never enabled inside the web server, and validates settings", () => {
    expect(rendererFromEnv({})).toBeNull();
    expect(rendererFromEnv({ PROREZ_RENDER_ENABLED: "true", NEXT_RUNTIME: "nodejs" })).toBeNull();
    expect(rendererFromEnv({ PROREZ_RENDER_ENABLED: "true" })).toBeTypeOf("function");
    expect(() => rendererFromEnv({ PROREZ_RENDER_ENABLED: "yes" })).toThrow(/PROREZ_RENDER_ENABLED/);
    expect(() => rendererFromEnv({ PROREZ_RENDER_TIMEOUT_SECONDS: "1" })).toThrow(/between 5 and 120/);
  });
});
