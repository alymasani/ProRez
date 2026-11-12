import { expect, test } from "@playwright/test";
import { DB_MODE } from "./db-reset";
import { ROUTES, expectNoHorizontalOverflow, expectUniqueIds, trackErrors } from "./helpers";

test.describe("every route", () => {
  for (const route of ROUTES) {
    test(`${route.path} renders without errors or horizontal overflow`, async ({ page }) => {
      const errors = trackErrors(page);
      await page.goto(route.path);
      await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalOverflow(page);
      await expectUniqueIds(page);
      expect(errors).toEqual([]);
    });
  }

  test("unknown records show the not-found state", async ({ page }) => {
    await page.goto("/jobs/does-not-exist");
    await expect(page.getByText("Page not found")).toBeVisible();
    await page.goto("/profiles/does-not-exist");
    await expect(page.getByText("Page not found")).toBeVisible();
  });

  test("every page carries a visible data-mode notice that matches the mode", async ({ page }) => {
    await page.goto("/");
    // Database mode must not call real records demo data (regression: real ATS jobs).
    const expected = DB_MODE
      ? /Only records marked Demo are fictional|records marked Demo are fictional/
      : /All data is fictional|Demo data only/;
    await expect(page.getByText(expected).filter({ visible: true })).toBeVisible();
  });
});

test.describe("sidebar navigation (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "desktop sidebar only");

  test("links navigate and mark the current page", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Main" });
    const targets = [
      ["Job discovery", "Job discovery"],
      ["Add a job", "Add a job manually"],
      ["Applications", "Applications"],
      ["Resumes", "Resume library"],
      ["Cover letters", "Cover letter library"],
      ["Projects", "Projects"],
      ["Search profiles", "Search profiles"],
      ["Employer boards", "Employer boards"],
      ["Settings", "Settings"],
      ["Overview", "Overview"],
    ] as const;
    for (const [link, heading] of targets) {
      await nav.getByRole("link", { name: link, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(nav.getByRole("link", { name: link, exact: true })).toHaveAttribute("aria-current", "page");
    }
  });

  test("job detail keeps Job discovery active but not Add a job", async ({ page }) => {
    await page.goto("/jobs/job-003");
    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Job discovery" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "Add a job" })).not.toHaveAttribute("aria-current", "page");
  });
});

test.describe("mobile navigation", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile only");

  test("menu opens, navigates, and closes", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open navigation" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("link", { name: "Applications" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Applications" })).toBeVisible();
    await expect(dialog).toBeHidden();
  });

  test("menu closes with Escape and restores focus", async ({ page }) => {
    await page.goto("/");
    const trigger = page.getByRole("button", { name: "Open navigation" });
    await trigger.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
