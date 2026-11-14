import { expect, test } from "@playwright/test";
import { DB_MODE, resetE2EDatabase } from "./db-reset";

/**
 * Milestone 3D universal career-URL import, end to end on the isolated e2e
 * database. Recorded responses only (fictional tenants and sites under
 * e2e/fixtures); nothing touches the network.
 */
test.describe("universal career URL import (database mode)", () => {
  test.skip(!DB_MODE, "Requires database mode (npm run test:e2e:db)");
  test.skip(({ isMobile }) => isMobile, "Mutating flows run once, on desktop");
  test.beforeEach(() => resetE2EDatabase());
  test.afterEach(() => resetE2EDatabase());


  test("detects a Workday site, previews its jobs, registers it, and syncs it", async ({ page }) => {
    await page.goto("/boards");
    await page.getByLabel("Careers URL").fill("https://prorez-demo-maple.wd3.myworkdayjobs.com/en-US/External/job/Toronto-ON/Software-Developer-Intern_R100");
    await page.getByRole("button", { name: "Check URL" }).click();
    const preview = page.getByTestId("career-preview");
    await expect(preview).toContainText("Workday");
    await expect(preview).toContainText("https://prorez-demo-maple.wd3.myworkdayjobs.com/external");
    await expect(page.getByTestId("career-preview-jobs")).toHaveText("2 (1 Canadian entry-level)");
    await expect(preview).toContainText("Workday career site JSON");
    await expect(preview).toContainText("Not confirmed");
    await expect(preview).toContainText("Software Developer Intern");
    await preview.getByLabel("Employer name").fill("Maple Demo Systems");
    await page.getByRole("button", { name: "Register source" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Registered Maple Demo Systems (Workday)" })).toBeVisible();

    const row = page.getByRole("row").filter({ hasText: "Maple Demo Systems" });
    await expect(row).toContainText("Workday");
    await expect(row).toContainText("Scheduled");
    await row.getByRole("button", { name: /Sync Maple Demo Systems Workday board now/ }).click();
    await expect(page.getByText(/Synced Maple Demo Systems: 2 published, 1 eligible, 1 new/)).toBeVisible();
  });

  test("extracts a custom careers page (JSON-LD + static HTML), registers it, and shows extraction details", async ({ page }) => {
    await page.goto("/boards");
    await page.getByLabel("Careers URL").fill("careers.prorez-fixture-birch.ca/jobs");
    await page.getByRole("button", { name: "Check URL" }).click();
    const preview = page.getByTestId("career-preview");
    await expect(preview).toContainText("Company career site");
    await expect(page.getByTestId("career-preview-jobs")).toHaveText("2 (2 Canadian entry-level)");
    await expect(preview).toContainText("Embedded Firmware Co-op");
    await expect(preview).toContainText("Data Analyst Intern");
    await expect(preview).toContainText("2 of 2 with a full description");
    await expect(preview).toContainText("Not provably complete");
    await expect(preview.getByLabel("Employer name")).toHaveValue("Birch Fixture Labs");
    await page.getByRole("button", { name: "Register source" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Registered Birch Fixture Labs" })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Birch Fixture Labs" });
    await expect(row).toContainText("Company career site");
    await expect(row).toContainText("Last complete listing: never");
    await row.getByRole("button", { name: /Sync Birch Fixture Labs/ }).click();
    // One job was recognised heuristically, so the snapshot is not provably complete: partial, nothing expired.
    await expect(page.getByText(/Synced Birch Fixture Labs partially: 2 published, 2 eligible, 2 new/)).toBeVisible();
  });

  test("explains why an unsupported page or an invalid URL cannot be imported", async ({ page }) => {
    await page.goto("/boards");
    await page.getByLabel("Careers URL").fill("https://prorez-fixture-cedar.ca/careers");
    await page.getByRole("button", { name: "Check URL" }).click();
    await expect(page.getByTestId("career-preview-jobs")).toHaveText("0 (0 Canadian entry-level)");
    await expect(page.getByRole("alert").filter({ hasText: "No job postings could be extracted" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Register source" })).toHaveCount(0);

    await page.getByLabel("Careers URL").fill("http://localhost:3000/careers");
    await page.getByRole("button", { name: "Check URL" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "cannot be imported" })).toBeVisible();
  });
});
