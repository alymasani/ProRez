import { describe, expect, it } from "vitest";
import { classifyEmployment, extractDurationMonths, extractTerm, inferDisciplines } from "./classify";

describe("employment classification", () => {
  it.each([
    ["Software Engineering Co-op (Fall 2027)", null, "co_op"],
    ["Software Developer Intern", null, "internship"],
    ["Backend Engineer", "Intern", "internship"],
    ["Software Engineer, New Grad 2027", "FullTime", "new_grad"],
    ["Junior Full Stack Developer", "Full-time", "junior"],
    ["Software Engineer I", null, "junior"],
    ["Stagiaire en développement logiciel", null, "internship"],
  ])("%s → %s", (title, type, expected) => {
    expect(classifyEmployment(title, type)).toMatchObject({ ok: true, jobType: expected });
  });

  it.each([
    ["Senior Software Engineer", "Full-time"],
    ["Staff Engineer", null],
    ["Engineering Manager", null],
    ["Software Engineer", "FullTime"],
    ["Product Designer", null],
  ])("skips %s", (title, type) => {
    expect(classifyEmployment(title, type).ok).toBe(false);
  });

  it("does not let 'senior' exclude a co-op", () => {
    expect(classifyEmployment("Senior Year Co-op Student", null)).toMatchObject({ ok: true, jobType: "co_op" });
  });
});

describe("duration and term", () => {
  it("extracts a single stated duration", () => {
    expect(extractDurationMonths(["4-month co-op term"])).toBe(4);
    expect(extractDurationMonths(["An eight month internship"])).toBe(8);
    expect(extractDurationMonths(["12 months"])).toBe(12);
  });
  it("returns null when absent or ambiguous", () => {
    expect(extractDurationMonths(["Summer internship"])).toBeNull();
    expect(extractDurationMonths(["4 or 8 months available"])).toBeNull();
  });
  it("extracts a term", () => {
    expect(extractTerm(["Co-op, fall 2027"])).toBe("Fall 2027");
    expect(extractTerm(["no term"])).toBeNull();
  });
  it("infers disciplines from the title only", () => {
    expect(inferDisciplines("Backend Developer Co-op")).toEqual(["backend"]);
    expect(inferDisciplines("Full Stack Engineer Intern")).toEqual(["full_stack"]);
    expect(inferDisciplines("Software Engineer Intern")).toEqual([]);
  });
});
