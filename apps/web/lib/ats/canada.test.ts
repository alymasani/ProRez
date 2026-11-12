import { describe, expect, it } from "vitest";
import { provinceFrom, resolveCanadianLocations } from "./canada";

const text = (...texts: string[]) => resolveCanadianLocations({ texts, structured: [], workplace: null });

describe("Canadian location normalization", () => {
  it.each([
    ["Toronto, ON", "Toronto", "ON", "onsite"],
    ["Toronto, Ontario, Canada", "Toronto", "ON", "onsite"],
    ["Montréal, QC (Hybrid)", "Montréal", "QC", "hybrid"],
    ["Vancouver", "Vancouver", "BC", "onsite"],
    ["Waterloo - Remote", "Waterloo", "ON", "remote"],
    ["London, ON", "London", "ON", "onsite"],
    ["Halifax, Nova Scotia", "Halifax", "NS", "onsite"],
  ])("%s", (input, city, province, arrangement) => {
    const r = text(input);
    expect(r.canadian).toBe(true);
    // No arrangement in the text and no provider workplace type: the on-site
    // value is a display default only, flagged so matching cannot rely on it.
    const stated = /hybrid|remote/i.test(input);
    if (r.canadian) expect(r.locations[0]).toEqual({ city, province, arrangement, ...(stated ? {} : { arrangementStated: false }) });
  });

  it("marks the arrangement stated when the provider reports a workplace type", () => {
    const r = resolveCanadianLocations({ texts: ["Toronto, ON"], structured: [], workplace: "onsite" });
    expect(r).toMatchObject({ canadian: true, arrangementStated: true, locations: [{ city: "Toronto", province: "ON", arrangement: "onsite" }] });
    if (r.canadian) expect(r.locations[0].arrangementStated).toBeUndefined();
  });

  it("flags structured locations without remote/hybrid/workplace evidence as unstated", () => {
    const r = resolveCanadianLocations({ texts: [], structured: [{ country: "CA", region: "ON", city: "Toronto" }], workplace: null });
    expect(r).toMatchObject({ canadian: true, arrangementStated: false, locations: [{ arrangement: "onsite", arrangementStated: false }] });
  });

  it("treats 'Remote - Canada' as Canada-wide remote (no province)", () => {
    const r = text("Remote - Canada");
    expect(r).toMatchObject({ canadian: true, locations: [{ city: "Remote", province: null, arrangement: "remote" }] });
  });

  it.each(["Remote", "Anywhere", "Remote - Worldwide", "North America", "Remote (Americas)", "San Francisco, CA", "New York, NY", "London", "London, UK", "Amsterdam, NL", "Bratislava, SK", "Lima, PE"])(
    "does not treat %s as Canadian",
    (input) => {
      expect(text(input).canadian).toBe(false);
    },
  );

  it("does not place 'Canada (Hybrid)' without a province", () => {
    expect(text("Canada (Hybrid)").canadian).toBe(false);
  });

  it("accepts ambiguous codes with corroboration", () => {
    expect(text("St. John's, NL").canadian).toBe(true);
    expect(text("Saskatoon, SK").canadian).toBe(true);
  });

  it("uses structured country, region and remote flags", () => {
    const r = resolveCanadianLocations({
      texts: [],
      structured: [{ country: "ca", region: "Ontario", city: "Ottawa", remote: false, hybrid: true }],
      workplace: null,
    });
    expect(r).toMatchObject({ canadian: true, locations: [{ city: "Ottawa", province: "ON", arrangement: "hybrid" }], arrangementStated: true });
  });

  it("ignores structured non-Canadian countries and keeps the Canadian one", () => {
    const r = resolveCanadianLocations({
      texts: [],
      structured: [
        { country: "US", region: "CA", city: "San Jose" },
        { country: "CA", region: "BC", city: "Burnaby" },
      ],
      workplace: "onsite",
    });
    expect(r).toMatchObject({ canadian: true, locations: [{ city: "Burnaby", province: "BC" }] });
  });

  it("splits multi-location text and de-duplicates", () => {
    const r = text("Toronto, ON; Vancouver, BC; Toronto, ON");
    expect(r.canadian && r.locations.map((l) => l.province)).toEqual(["ON", "BC"]);
  });

  it("reads province names and codes", () => {
    expect(provinceFrom("Québec")).toBe("QC");
    expect(provinceFrom("b.c.")).toBe("BC");
    expect(provinceFrom("California")).toBeNull();
  });
});
