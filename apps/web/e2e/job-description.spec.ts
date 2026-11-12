import { expect, test } from "@playwright/test";
import { DB_MODE, resetE2EDatabase } from "./db-reset";

/**
 * Regression for the real Cohere (Ashby) posting that showed a fictional-demo
 * warning and only "WHO ARE WE?" instead of its full description. The Ashby
 * response is a recorded, FICTIONAL copy of that posting's shape
 * (e2e/fixtures/ats/api.ashbyhq.com/...prorez-demo-aurora...).
 */
test.describe("imported job description (database mode)", () => {
  test.skip(!DB_MODE, "Requires database mode (npm run test:e2e:db)");
  test.skip(({ isMobile }) => isMobile, "Mutating flows run once, on desktop");
  test.beforeEach(() => resetE2EDatabase());
  // Leave the shared e2e database as seeded for specs that count jobs.
  test.afterEach(() => resetE2EDatabase());

  test("an Ashby-imported job shows its complete description, real source and no demo messaging", async ({ page }) => {
    await page.goto("/boards");
    await page.getByLabel("Board URL").fill("https://jobs.ashbyhq.com/prorez-demo-aurora");
    await page.getByRole("button", { name: "Fill from URL" }).click();
    await page.getByLabel("Employer name").fill("Aurora Lattice");
    await page.getByRole("button", { name: "Register board" }).click();
    await expect(page.getByText("Registered Aurora Lattice (Ashby).")).toBeVisible();
    await page.getByRole("button", { name: "Sync Aurora Lattice Ashby board now" }).click();
    await expect(page.getByRole("main").getByRole("status")).toContainText("Synced Aurora Lattice: 1 published, 1 new");

    await page.goto("/jobs?q=Aurora+Lattice");
    await page.getByRole("link", { name: /Machine Learning Intern\/Co-op/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Machine Learning Intern/Co-op (Winter 2027)");

    // Accurate notices: workflows unavailable, nothing fictional.
    await expect(page.getByText("Application workflows are not available yet")).toBeVisible();
    await expect(page.getByText(/Demo posting|This company and role are fictional|Placeholder address|Fictional score/)).toHaveCount(0);
    await expect(page.getByText("Not scored yet — candidate-fit scoring arrives in a later milestone.")).toBeVisible();

    // The complete employer-provided description, with its structure.
    const description = page.getByTestId("job-description");
    for (const heading of ["WHO ARE WE?", "Why this role?", "As a Machine Learning Intern, you will:", "You may be a good fit if you have:"]) {
      await expect(description.getByRole("heading", { name: heading })).toBeVisible();
    }
    await expect(description.getByRole("listitem")).toHaveCount(6);
    await expect(description).toContainText("Experience with large-scale distributed training.");
    await expect(description).toContainText("available for a full-time 4-month co-op");
    await expect(description.getByRole("link", { name: "https://aurora-lattice.example/careers" })).toHaveAttribute("href", "https://aurora-lattice.example/careers");

    // No empty structured-section headings for imports.
    await expect(page.getByRole("heading", { name: "Responsibilities", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Qualifications", exact: true })).toHaveCount(0);

    // Source and a working link to the original posting.
    const original = page.getByRole("link", { name: /View original posting on Ashby/ });
    await expect(original).toHaveAttribute("href", "https://jobs.ashbyhq.com/prorez-demo-aurora/9a1c0e52-1111-4a8b-9c3d-0e2f4a6b8c01");
    await expect(original).toHaveAttribute("target", "_blank");
    await expect(original).toHaveAttribute("rel", /noopener/);
  });
});

test.describe("manual job description (database mode)", () => {
  test.skip(!DB_MODE, "Requires database mode (npm run test:e2e:db)");
  test.skip(({ isMobile }) => isMobile, "Mutating flows run once, on desktop");
  test.beforeEach(() => resetE2EDatabase());
  // Leave the shared e2e database as seeded for specs that count jobs.
  test.afterEach(() => resetE2EDatabase());

  test("a pasted description is shown in full; a job without one says so", async ({ page }) => {
    await page.goto("/jobs/new");
    await page.getByLabel(/Job URL/).fill("https://careers.example/desc-check/1");
    await page.getByLabel(/Full job description/).fill(
      "About us\nWe build accessible maps for Canadian transit riders and are hiring our first co-op students this summer.\n\nWhat you will do:\n- Ship map tiles\n- Write <b>tests</b> <script>window.__xss = 1</script>\n\nMore at https://example.com/desc-check",
    );
    await page.getByLabel(/^Company/).fill("Desc Check Co");
    await page.getByLabel(/Position title/).fill("Mapping Developer Co-op");
    await page.getByLabel(/Employment type/).selectOption("co_op");
    await page.getByRole("button", { name: "Save job" }).click();
    await expect(page).toHaveURL(/\/jobs\/job-[0-9a-f-]+\?created=1/);

    const description = page.getByTestId("job-description");
    await expect(description.getByRole("heading", { name: "What you will do:" })).toBeVisible();
    await expect(description.getByRole("listitem")).toHaveCount(2);
    await expect(description).toContainText("<script>window.__xss = 1</script>"); // shown as text, never executed
    expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await expect(description.getByRole("link", { name: "https://example.com/desc-check" })).toBeVisible();
    await expect(page.getByText(/Demo posting|This company and role are fictional|Placeholder address|Fictional score/)).toHaveCount(0);

    await page.goto("/jobs/new");
    await page.getByLabel(/Job URL/).fill("https://careers.example/desc-check/2");
    await page.getByLabel(/^Company/).fill("Desc Check Co");
    await page.getByLabel(/Position title/).fill("Data Developer Co-op");
    await page.getByLabel(/Employment type/).selectOption("co_op");
    await page.getByRole("button", { name: "Save job" }).click();
    await expect(page).toHaveURL(/\/jobs\/job-[0-9a-f-]+\?created=1/);
    await expect(page.getByRole("note")).toHaveText("The source did not provide a job description.");
    await expect(page.getByRole("heading", { name: /^(Responsibilities|Qualifications)$/ })).toHaveCount(0);
  });
});

test.describe("demo job details (fixture mode)", () => {
  test.skip(DB_MODE, "Fixture mode only");

  test("fictional demo postings keep their demo warning and structured sections", async ({ page }) => {
    await page.goto("/jobs/job-003");
    await expect(page.getByText("Demo posting — actions are not active yet")).toBeVisible();
    await expect(page.getByText("This company and role are fictional", { exact: false })).toBeVisible();
    await expect(page.getByText("Placeholder address — not a real listing.")).toBeVisible();
    for (const name of ["Responsibilities", "Qualifications"]) {
      const section = page.locator("section").filter({ has: page.getByRole("heading", { name, exact: true }) });
      await expect(section.getByRole("listitem").first()).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /View original posting/ })).toHaveCount(0);
  });
});
