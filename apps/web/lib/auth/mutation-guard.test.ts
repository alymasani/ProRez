import { describe, expect, it } from "vitest";
import { checkMutationAccess, mutationsConfigured, type MutationContext } from "./mutation-guard";

const OK: MutationContext = {
  dataSource: "database",
  localMutations: "enabled",
  host: "localhost:3000",
  origin: "http://localhost:3000",
};

describe("checkMutationAccess", () => {
  it("allows the local owner on loopback hosts", () => {
    for (const [host, origin] of [
      ["localhost:3000", "http://localhost:3000"],
      ["127.0.0.1:3211", "http://127.0.0.1:3211"],
      ["[::1]:3000", "http://[::1]:3000"],
    ]) {
      expect(checkMutationAccess({ ...OK, host, origin })).toEqual({ ok: true, actor: { kind: "local-owner" } });
    }
  });

  it("treats fixtures as read-only", () => {
    expect(checkMutationAccess({ ...OK, dataSource: "fixtures" })).toMatchObject({ ok: false, code: "read_only" });
  });

  it("fails closed unless mutations are explicitly enabled", () => {
    for (const localMutations of [undefined, "", "true", "1", "ENABLED"]) {
      expect(checkMutationAccess({ ...OK, localMutations })).toMatchObject({ ok: false, code: "forbidden" });
    }
  });

  it("rejects non-loopback hosts (LAN access, DNS rebinding)", () => {
    for (const host of ["192.168.1.20:3000", "prorez.example:3000", "localhost.evil.example", null]) {
      expect(checkMutationAccess({ ...OK, host, origin: OK.origin })).toMatchObject({ ok: false, code: "forbidden" });
    }
  });

  it("rejects missing or foreign origins", () => {
    for (const origin of [null, "https://evil.example", "not a url", "http://192.168.1.20:3000"]) {
      expect(checkMutationAccess({ ...OK, origin })).toMatchObject({ ok: false, code: "forbidden" });
    }
  });
});

describe("mutationsConfigured", () => {
  it("reports why saving is unavailable", () => {
    expect(mutationsConfigured({ dataSource: "fixtures", localMutations: "enabled" }).enabled).toBe(false);
    expect(mutationsConfigured({ dataSource: "database", localMutations: undefined }).enabled).toBe(false);
    expect(mutationsConfigured({ dataSource: "database", localMutations: "enabled" })).toEqual({
      enabled: true,
      reason: null,
    });
  });
});
