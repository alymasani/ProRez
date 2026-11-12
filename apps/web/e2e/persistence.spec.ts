import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import { DB_MODE, resetE2EDatabase } from "./db-reset";

/**
 * Working (persistent) profile and board interfaces. Database mode only:
 * `npm run test:e2e:db`. Each test starts from a freshly seeded e2e database.
 */
test.describe("persistent profiles and boards", () => {
  test.skip(!DB_MODE, "Requires database mode (npm run test:e2e:db)");
  test.skip(({ isMobile }) => isMobile, "Mutating flows run once, on desktop");
  test.beforeEach(() => resetE2EDatabase());

  const card = (page: Page, name: string) => page.locator("li").filter({ hasText: name }).first();

  async function sql(query: string, values: unknown[] = []) {
    const client = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
    await client.connect();
    try {
      await client.query(query, values);
    } finally {
      await client.end();
    }
  }

  test("creates a profile that persists across reloads and appears in the list", async ({ page }) => {
    await page.goto("/profiles/new");
    await page.getByLabel("Profile name").fill("Toronto backend co-ops");
    await page.getByRole("group", { name: "Employment types" }).getByRole("checkbox", { name: "Co-op" }).click();
    await page.getByRole("group", { name: "Internship duration" }).getByRole("checkbox", { name: "Exactly 4 months", exact: true }).click();
    await page.getByRole("group", { name: "Provinces and territories" }).getByRole("checkbox", { name: "Ontario" }).click();
    await page.getByLabel("Preferred keywords").fill("postgresql, typescript");
    await page.getByRole("button", { name: "Create profile" }).click();

    await expect(page).toHaveURL(/\/profiles\/profile-[0-9a-f-]+\?created=1$/);
    await expect(page.getByText("Profile created and saved.")).toBeVisible();
    await expect(page.getByText("v1", { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Profile name")).toHaveValue("Toronto backend co-ops");
    await expect(page.getByLabel("Preferred keywords")).toHaveValue("postgresql, typescript");
    await expect(page.getByRole("group", { name: "Provinces and territories" }).getByRole("checkbox", { name: "Ontario" })).toBeChecked();

    await page.goto("/profiles");
    await expect(page.getByText("4 of 5 profiles enabled")).toBeVisible();
    await expect(card(page, "Toronto backend co-ops")).toBeVisible();
  });

  test("saves edits as a new version", async ({ page }) => {
    await page.goto("/profiles/profile-coop-4mo");
    await expect(page.getByText("v1", { exact: true })).toBeVisible();
    await page.getByLabel("Description").fill("Updated by the e2e suite");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Saved as version 2.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeDisabled(); // nothing unsaved

    await page.reload();
    await expect(page.getByLabel("Description")).toHaveValue("Updated by the e2e suite");
    await expect(page.getByText("v2", { exact: true })).toBeVisible();
  });

  test("enabling and disabling persists and is reflected on job pages", async ({ page }) => {
    const matches = page.locator('[data-slot="card"]').filter({ hasText: "Matching search profiles" });
    await page.goto("/jobs/job-010");
    await expect(matches.getByText("Junior developer roles")).toBeVisible();
    await expect(matches.getByText("Match status: Eligible").first()).toBeVisible();

    await page.goto("/profiles");
    await card(page, "Junior developer roles").getByRole("switch").click();
    await expect(page.getByText("Junior developer roles disabled.")).toBeVisible();
    await expect(page.getByText("2 of 4 profiles enabled")).toBeVisible();

    await page.goto("/jobs/job-010");
    await expect(page.getByText("No enabled search profile matches this job")).toBeVisible();

    await page.goto("/profiles");
    await expect(page.getByText("2 of 4 profiles enabled")).toBeVisible();
    await card(page, "Junior developer roles").getByRole("switch").click();
    await expect(page.getByText("Junior developer roles enabled.")).toBeVisible();
  });

  test("shows needs-review results for ambiguous postings", async ({ page }) => {
    await page.goto("/jobs/job-015");
    await expect(page.getByText("Match status: Needs review")).toBeVisible();
    await expect(page.getByText(/ambiguous, needs review/)).toBeVisible();
  });

  test("reports server-side errors (duplicate name) without leaving the form", async ({ page }) => {
    await page.goto("/profiles/new");
    await page.getByLabel("Profile name").fill("new GRAD swe");
    await page.getByRole("group", { name: "Employment types" }).getByRole("checkbox", { name: "New grad", exact: true }).click();
    await page.getByRole("button", { name: "Create profile" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("Another active profile already uses this name.");
    await expect(page.locator("#profile-name-error")).toHaveText("Another active profile already uses this name.");
    await expect(page).toHaveURL(/\/profiles\/new$/);
    await expect(page.getByLabel("Profile name")).toBeFocused();
  });

  test("warns before leaving with unsaved changes", async ({ page }) => {
    await page.goto("/profiles/profile-junior");
    await page.getByLabel("Profile name").fill("Junior roles (edited)");

    page.once("dialog", (dialog) => dialog.dismiss());
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview" }).click();
    await expect(page).toHaveURL(/\/profiles\/profile-junior$/);
    await expect(page.getByLabel("Profile name")).toHaveValue("Junior roles (edited)");

    page.once("dialog", (dialog) => {
      expect(dialog.message()).toMatch(/unsaved changes/);
      void dialog.accept();
    });
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });

  test("duplicates a profile as a disabled copy, and deletes a profile without history", async ({ page }) => {
    await page.goto("/profiles");
    await card(page, "New grad SWE").getByRole("button", { name: "Duplicate" }).click();
    await expect(page.getByText("Created “New grad SWE (copy)” (disabled).")).toBeVisible();
    const copy = card(page, "New grad SWE (copy)");
    await expect(copy.getByText("Disabled", { exact: true })).toBeVisible();

    await copy.getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("permanently deleted");
    await dialog.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.getByText("New grad SWE (copy) deleted.")).toBeVisible();
    await expect(page.locator("li").filter({ hasText: "New grad SWE (copy)" })).toHaveCount(0);
  });

  test("archives instead of deleting when notified history exists", async ({ page }) => {
    // Simulate a job that already produced a notification for the co-op profile.
    await sql(`UPDATE job_profile_evaluations SET notified_at = now() WHERE job_id = 'job-001'`);
    await page.goto("/profiles");
    await card(page, "Four-month SWE co-ops").getByRole("button", { name: "Delete" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading")).toContainText("Archive");
    await dialog.getByRole("button", { name: "Archive profile" }).click();

    await expect(page.getByText("1 archived profile is kept for notification history")).toBeVisible();
    await page.getByRole("link", { name: "Four-month SWE co-ops" }).click();
    await expect(page.getByText(/^Archived on/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Save changes/ })).toHaveCount(0);

    // The notified job keeps its record of which profile matched.
    await page.goto("/jobs/job-001");
    await expect(page.getByText(/profile archived/)).toBeVisible();
  });

  test("detects conflicting edits from two tabs and keeps the user's edits until they choose", async ({ context }) => {
    const a = await context.newPage();
    const b = await context.newPage();
    await a.goto("/profiles/profile-new-grad");
    await b.goto("/profiles/profile-new-grad");

    await a.getByLabel("Description").fill("Saved first in tab A");
    await a.getByRole("button", { name: "Save changes" }).click();
    await expect(a.getByText("Saved as version 2.")).toBeVisible();

    await b.getByLabel("Description").fill("Edited later in tab B");
    await b.getByRole("button", { name: "Save changes" }).click();
    await expect(b.getByRole("main").getByRole("alert")).toContainText("changed elsewhere (now version 2)");
    await expect(b.getByLabel("Description")).toHaveValue("Edited later in tab B");

    await b.getByRole("button", { name: "Discard my edits and load latest" }).click();
    await expect(b.getByLabel("Description")).toHaveValue("Saved first in tab A");
    await expect(b.getByText("v2", { exact: true })).toBeVisible();
  });

  test("registers, toggles, de-duplicates and removes employer boards", async ({ page }) => {
    await page.goto("/boards");
    await page.getByLabel("Board URL").fill("https://boards.greenhouse.io/AcmeTest/jobs/123");
    await page.getByRole("button", { name: "Fill from URL" }).click();
    await expect(page.getByText("Detected Greenhouse board “acmetest”.")).toBeVisible();
    await expect(page.getByLabel("Board identifier")).toHaveValue("acmetest");
    await page.getByLabel("Employer name").fill("Acme Test");
    await page.getByRole("button", { name: "Register board" }).click();
    await expect(page.getByText("Registered Acme Test (Greenhouse).")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Acme Test" })).toBeVisible();

    // Same board again (different case) is rejected by the database constraint.
    await page.getByLabel("Provider").selectOption("greenhouse");
    await page.getByLabel("Employer name").fill("Acme duplicate");
    await page.getByLabel("Board identifier").fill("ACMETEST");
    await page.getByRole("button", { name: "Register board" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("This board is already registered.");

    await page.getByRole("switch", { name: "Acme Test Greenhouse enabled" }).click();
    await expect(page.getByRole("switch", { name: "Acme Test Greenhouse enabled" })).not.toBeChecked();
    await page.reload();
    await expect(page.getByRole("switch", { name: "Acme Test Greenhouse enabled" })).not.toBeChecked();

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Remove Acme Test Greenhouse board" }).click();
    await expect(page.getByText("Removed Acme Test.")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Acme Test" })).toHaveCount(0);
  });
});
