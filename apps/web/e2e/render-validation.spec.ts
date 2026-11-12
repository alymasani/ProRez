import { expect, test, type Page } from "@playwright/test";

/**
 * Regression: database-backed pages must read request-time data inside a
 * page-level <Suspense> boundary. Otherwise Next.js 16 (Cache Components +
 * Partial Prefetching) reports "encountered uncached data during prerendering
 * or a navigation" and client navigations block on the database.
 *
 * Runs only under playwright.render.config.ts (dev server, database mode).
 */
test.skip(!process.env.E2E_RENDER_VALIDATION, "Run with npm run test:e2e:render");

const VALIDATION_ERROR = /uncached data|blocking-prerender|outside of `?<Suspense>|prevents the route from being prerendered/i;

const ROUTES = [
  { path: "/", heading: "Overview" },
  { path: "/jobs", heading: "Job discovery" },
  { path: "/jobs/job-003", heading: null },
  { path: "/applications", heading: "Applications" },
  { path: "/resumes", heading: "Resume library" },
  { path: "/cover-letters", heading: "Cover letter library" },
  { path: "/projects", heading: "Projects" },
  { path: "/profiles", heading: "Search profiles" },
  { path: "/profiles/profile-coop-4mo", heading: null },
  { path: "/boards", heading: "Employer boards" },
  { path: "/settings", heading: "Settings" },
];

function collectValidationErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && VALIDATION_ERROR.test(m.text())) errors.push(m.text().split("\n")[0]);
  });
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

async function expectRendered(page: Page, heading: string | null) {
  await expect(page.getByTestId("page-skeleton")).toHaveCount(0);
  await expect(page.getByText("This page failed to load")).toHaveCount(0);
  const h1 = page.getByRole("heading", { level: 1 });
  if (heading) await expect(h1).toHaveText(heading);
  else await expect(h1).not.toBeEmpty();
}

test("direct loads of database-backed pages report no uncached-data errors", async ({ page }) => {
  test.setTimeout(240_000); // first dev compile of each route
  const errors = collectValidationErrors(page);
  for (const { path, heading } of ROUTES) {
    await page.goto(path, { waitUntil: "networkidle" });
    await expectRendered(page, heading);
  }
  // Validation is reported asynchronously after hydration.
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});

test("client navigations between database-backed pages report no uncached-data errors", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/", { waitUntil: "networkidle" });
  const errors = collectValidationErrors(page);
  const nav = page.getByRole("navigation").first();
  for (const { path, heading } of ROUTES.filter((r) => r.heading && r.path !== "/").concat({ path: "/", heading: "Overview" })) {
    await nav.locator(`a[href="${path}"]`).first().click();
    await page.waitForURL((url) => url.pathname === path);
    await page.waitForLoadState("networkidle");
    await expectRendered(page, heading);
  }
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});

test("boards: registration and Sync now still work after the Suspense refactor", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = collectValidationErrors(page);
  await page.goto("/boards", { waitUntil: "networkidle" });
  await page.getByLabel("Board URL").fill("https://job-boards.greenhouse.io/prorez-demo-harbourline");
  await page.getByRole("button", { name: "Fill from URL" }).click();
  await page.getByLabel("Employer name").fill("Render Check");
  await page.getByRole("button", { name: "Register board" }).click();
  await expect(page.getByText("Registered Render Check (Greenhouse).")).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Sync Render Check Greenhouse board now" }).click();
  await expect(page.getByRole("main").getByRole("status")).toContainText("Synced Render Check: 3 published");
  await page.waitForTimeout(1000);
  expect(errors).toEqual([]);
});
