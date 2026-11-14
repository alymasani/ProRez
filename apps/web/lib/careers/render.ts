/**
 * Strategy 4 — optional browser rendering for career pages whose jobs are
 * rendered client-side (Milestone 3D). OFF by default (PROREZ_RENDER_ENABLED),
 * never used inside the Next.js web server, and only after static strategies
 * found nothing.
 *
 * Isolation and network policy:
 * - Headless Chromium (Playwright), a fresh browser context per render, no
 *   downloads, service workers blocked, dialogs dismissed, pop-ups closed.
 * - ALL browser traffic is forced through an in-process CONNECT proxy
 *   (`--proxy-server`, with the implicit loopback bypass removed). The proxy
 *   accepts only CONNECT to port 443 for hosts that pass the same URL policy
 *   as the static fetcher, resolves them with the vetted DNS lookup (public
 *   addresses only) and connects to exactly that address — so neither a page
 *   nor DNS rebinding can reach localhost, private networks or cloud
 *   metadata. Plain-HTTP proxy requests are refused.
 * - Each request is also checked against robots.txt (documents, scripts,
 *   XHR/fetch); images, media, fonts, stylesheets and sockets are not loaded.
 * - Bounded: render time, requests per render, HTML size, one render at a
 *   time per process (PROREZ_RENDER_CONCURRENCY).
 * Downloaded scripts run only inside the browser sandbox, never in Node.
 */
import dns from "node:dns";
import http from "node:http";
import net from "node:net";
import { checkSiteUrl, createVettedLookup, type PageRenderer, type PageResult, type SiteFetcher } from "../discovery/net";

type Env = Readonly<Record<string, string | undefined>>;

export interface RenderConfig {
  timeoutMs: number;
  maxRequests: number;
  maxHtmlBytes: number;
  concurrency: number;
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = { timeoutMs: 20_000, maxRequests: 150, maxHtmlBytes: 3 * 1024 * 1024, concurrency: 1 };

function intFrom(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`Invalid ${name} "${raw}": expected a whole number between ${min} and ${max}.`);
  return n;
}

/** Renderer factory from the environment, or null when rendering is off (default) or inside the web server. */
export function rendererFromEnv(env: Env): ((fetcher: SiteFetcher) => PageRenderer) | null {
  const enabled = (env.PROREZ_RENDER_ENABLED ?? "false").trim().toLowerCase();
  if (!["true", "false", "1", "0", ""].includes(enabled)) throw new Error(`Invalid PROREZ_RENDER_ENABLED "${env.PROREZ_RENDER_ENABLED}": use true or false.`);
  const config: RenderConfig = {
    timeoutMs: intFrom(env.PROREZ_RENDER_TIMEOUT_SECONDS, DEFAULT_RENDER_CONFIG.timeoutMs / 1000, 5, 120, "PROREZ_RENDER_TIMEOUT_SECONDS") * 1000,
    maxRequests: intFrom(env.PROREZ_RENDER_MAX_REQUESTS, DEFAULT_RENDER_CONFIG.maxRequests, 10, 1000, "PROREZ_RENDER_MAX_REQUESTS"),
    maxHtmlBytes: DEFAULT_RENDER_CONFIG.maxHtmlBytes,
    concurrency: intFrom(env.PROREZ_RENDER_CONCURRENCY, DEFAULT_RENDER_CONFIG.concurrency, 1, 4, "PROREZ_RENDER_CONCURRENCY"),
  };
  if (enabled !== "true" && enabled !== "1") return null;
  // Browser rendering is a worker-only capability: never launch Chromium from web requests.
  if (env.NEXT_RUNTIME) return null;
  return (fetcher) => createPlaywrightRenderer(fetcher, config);
}

// One process-wide limiter so rendering never crowds out normal syncs.
let active = 0;
const waiters: (() => void)[] = [];
async function acquire(max: number) {
  while (active >= max) await new Promise<void>((r) => waiters.push(r));
  active++;
}
function release() {
  active--;
  waiters.shift()?.();
}

type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * Egress proxy for the browser: CONNECT to :443 only, policy-checked host,
 * vetted public address. Returns its port and a close function.
 */
export async function startEgressProxy(resolver: Resolver = systemResolver): Promise<{ port: number; close: () => Promise<void>; refused: () => number }> {
  let refused = 0;
  const lookup = createVettedLookup(resolver);
  const server = http.createServer((_req, res) => {
    refused++;
    res.writeHead(403).end("Plain HTTP is not allowed.");
  });
  const sockets = new Set<net.Socket>();
  server.on("connection", (s) => (sockets.add(s), s.on("close", () => sockets.delete(s))));
  server.on("connect", (req: http.IncomingMessage, client: net.Socket) => {
    const deny = () => {
      refused++;
      client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    };
    const m = /^([^:\s]+):(\d+)$/.exec(req.url ?? "");
    if (!m || m[2] !== "443" || !checkSiteUrl(`https://${m[1]}/`).ok) return deny();
    const upstream = net.connect({ host: m[1], port: 443, lookup, timeout: 15_000 });
    sockets.add(upstream);
    upstream.once("connect", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.on("error", () => deny());
    upstream.on("timeout", () => upstream.destroy());
    client.on("error", () => upstream.destroy());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    refused: () => refused,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

const BLOCKED_TYPES = new Set(["image", "media", "font", "stylesheet", "websocket", "eventsource", "manifest", "texttrack", "beacon", "ping"]);

export function createPlaywrightRenderer(fetcher: SiteFetcher, config: RenderConfig = DEFAULT_RENDER_CONFIG, resolver?: Resolver): PageRenderer {
  return {
    async render(url, signal): Promise<PageResult> {
      const checked = checkSiteUrl(url);
      if (!checked.ok) return { ok: false, url, failure: "blocked_url", message: checked.reason };
      const pre = await fetcher.allowed?.(url, signal);
      if (pre && !pre.ok) return { ok: false, url, failure: pre.failure, message: pre.message };
      await acquire(config.concurrency);
      let proxy: Awaited<ReturnType<typeof startEgressProxy>> | null = null;
      let browser: { close(): Promise<void> } | null = null;
      try {
        let chromium: typeof import("@playwright/test").chromium;
        try {
          // Optional dependency, loaded only when rendering is enabled.
          const mod = "@playwright/test";
          chromium = ((await import(/* webpackIgnore: true */ mod)) as typeof import("@playwright/test")).chromium;
        } catch {
          return { ok: false, url, failure: "network", message: "Browser rendering is enabled but Playwright is not installed (npx playwright install chromium)." };
        }
        proxy = await startEgressProxy(resolver);
        const b = await chromium.launch({
          headless: true,
          proxy: { server: `http://127.0.0.1:${proxy.port}`, bypass: "<-loopback>" },
          args: ["--proxy-bypass-list=<-loopback>", "--disable-features=WebRtcHideLocalIpsWithMdns", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--disable-quic"],
        });
        browser = b;
        const context = await b.newContext({ acceptDownloads: false, serviceWorkers: "block", javaScriptEnabled: true, userAgent: "ProRezBot/0.3 (personal job search; renders public career pages)", viewport: { width: 1280, height: 2000 } });
        let requests = 0;
        await context.route("**/*", async (route) => {
          const req = route.request();
          const target = req.url();
          if (BLOCKED_TYPES.has(req.resourceType()) || ++requests > config.maxRequests) return route.abort("blockedbyclient");
          if (!target.startsWith("https://") || !checkSiteUrl(target).ok) return route.abort("blockedbyclient");
          const ok = await fetcher.allowed?.(target, signal);
          if (ok && !ok.ok) return route.abort("blockedbyclient");
          return route.continue();
        });
        context.on("page", (p) => {
          p.on("dialog", (d) => void d.dismiss().catch(() => undefined));
          p.on("popup", (pop) => void pop.close().catch(() => undefined));
        });
        const page = await context.newPage();
        const onAbort = () => void b.close().catch(() => undefined);
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          const response = await page.goto(checked.url.toString(), { waitUntil: "domcontentloaded", timeout: config.timeoutMs });
          if (!response || response.status() >= 400) return { ok: false, url, failure: "http_error", message: `HTTP ${response?.status() ?? "no response"} while rendering.` };
          await page.waitForLoadState("networkidle", { timeout: Math.min(10_000, config.timeoutMs) }).catch(() => undefined);
          let html = await page.content();
          if (Buffer.byteLength(html) > config.maxHtmlBytes) html = html.slice(0, config.maxHtmlBytes);
          return { ok: true, url, finalUrl: page.url(), status: response.status(), html, redirects: [] };
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message.split("\n")[0].slice(0, 200) : "Rendering failed.";
        return { ok: false, url, failure: /timeout/i.test(message) ? "timeout" : "network", message };
      } finally {
        await browser?.close().catch(() => undefined);
        await proxy?.close().catch(() => undefined);
        release();
      }
    },
  };
}
