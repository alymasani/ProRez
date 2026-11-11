import { expect, type Page } from "@playwright/test";

export const ROUTES = [
  { path: "/", heading: "Overview" },
  { path: "/jobs", heading: "Job discovery" },
  { path: "/jobs/job-001", heading: "Software Engineering Intern, Embedded Systems" },
  { path: "/jobs/new", heading: "Add a job manually" },
  { path: "/applications", heading: "Applications" },
  { path: "/resumes", heading: "Resume library" },
  { path: "/cover-letters", heading: "Cover letter library" },
  { path: "/projects", heading: "Projects" },
  { path: "/profiles", heading: "Search profiles" },
  { path: "/profiles/new", heading: "New search profile" },
  { path: "/profiles/profile-coop-4mo", heading: "Four-month SWE co-ops" },
  { path: "/settings", heading: "Settings" },
] as const;

/** Collects uncaught page errors and console errors for the lifetime of the page. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  return errors;
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "page should not scroll horizontally").toBeLessThanOrEqual(0);
}

/** Duplicate ids break label/aria associations (regression: job filter panel). */
export async function expectUniqueIds(page: Page) {
  const duplicates = await page.evaluate(() => {
    const seen = new Map<string, number>();
    for (const el of document.querySelectorAll("[id]")) seen.set(el.id, (seen.get(el.id) ?? 0) + 1);
    return [...seen].filter(([, n]) => n > 1).map(([id]) => id);
  });
  expect(duplicates, "element ids should be unique").toEqual([]);
}

/** The visible theme toggle (desktop sidebar or mobile header). */
export function themeToggle(page: Page) {
  return page.getByRole("button", { name: "Change colour theme" }).filter({ visible: true });
}

export function isDark(page: Page) {
  return page.evaluate(() => document.documentElement.classList.contains("dark"));
}
