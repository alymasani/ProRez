import { expect, test } from "@playwright/test";
import { DB_MODE, resetE2EDatabase } from "./db-reset";

test.describe("Milestone 2C persistent workflows", () => {
  test.skip(!DB_MODE, "Requires the isolated E2E database");
  test.beforeEach(() => resetE2EDatabase());

  test("manual job, duplicate, lifecycle, application and history persist", async ({ page, isMobile }) => {
    test.skip(isMobile, "Full mutation workflow runs once on desktop");
    await page.goto("/jobs/new");
    await page.getByLabel(/Job URL/).fill("https://careers.example/acme/m2c-42?utm_source=e2e");
    await page.getByLabel(/^Company/).fill("M2C Test Company");
    await page.getByLabel(/Position title/).fill("Software Developer Co-op");
    await page.getByLabel(/Employment type/).selectOption("co_op");
    await page.getByLabel(/Duration/).fill("4");
    await page.getByRole("button", { name: "Save job" }).click();
    await expect(page).toHaveURL(/\/jobs\/job-[0-9a-f-]+\?created=1/);
    const jobUrl = page.url();
    await expect(page.getByText("Four-month SWE co-ops")).toBeVisible();

    await page.goto("/jobs/new");
    await page.getByLabel(/Job URL/).fill("https://careers.example/acme/m2c-42?utm_campaign=duplicate");
    await page.getByLabel(/^Company/).fill("M2C Test Company");
    await page.getByLabel(/Position title/).fill("Software Developer Co-op");
    await page.getByLabel(/Employment type/).selectOption("co_op");
    await page.getByLabel(/Duration/).fill("4");
    await page.getByRole("button", { name: "Save job" }).click();
    await expect(page.getByText("Existing job found")).toBeVisible();

    await page.goto(jobUrl);
    await page.getByRole("button", { name: "Dismiss job" }).click();
    await expect(page.getByRole("button", { name: "Restore job" })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Restore job" }).click();
    await expect(page.getByRole("button", { name: "Unsave job" })).toBeVisible();
    await page.getByLabel("Job notes").fill("Call recruiter next week");
    await page.getByRole("button", { name: "Save notes" }).click();
    await page.getByRole("button", { name: "Start tracking" }).click();
    await expect(page.getByText("Application tracking started.")).toBeVisible();

    await page.goto("/applications");
    await page.getByRole("button").filter({ hasText: "M2C Test Company" }).click();
    await page.getByLabel("New application status").selectOption("submitted");
    await page.getByLabel("Submission date").fill("2026-11-11");
    await page.getByRole("button", { name: "Update status" }).click();
    await page.getByLabel("Application notes").fill("Submitted through employer portal");
    await page.getByRole("button", { name: "Save application notes" }).click();
    await page.getByLabel("Interview stage").selectOption("technical");
    await page.getByLabel("Interview date").fill("2026-11-20");
    await page.getByRole("button", { name: "Add interview" }).click();
    await expect(page.getByText("Interview recorded.")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.reload();
    await page.getByRole("button").filter({ hasText: "M2C Test Company" }).click();
    await expect(page.getByLabel("Application notes")).toHaveValue("Submitted through employer portal");
    await expect(page.getByRole("heading", { name: "History" }).locator("..").getByText("Technical interview", { exact: true })).toBeVisible();
  });

  test("settings persist through reload on desktop and mobile", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("checkbox", { name: "Alberta" }).check();
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Alberta" })).toBeChecked();
  });
});
