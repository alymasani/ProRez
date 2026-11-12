import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { DB_MODE, resetE2EDatabase } from "./db-reset";

/**
 * Milestone 3C discovery, end to end on the isolated e2e database:
 * Common Crawl import → discovery run (recorded ATS + website responses, no
 * network) → auto-registration with ownership evidence → manual review in the UI.
 */
const appRoot = path.resolve(__dirname, "..");
function discovery(...args: string[]) {
  return execFileSync(path.join(appRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx"), ["scripts/discovery.ts", ...args], {
    cwd: appRoot,
    env: {
      ...process.env,
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? "",
      PROREZ_DATA_SOURCE: "database",
      PROREZ_ATS_TRANSPORT: "fixtures",
      PROREZ_DISCOVERY_SITE_FIXTURES: path.join(appRoot, "e2e", "fixtures", "discovery", "sites"),
      BRAVE_SEARCH_API_KEY: "",
    },
    encoding: "utf8",
  });
}

test.describe("board discovery (database mode)", () => {
  test.skip(!DB_MODE, "Requires database mode (npm run test:e2e:db)");
  test.skip(({ isMobile }) => isMobile, "Mutating flows run once, on desktop");
  test.beforeEach(() => resetE2EDatabase());
  test.afterEach(() => resetE2EDatabase());

  test("imports, verifies, auto-registers with evidence, and supports manual review", async ({ page }) => {
    const imported = discovery("import", "e2e/fixtures/discovery/import.jsonl");
    expect(imported).toMatch(/"newCandidates": 2/);

    await page.goto("/boards");
    const panel = page.getByRole("region", { name: "Board discovery" }).or(page.locator("[aria-labelledby=discovery-title]"));
    const candidates = page.getByRole("list", { name: "Discovery candidates" });
    await expect(candidates.getByText("Queued")).toHaveCount(2);

    const run = discovery("run");
    expect(run).toMatch(/"registered": 1/);
    expect(run).toMatch(/"pendingReview": 1/);

    await page.reload();
    // The verified board is registered, marked as discovered, and scheduled by the 3B worker rules.
    const boardRow = page.getByRole("row").filter({ hasText: "Harbourline" });
    await expect(boardRow).toContainText("Discovered");
    await expect(boardRow).toContainText("Scheduled");
    await expect(boardRow).toContainText("Verified site: harbourline-prorez-fixture.ca");
    await expect(boardRow.getByRole("button", { name: "Sync Harbourline Greenhouse board now" })).toBeEnabled();

    // The unverified board waits for review, with its evidence visible.
    await expect(panel).toContainText("Needs review");
    // Direct children only: evidence entries are nested list items.
    const row = (text: string) => candidates.locator(":scope > li").filter({ hasText: text });
    const aurora = row("prorez-demo-aurora");
    await expect(aurora).toContainText("Needs review");
    await aurora.getByText(/^Evidence \(/).click();
    await expect(aurora.getByRole("list", { name: /Evidence for/ })).toContainText("Provider API · validated");
    await expect(aurora.getByRole("list", { name: /Evidence for/ })).toContainText("Common Crawl · unvalidated");

    await page.getByRole("button", { name: "All (2)" }).click();
    const harbour = row("Harbourline");
    await expect(harbour).toContainText("Registered");
    await harbour.getByText(/^Evidence \(/).click();
    await expect(harbour).toContainText("Company website link · validated");

    // Approve the pending candidate (re-validated against the provider on approval).
    await page.getByRole("button", { name: /Needs attention/ }).click();
    await aurora.getByLabel(/Employer name for/).fill("Aurora Lattice");
    await aurora.getByRole("button", { name: /^Approve/ }).click();
    await expect(page.getByRole("status").filter({ hasText: "Registered Aurora Lattice" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("row").filter({ hasText: "Aurora Lattice" })).toContainText("Discovered");

    // Asking for a run records the request for the worker.
    await page.getByRole("button", { name: "Run discovery now" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Discovery requested" })).toBeVisible();
  });
});

test.describe("board discovery (fixture mode)", () => {
  test.skip(DB_MODE, "Fixture mode only");
  test("is not shown for demo data", async ({ page }) => {
    await page.goto("/boards");
    await expect(page.getByRole("heading", { name: "Employer boards", level: 1 })).toBeVisible();
    await expect(page.getByText("Board discovery")).toHaveCount(0);
  });
});
