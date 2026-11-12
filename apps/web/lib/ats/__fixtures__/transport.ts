import { AtsError, assertAllowedUrl, type HttpTransport } from "../http";

/** In-memory transport keyed by exact URL; records every request. */
export function fakeTransport(responses: Record<string, unknown | (() => unknown)>) {
  const requested: string[] = [];
  const transport: HttpTransport = {
    async getJson(url, { signal }) {
      assertAllowedUrl(url);
      requested.push(url);
      if (signal?.aborted) throw new AtsError("cancelled", "The sync was cancelled.");
      if (!(url in responses)) throw new AtsError("not_found", `No fixture for ${url}`, 404);
      const value = responses[url];
      return typeof value === "function" ? (value as () => unknown)() : structuredClone(value);
    },
  };
  return { transport, requested };
}
