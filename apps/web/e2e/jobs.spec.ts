import { expect, test, type Page } from "@playwright/test";

const count = (page: Page) => page.getByText(/\d+ of 18 postings/);
const search = (page: Page) => page.getByRole("searchbox", { name: "Search jobs" });
const results = (page: Page) => page.getByRole("region", { name: "Job results" }).getByRole("listitem");

/** Opens the filter panel on mobile; desktop shows it inline. */
async function filters(page: Page, isMobile: boolean) {
  if (isMobile) {
    await page.getByRole("button", { name: /^Filters/ }).click();
    return page.getByRole("dialog");
  }
  return page.getByRole("complementary", { name: "Job filters" });
}

test.describe("job discovery", () => {
  test("search narrows results and is written to the URL", async ({ page }) => {
    await page.goto("/jobs");
    await expect(count(page)).toHaveText("16 of 18 postings");
    await search(page).fill("montreal");
    await expect(page).toHaveURL(/[?&]q=montreal/);
    await expect(count(page)).toHaveText("3 of 18 postings");
    await expect(results(page).first()).toContainText(/Montréal/);
  });

  test("filters apply, combine, and can be reset", async ({ page, isMobile }) => {
    await page.goto("/jobs");
    let panel = await filters(page, isMobile);
    await panel.getByRole("checkbox", { name: "Co-op" }).click();
    await expect(page).toHaveURL(/type=co_op/);
    await panel.getByRole("checkbox", { name: "Remote" }).click();
    await expect(page).toHaveURL(/arrangement=remote/);
    if (isMobile) await page.keyboard.press("Escape");
    await expect(count(page)).toHaveText("1 of 18 postings");
    await expect(results(page)).toContainText(["Brightwater Learning"]);

    panel = await filters(page, isMobile);
    await panel.getByRole("checkbox", { name: "Show dismissed & expired" }).click();
    if (isMobile) await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Reset search & filters" }).first().click();
    await expect(page).toHaveURL(/\/jobs$/);
    await expect(count(page)).toHaveText("16 of 18 postings");
  });

  test("shows an empty state when nothing matches", async ({ page }) => {
    await page.goto("/jobs?q=zzzz-no-such-job");
    await expect(page.getByText("No jobs match these filters")).toBeVisible();
    await page.getByRole("button", { name: "Reset search & filters" }).last().click();
    await expect(count(page)).toHaveText("16 of 18 postings");
    await expect(search(page)).toHaveValue("");
  });

  test("sorting by fit puts the highest score first", async ({ page }) => {
    await page.goto("/jobs");
    await page.getByLabel("Sort jobs").selectOption("fit");
    await expect(page).toHaveURL(/sort=fit/);
    await expect(results(page).first()).toContainText("Tidewater Fintech");
  });

  test("filter state loads from a shared URL", async ({ page, isMobile }) => {
    await page.goto("/jobs?province=BC&type=new_grad");
    await expect(count(page)).toHaveText("1 of 18 postings");
    const panel = await filters(page, isMobile);
    await expect(panel.getByRole("checkbox", { name: "British Columbia" })).toBeChecked();
  });

  test("clicking a job opens its detail page with inactive actions", async ({ page }) => {
    await page.goto("/jobs");
    await results(page).filter({ hasText: "Tidewater Fintech" }).getByRole("link").click();
    await expect(page.getByRole("heading", { level: 1, name: "Backend Developer Co-op" })).toBeVisible();
    for (const name of ["Full Build", "Quick Apply", "Skip"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^${name}`) }).first()).toBeDisabled();
    }
  });

  // Regression: the search box did not follow browser back/forward or external URL changes.
  test.describe("search box stays in sync with the URL", () => {
    test("back and forward update the search box", async ({ page }) => {
      await page.goto("/jobs?q=toronto");
      await expect(search(page)).toHaveValue("toronto");

      await page.goto("/jobs?q=halifax");
      await expect(search(page)).toHaveValue("halifax");

      await page.goBack();
      await expect(page).toHaveURL(/q=toronto/);
      await expect(search(page)).toHaveValue("toronto");
      await expect(count(page)).toHaveText("4 of 18 postings");

      await page.goForward();
      await expect(search(page)).toHaveValue("halifax");
    });

    test("client-side navigation to a clean URL clears the box, and back restores it", async ({ page, isMobile }) => {
      await page.goto("/jobs");
      await search(page).fill("toronto");
      await expect(page).toHaveURL(/q=toronto/);
      await expect(count(page)).toHaveText("4 of 18 postings");

      // Navigate within the app to /jobs with no query.
      await page.getByRole("link", { name: "Add a job" }).filter({ visible: true }).first().click();
      await expect(page).toHaveURL(/\/jobs\/new$/);
      if (isMobile) {
        await page.getByRole("button", { name: "Open navigation" }).click();
        await page.getByRole("dialog").getByRole("link", { name: "Job discovery" }).click();
      } else {
        await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Job discovery" }).click();
      }
      await expect(page).toHaveURL(/\/jobs$/);
      await expect(search(page)).toHaveValue("");
      await expect(count(page)).toHaveText("16 of 18 postings");

      await page.goBack(); // /jobs/new
      await page.goBack(); // /jobs?q=toronto
      await expect(page).toHaveURL(/q=toronto/);
      await expect(search(page)).toHaveValue("toronto");
      await expect(count(page)).toHaveText("4 of 18 postings");
    });

    test("a pending debounced search does not override back navigation", async ({ page }) => {
      await page.goto("/jobs?q=toronto");
      await page.goto("/jobs?q=halifax");
      await search(page).pressSequentially("xyz", { delay: 10 }); // debounce still pending
      await page.goBack();
      await expect(page).toHaveURL(/q=toronto/);
      await expect(search(page)).toHaveValue("toronto");
      // Wait past the debounce window and confirm the URL was not overwritten.
      await page.waitForTimeout(600);
      await expect(page).toHaveURL(/q=toronto/);
      await expect(search(page)).toHaveValue("toronto");
    });
  });
});

// Regression: the filter panel is rendered twice (sidebar + sheet) and used a fixed id,
// so on mobile the sheet's "Show dismissed & expired" checkbox had no accessible name.
test("the include-inactive filter is labelled and works in the visible panel", async ({ page, isMobile }) => {
  await page.goto("/jobs");
  const panel = await filters(page, isMobile);
  const checkbox = panel.getByRole("checkbox", { name: "Show dismissed & expired" });
  await panel.getByText("Show dismissed & expired").click(); // clicking the label toggles the visible box
  await expect(checkbox).toBeChecked();
  await expect(page).toHaveURL(/inactive=1/);
  if (isMobile) await page.keyboard.press("Escape");
  await expect(count(page)).toHaveText("18 of 18 postings");
});
