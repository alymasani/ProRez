import { expect, test } from "@playwright/test";
import { DB_MODE } from "./db-reset";

/** Engine output on job pages and read-only behaviour. Runs in both data modes. */
test.describe("matching results on job pages", () => {
  test("a job matching two profiles shows one canonical result with a primary", async ({ page }) => {
    await page.goto("/jobs/job-004");
    await expect(page.getByText("Junior developer roles")).toBeVisible();
    await expect(page.getByText("New grad SWE")).toBeVisible();
    await expect(page.getByText("Primary", { exact: true })).toHaveCount(1);
    await expect(page.getByText(/Notification: not sent/)).toBeVisible();
  });

  test("a missing duration is flagged for review, not silently accepted", async ({ page }) => {
    await page.goto("/jobs/job-002");
    await expect(page.getByText("Match status: Needs review")).toBeVisible();
    await expect(page.getByText("Duration not stated — needs review")).toBeVisible();
  });

  test("an expired posting is not evaluated", async ({ page }) => {
    await page.goto("/jobs/job-013");
    await expect(page.getByText(/inactive postings are not evaluated/)).toBeVisible();
  });
});

test.describe("read-only demo mode", () => {
  test.skip(DB_MODE, "Fixture mode only");

  test("boards are listed but cannot be registered", async ({ page }) => {
    await page.goto("/boards");
    await expect(page.getByText("Read-only demo boards")).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "Northlight Robotics" })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Register board/ })).toBeDisabled();
    await expect(page.getByLabel("Employer name")).toBeDisabled();
  });

  test("profile edits can be previewed but not saved", async ({ page }) => {
    await page.goto("/profiles/profile-coop-4mo");
    await expect(page.getByText("Read-only demo data")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save changes/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
  });
});
