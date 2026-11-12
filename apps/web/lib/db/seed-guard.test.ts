import { describe, expect, it } from "vitest";
import { checkDemoSeedAllowed } from "./seed-guard";

const LOCAL = "postgresql://prorez:pw@127.0.0.1:5433/prorez_dev";

describe("checkDemoSeedAllowed", () => {
  it("allows a local development database", () => {
    expect(checkDemoSeedAllowed({ DATABASE_URL: LOCAL })).toEqual({ ok: true, database: "prorez_dev" });
    expect(checkDemoSeedAllowed({ DATABASE_URL: "postgres://u:p@localhost/prorez_dev" }).ok).toBe(true);
    expect(checkDemoSeedAllowed({ DATABASE_URL: "postgresql://u:p@postgres:5432/prorez_dev" }).ok).toBe(true);
  });

  it("refuses when NODE_ENV is production, even locally", () => {
    const result = checkDemoSeedAllowed({ NODE_ENV: "production", DATABASE_URL: LOCAL });
    expect(result.ok).toBe(false);
  });

  it("refuses remote hosts unless explicitly allowed", () => {
    const remote = "postgresql://u:p@db.example.com:5432/prorez_staging";
    expect(checkDemoSeedAllowed({ DATABASE_URL: remote }).ok).toBe(false);
    expect(checkDemoSeedAllowed({ DATABASE_URL: remote, PROREZ_ALLOW_REMOTE_DEMO_SEED: "true" }).ok).toBe(false);
    expect(checkDemoSeedAllowed({ DATABASE_URL: remote, PROREZ_ALLOW_REMOTE_DEMO_SEED: "1" }).ok).toBe(true);
  });

  it("refuses database names that look like production, even with the override", () => {
    const result = checkDemoSeedAllowed({
      DATABASE_URL: "postgresql://u:p@localhost/prorez_production",
      PROREZ_ALLOW_REMOTE_DEMO_SEED: "1",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses missing, malformed, or non-Postgres URLs", () => {
    expect(checkDemoSeedAllowed({}).ok).toBe(false);
    expect(checkDemoSeedAllowed({ DATABASE_URL: "not a url" }).ok).toBe(false);
    expect(checkDemoSeedAllowed({ DATABASE_URL: "mysql://u:p@localhost/db" }).ok).toBe(false);
  });
});
