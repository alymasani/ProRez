import { describe, expect, it } from "vitest";
import { checkBuildDataSource } from "./build-data-source";

describe("build/runtime data source guard", () => {
  it("accepts matching modes (unset means fixtures on both sides)", () => {
    expect(checkBuildDataSource("database", { PROREZ_DATA_SOURCE: "database" })).toEqual({ ok: true, dataSource: "database" });
    expect(checkBuildDataSource(undefined, {})).toEqual({ ok: true, dataSource: "fixtures" });
    expect(checkBuildDataSource("fixtures", { PROREZ_DATA_SOURCE: " " })).toMatchObject({ ok: true });
  });

  it("refuses a fixture build started in database mode (the stale read-only /boards trap)", () => {
    const r = checkBuildDataSource("fixtures", { PROREZ_DATA_SOURCE: "database" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/read-only demo data.*Rebuild/);
  });

  it("refuses a database build started in fixture mode", () => {
    expect(checkBuildDataSource("database", {}).ok).toBe(false);
  });
});
