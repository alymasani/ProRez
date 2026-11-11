import { expect, test } from "@playwright/test";

test.describe("search profiles list", () => {
  test("multiple profiles can be enabled; toggles are marked unsaved", async ({ page }) => {
    await page.goto("/profiles");
    await expect(page.getByText("3 of 4 profiles enabled")).toBeVisible();

    await page.getByRole("switch", { name: "Disabled" }).click();
    await expect(page.getByText("4 of 4 profiles enabled")).toBeVisible();
    await expect(page.getByText("Unsaved toggle changes")).toBeVisible();

    const enabledSwitches = page.getByRole("switch", { name: "Enabled" });
    await expect(enabledSwitches).toHaveCount(4);
    await enabledSwitches.first().click();
    await expect(page.getByText("3 of 4 profiles enabled")).toBeVisible();
  });

  test("edit link opens the editor", async ({ page }) => {
    await page.goto("/profiles");
    await page.getByRole("link", { name: "Edit" }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Four-month SWE co-ops" })).toBeVisible();
  });
});

test.describe("search profile editor", () => {
  test("new profile validation reports required fields", async ({ page }) => {
    await page.goto("/profiles/new");
    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.getByText("Give this profile a name.")).toBeVisible();
    await expect(page.getByText("Select at least one employment type.")).toBeVisible();
    await expect(page.getByText("2 issues to fix.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Create profile/ })).toBeDisabled();
  });

  test("existing profile validates, edits update the live summary, and reset restores", async ({ page }) => {
    await page.goto("/profiles/profile-coop-4mo");
    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.getByText("Configuration is valid.")).toBeVisible();

    const summary = page.getByRole("main").getByRole("complementary");
    await page.getByRole("radio", { name: /Notification only/ }).check();
    await expect(summary).toContainText("Notification only");
    await expect(summary.getByText("Unsaved")).toBeVisible();

    await page.getByLabel("Profile name").fill("");
    await expect(page.getByText("Give this profile a name.")).toBeVisible();

    await page.getByRole("button", { name: "Reset" }).click();
    await expect(page.getByLabel("Profile name")).toHaveValue("Four-month SWE co-ops");
    await expect(summary).toContainText("Approval required");
    await expect(summary.getByText("Unsaved")).toBeHidden();
  });

  test("duration only applies to internships and co-ops", async ({ page }) => {
    await page.goto("/profiles/new");
    await page.getByRole("checkbox", { name: "New grad", exact: true }).click();
    const durationGroup = page.getByRole("group", { name: "Internship duration" });
    await expect(durationGroup.getByRole("checkbox", { name: "4 months" })).toBeDisabled();
    await page.getByRole("checkbox", { name: "Co-op" }).click();
    await expect(durationGroup.getByRole("checkbox", { name: "4 months" })).toBeEnabled();
  });

  test("keywords included and excluded at once are flagged", async ({ page }) => {
    await page.goto("/profiles/profile-coop-4mo");
    await page.getByLabel("Exclude titles containing").fill("senior, Engineer");
    await page.getByRole("button", { name: "Validate" }).click();
    await expect(page.getByText('"Engineer" is both included and excluded.')).toBeVisible();
  });

  test("notification cadence is disabled when notifications are off", async ({ page }) => {
    await page.goto("/profiles/profile-coop-4mo");
    const cadence = page.getByLabel("Cadence");
    await expect(cadence).toBeEnabled();
    await page.getByRole("switch", { name: "Telegram notifications" }).click();
    await expect(cadence).toBeDisabled();
  });
});
