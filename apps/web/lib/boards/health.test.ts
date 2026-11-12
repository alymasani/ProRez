import { describe, expect, it } from "vitest";
import { boardHealth, formatPollInterval } from "./health";

describe("boardHealth", () => {
  const base = { enabled: true, lastCheckedAt: null, consecutiveFailures: 0 };
  it("derives a failure state from consecutive failures", () => {
    expect(boardHealth(base)).toBe("never_checked");
    expect(boardHealth({ ...base, lastCheckedAt: "t" })).toBe("healthy");
    expect(boardHealth({ ...base, lastCheckedAt: "t", consecutiveFailures: 1 })).toBe("degraded");
    expect(boardHealth({ ...base, lastCheckedAt: "t", consecutiveFailures: 3 })).toBe("failing");
    expect(boardHealth({ ...base, enabled: false, consecutiveFailures: 9 })).toBe("disabled");
  });
});

describe("formatPollInterval", () => {
  it("uses the largest whole unit", () => {
    expect(formatPollInterval(45)).toBe("every 45 minutes");
    expect(formatPollInterval(60)).toBe("every 1 hour");
    expect(formatPollInterval(360)).toBe("every 6 hours");
    expect(formatPollInterval(1440)).toBe("every 1 day");
  });
});
