import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { DB_MODE, resetE2EDatabase } from "./db-reset";

/**
 * Manual board synchronization (Milestone 3A). Database mode only; provider
 * responses come from e2e/fixtures/ats (no live API calls).
 */
test.describe("employer board sync", () => {
  test.skip(!DB_MODE, "Requires database mode (npm run test:e2e:db)");
  test.skip(({ isMobile }) => isMobile, "Mutating flows run once, on desktop");
  test.beforeEach(() => resetE2EDatabase());

  test("syncs a board, imports Canadian entry-level postings, and is idempotent", async ({ page }) => {
    await page.goto("/boards");
    await page.getByRole("button", { name: "Sync Northlight Robotics Greenhouse board now" }).click();
    const notice = page.getByRole("main").getByRole("status");
    await expect(notice).toContainText("Synced Northlight Robotics: 3 published, 1 new, 0 changed, 0 unchanged, 0 reactivated, 0 missing, 0 inactivated, 2 skipped");

    const history = page.getByRole("list", { name: "Sync history" });
    await expect(history).toContainText("Northlight Robotics (Greenhouse)");
    await history.getByText(/Skipped, warning and error details/).click();
    await expect(history).toContainText("Senior or leadership role");
    await expect(history).toContainText("Remote without stating that Canada is eligible");

    await page.getByRole("button", { name: "Sync Northlight Robotics Greenhouse board now" }).click();
    await expect(notice).toContainText("0 new, 0 changed, 1 unchanged");

    await page.goto("/jobs?q=Robotics+Software+Developer");
    await page.getByRole("link", { name: /Robotics Software Developer Co-op/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Robotics Software Developer Co-op (Summer 2027)");
    const sightings = page.getByRole("list", { name: "Job sightings" });
    await expect(sightings).toContainText("Greenhouse · Northlight Robotics");
    await expect(sightings).toContainText("7100001");
    await expect(sightings).toContainText("(last updated)");
    await expect(sightings).toContainText("Discovery latency: Not available");
    await expect(page.getByText("FICTIONAL recorded response", { exact: false })).toBeVisible();
  });

  test("shows provider errors and keeps the board retryable", async ({ page }) => {
    await page.goto("/boards");
    await page.getByRole("button", { name: "Sync Maplewave Analytics Lever board now" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("rate-limiting");
    await expect(page.getByRole("row").filter({ hasText: "Maplewave Analytics" })).toContainText("1 failure");
    await expect(page.getByRole("button", { name: "Sync Maplewave Analytics Lever board now" })).toBeEnabled();
  });

  // Regression: the full acceptance path for a board the user registers
  // themselves (register -> reload -> pause/resume -> Sync now -> imported job).
  test("a newly registered board persists across reload and can be synced", async ({ page }) => {
    await page.goto("/boards");
    await page.getByLabel("Board URL").fill("https://job-boards.greenhouse.io/prorez-demo-harbourline");
    await page.getByRole("button", { name: "Fill from URL" }).click();
    await page.getByLabel("Employer name").fill("Harbourline");
    await page.getByRole("button", { name: "Register board" }).click();
    await expect(page.getByText("Registered Harbourline (Greenhouse).")).toBeVisible();

    await page.reload();
    const toggle = page.getByRole("switch", { name: "Harbourline Greenhouse enabled" });
    const syncNow = page.getByRole("button", { name: "Sync Harbourline Greenhouse board now" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(syncNow).toBeDisabled();
    await toggle.click();
    await expect(syncNow).toBeEnabled();

    await page.reload();
    await syncNow.click();
    await expect(page.getByRole("main").getByRole("status")).toContainText("Synced Harbourline: 3 published, 1 new");
    await expect(page.getByRole("list", { name: "Sync history" })).toContainText("Harbourline (Greenhouse)");
  });

  // Milestone 3B: the background worker syncs a newly registered board with no click.
  test("the background worker syncs a newly registered board automatically", async ({ page }) => {
    await page.goto("/boards");
    await page.getByLabel("Board URL").fill("https://job-boards.greenhouse.io/prorez-demo-harbourline");
    await page.getByRole("button", { name: "Fill from URL" }).click();
    await page.getByLabel("Employer name").fill("Harbourline");
    await page.getByRole("button", { name: "Register board" }).click();
    await expect(page.getByText("Registered Harbourline (Greenhouse).")).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: "Harbourline" });
    await expect(row).toContainText("Scheduled");
    await expect(row).toContainText("Never synced");

    // Exactly what `npm run worker -- --once` does, against the isolated e2e database.
    const appRoot = path.resolve(__dirname, "..");
    const output = execFileSync(path.join(appRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"), ["scripts/sync-worker.ts", "--once"], {
      cwd: appRoot,
      env: {
        ...process.env,
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
        PROREZ_DATA_SOURCE: "database",
        PROREZ_ATS_TRANSPORT: "fixtures",
      },
      encoding: "utf8",
    });
    expect(output).toMatch(/sync_finished .*employer=Harbourline .*status=succeeded .*new=1/);
    expect(output).toMatch(/worker_once_done synced=1/); // demo boards are never scheduled

    await page.reload();
    await expect(row).toContainText("Automatic");
    await expect(row).toContainText("Succeeded");
    await expect(row).toContainText("Active jobs: 1");
    await expect(row.getByText(/^Next sync:/)).not.toContainText("paused");
    const history = page.getByRole("list", { name: "Sync history" });
    await expect(history).toContainText("Harbourline (Greenhouse)");
    await expect(history).toContainText("Automatic");
  });

  test("disabled boards cannot be synced", async ({ page }) => {
    await page.goto("/boards");
    await expect(page.getByRole("button", { name: "Sync Glacier Labs Ashby board now" })).toBeDisabled();
  });
});

test.describe("board sync in read-only mode", () => {
  test.skip(DB_MODE, "Fixture mode only");
  test("offers no sync controls", async ({ page }) => {
    await page.goto("/boards");
    await expect(page.getByRole("button", { name: /Sync .* now/ })).toHaveCount(0);
  });

  test("registration is disabled with the configuration reason, not a 'Soon' badge", async ({ page }) => {
    await page.goto("/boards");
    const register = page.getByRole("button", { name: /^Register board/ });
    await expect(register).toBeDisabled();
    await expect(register).toHaveAccessibleName(/read-only/i);
    await expect(register).not.toContainText(/soon/i);
  });
});
