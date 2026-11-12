import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JobDescription } from "@/components/jobs/job-description";
import { assessDescription, firstParagraph, linkify, parseDescription } from "./description";
import { summarizeDescription } from "./manual-submission";

// Shape of a real Ashby `descriptionPlain` (Cohere, Nov 2026): heading lines,
// blank-line-separated paragraphs, " - " bullets separated by blank lines, bare URLs.
const ASHBY_PLAIN = `WHO ARE WE?

Cohere-like Corp is a fictional enterprise AI company used in tests.

Why this role?

Ship state of the art models to production.

As a Machine Learning Intern, you will:

 - Design, train and improve upon cutting-edge models.

 - Help us develop new techniques to train and serve models.

You may be a good fit if you have:

 - Proficiency in Python and related ML frameworks such as JAX, Pytorch and/or Tensorflow

 - Experience with large-scale distributed training

Apply via https://example.com/apply, or see https://example.com/careers.`;

const textOf = (blocks: ReturnType<typeof parseDescription>) =>
  blocks.flatMap((b) => (b.kind === "list" ? b.items : [b.text]));

describe("parseDescription", () => {
  it("recovers headings, paragraphs and lists from Ashby plain text", () => {
    const blocks = parseDescription(ASHBY_PLAIN);
    expect(blocks.filter((b) => b.kind === "heading").map((b) => b.kind === "heading" && b.text)).toEqual([
      "WHO ARE WE?",
      "Why this role?",
      "As a Machine Learning Intern, you will:",
      "You may be a good fit if you have:",
    ]);
    const lists = blocks.filter((b) => b.kind === "list");
    expect(lists).toHaveLength(2);
    expect(lists[0]).toEqual({ kind: "list", items: ["Design, train and improve upon cutting-edge models.", "Help us develop new techniques to train and serve models."] });
    expect(lists[1].kind === "list" && lists[1].items).toHaveLength(2);
  });

  it("never drops or invents content: every non-blank line appears once, in order", () => {
    const expected = ASHBY_PLAIN.split("\n").map((l) => l.trim().replace(/^-\s+/, "")).filter(Boolean);
    expect(textOf(parseDescription(ASHBY_PLAIN))).toEqual(expected);
  });

  it("handles single-newline text from HTML conversion and other bullet styles", () => {
    const blocks = parseDescription("Responsibilities\n• Build APIs\n• Write tests\n1. Ship\nWe value curiosity.");
    expect(blocks).toEqual([
      { kind: "heading", text: "Responsibilities" },
      { kind: "list", items: ["Build APIs", "Write tests", "Ship"] },
      { kind: "paragraph", text: "We value curiosity." },
    ]);
  });

  it("does not leave a trailing heading and returns nothing for empty input", () => {
    expect(parseDescription("Questions?")).toEqual([{ kind: "paragraph", text: "Questions?" }]);
    expect(parseDescription(null)).toEqual([]);
    expect(parseDescription("  \n ")).toEqual([]);
  });
});

describe("linkify", () => {
  it("links http(s) URLs and leaves trailing punctuation outside the link", () => {
    expect(linkify("Apply via https://example.com/apply, today.")).toEqual([
      { kind: "text", text: "Apply via " },
      { kind: "link", text: "https://example.com/apply", href: "https://example.com/apply" },
      { kind: "text", text: ", today." },
    ]);
  });

  it("never links other schemes", () => {
    expect(linkify("javascript:alert(1) data:text/html,x ftp://x.example")).toEqual([
      { kind: "text", text: "javascript:alert(1) data:text/html,x ftp://x.example" },
    ]);
  });
});

describe("summaries skip leading headings", () => {
  it("uses the first real paragraph, not 'WHO ARE WE?'", () => {
    expect(firstParagraph(ASHBY_PLAIN)).toBe("Cohere-like Corp is a fictional enterprise AI company used in tests.");
    expect(summarizeDescription(ASHBY_PLAIN)).toBe("Cohere-like Corp is a fictional enterprise AI company used in tests.");
  });
});

describe("assessDescription", () => {
  it("flags missing and incomplete descriptions instead of treating them as imported in full", () => {
    expect(assessDescription(null)).toMatchObject({ status: "missing" });
    expect(assessDescription("   ")).toMatchObject({ status: "missing" });
    expect(assessDescription("Join our team as an intern.")).toMatchObject({ status: "incomplete", characters: 27 });
    expect(assessDescription(ASHBY_PLAIN.repeat(2))).toEqual({ status: "complete", characters: expect.any(Number), message: null });
  });
});

describe("JobDescription rendering", () => {
  const render = (text: string) => renderToStaticMarkup(createElement(JobDescription, { text }));

  it("renders the complete description with headings, lists and safe links", () => {
    const html = render(ASHBY_PLAIN);
    expect(html).toContain("<h3");
    expect(html).toContain(">WHO ARE WE?</h3>");
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(html).toContain("Experience with large-scale distributed training");
    expect(html).toContain('href="https://example.com/apply"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
  });

  it("cannot be used to inject markup or scripts", () => {
    const html = render(
      'WHO ARE WE?\n<script>alert("x")</script>\n- <img src=x onerror="alert(1)">\n<a href="javascript:alert(1)">click</a> javascript:alert(2)',
    );
    expect(html).not.toMatch(/<script|<img|<a href="javascript/i);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain('href="javascript');
  });
});
