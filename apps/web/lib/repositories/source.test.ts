import { describe, expect, it } from "vitest";
import { resolveDataSource } from "./source";

describe("resolveDataSource", () => {
  it("defaults to fixtures", () => {
    expect(resolveDataSource({})).toBe("fixtures");
    expect(resolveDataSource({ PROREZ_DATA_SOURCE: "  " })).toBe("fixtures");
  });

  it("accepts the supported values", () => {
    expect(resolveDataSource({ PROREZ_DATA_SOURCE: "fixtures" })).toBe("fixtures");
    expect(resolveDataSource({ PROREZ_DATA_SOURCE: "database" })).toBe("database");
  });

  it("rejects unknown values instead of silently falling back", () => {
    expect(() => resolveDataSource({ PROREZ_DATA_SOURCE: "postgres" })).toThrow(/Invalid PROREZ_DATA_SOURCE/);
  });
});
