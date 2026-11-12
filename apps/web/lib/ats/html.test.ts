import { describe, expect, it } from "vitest";
import { htmlToText } from "./html";

describe("htmlToText", () => {
  it("converts structure to plain text and drops scripts", () => {
    expect(htmlToText("<h2>About</h2><p>Build <b>APIs</b>.</p><ul><li>Go</li><li>SQL</li></ul><script>alert(1)</script>")).toBe(
      "About\nBuild APIs.\n- Go\n- SQL",
    );
  });
  it("decodes Greenhouse's entity-encoded HTML", () => {
    expect(htmlToText("&lt;p&gt;Hello &amp;amp; welcome&lt;/p&gt;")).toBe("Hello & welcome");
  });
  it("handles empty input", () => {
    expect(htmlToText(null)).toBe("");
  });
});
