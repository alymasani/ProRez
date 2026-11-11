import { expect, test } from "@playwright/test";

test.describe("manual job submission", () => {
  test("empty submit shows errors and focuses the first invalid field", async ({ page }) => {
    await page.goto("/jobs/new");
    await page.getByRole("button", { name: "Validate & preview" }).click();
    await expect(page.getByText("Provide a job URL, a job description, or both.")).toBeVisible();
    await expect(page.getByText("Company name is required.")).toBeVisible();
    await expect(page.getByText("Position title is required.")).toBeVisible();
    await expect(page.getByText("Select an employment type.")).toBeVisible();
    await expect(page.getByText("Choose Quick Apply or Full Build.")).toBeVisible();
    await expect(page.getByLabel(/Job URL/)).toBeFocused();
    await expect(page.getByLabel(/Job URL/)).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByText("Local preview", { exact: true })).toBeHidden();
  });

  test("rejects a non-http URL and an out-of-range duration", async ({ page }) => {
    await page.goto("/jobs/new");
    await page.getByLabel(/Job URL/).fill("careers.example/job");
    await page.getByLabel(/Duration/).fill("40");
    await page.getByRole("button", { name: "Validate & preview" }).click();
    await expect(page.getByText(/Enter a full URL starting with http/)).toBeVisible();
    await expect(page.getByText(/whole number of months between 1 and 24/)).toBeVisible();
  });

  test("valid input shows a clearly labelled, unsaved local preview", async ({ page }) => {
    await page.goto("/jobs/new");
    await page.getByLabel(/Job URL/).fill("https://careers.example/acme/42");
    await page.getByLabel(/Company name/).fill("Acme Demo Co");
    await page.getByLabel(/Position title/).fill("Software Developer Co-op");
    await page.getByLabel(/Employment type/).selectOption("co_op");
    await page.getByLabel(/Duration/).fill("4");
    await page.getByRole("radio", { name: /Full Build/ }).check();
    await page.getByRole("button", { name: "Validate & preview" }).click();

    await expect(page.getByText("Local preview", { exact: true })).toBeVisible();
    await expect(page.getByText("Not saved")).toBeVisible();
    await expect(page.getByText("Acme Demo Co")).toBeVisible();
    await expect(page.getByText("4 months")).toBeVisible();

    await page.getByRole("button", { name: "Clear form" }).click();
    await expect(page.getByLabel(/Company name/)).toHaveValue("");
    await expect(page.getByText("Local preview", { exact: true })).toBeHidden();
  });

  test("editing a field clears its error", async ({ page }) => {
    await page.goto("/jobs/new");
    await page.getByRole("button", { name: "Validate & preview" }).click();
    await expect(page.getByText("Company name is required.")).toBeVisible();
    await page.getByLabel(/Company name/).fill("A");
    await expect(page.getByText("Company name is required.")).toBeHidden();
  });
});

test.describe("settings", () => {
  test("changes show an unsaved indicator and reset restores defaults; save is disabled", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Showing demo defaults.")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Save/ })).toBeDisabled();

    const alberta = page.getByRole("checkbox", { name: "Alberta" });
    await alberta.click();
    await expect(alberta).toBeChecked();
    await expect(page.getByText("Unsaved", { exact: true })).toBeVisible();

    await page.getByRole("switch", { name: "SmartRecruiters" }).click();
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(alberta).not.toBeChecked();
    await expect(page.getByRole("switch", { name: "SmartRecruiters" })).not.toBeChecked();
    await expect(page.getByText("Showing demo defaults.")).toBeVisible();
  });

  test("integrations are shown as not connected", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("Status: Not connected", { exact: true })).toHaveCount(2);
    for (const btn of await page.getByRole("button", { name: /^Connect/ }).all()) {
      await expect(btn).toBeDisabled();
    }
  });
});

test.describe("applications", () => {
  test("table opens a detail dialog that closes with Escape", async ({ page }) => {
    await page.goto("/applications");
    await page.getByRole("button", { name: /Backend Developer Co-op/ }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Tidewater Fintech");
    await expect(dialog).toContainText("Workflow runs");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("board view groups by preparation status and submission filter works", async ({ page }) => {
    await page.goto("/applications");
    await page.getByRole("tab", { name: "Board" }).click();
    const prepared = page.getByRole("region", { name: "Prepared" });
    await expect(prepared.getByRole("button")).toHaveCount(4);

    await page.getByLabel("Submission").selectOption("not_submitted");
    await expect(prepared.getByRole("button")).toHaveCount(1);
  });
});

test.describe("document libraries", () => {
  test("resume search and status filter", async ({ page }) => {
    await page.goto("/resumes");
    await expect(page.getByText("8 of 8 demo resumes")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search resumes" }).fill("payments");
    await expect(page.getByText("1 of 8 demo resumes")).toBeVisible();
    await page.getByRole("searchbox", { name: "Search resumes" }).fill("");
    await page.getByLabel("Generation status").selectOption("failed");
    await expect(page.getByText("1 of 8 demo resumes")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Download/ }).first()).toBeDisabled();
  });
});

test("applications table scroll area is keyboard reachable", async ({ page }) => {
  await page.goto("/applications");
  const region = page.getByRole("region", { name: "Applications table" });
  await expect(region).toHaveAttribute("tabindex", "0");
  await region.focus();
  await expect(region).toBeFocused();
});
