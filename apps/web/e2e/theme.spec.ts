import { expect, test } from "@playwright/test";
import { isDark, themeToggle } from "./helpers";

async function chooseTheme(page: import("@playwright/test").Page, label: "Light" | "Dark" | "System") {
  await themeToggle(page).click();
  await page.getByRole("menuitemradio", { name: label }).click();
  // Wait for the menu's exit animation so the next interaction starts clean.
  await expect(page.getByRole("menu")).toBeHidden();
}

test.describe("theme", () => {
  test("system mode follows the OS preference, including live changes", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    expect(await isDark(page)).toBe(true);

    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => isDark(page)).toBe(false);
  });

  test("explicit dark and light override the OS and persist across reloads", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/settings");

    await chooseTheme(page, "Dark");
    expect(await isDark(page)).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("prorez-theme"))).toBe("dark");
    await page.reload();
    expect(await isDark(page)).toBe(true);

    await page.emulateMedia({ colorScheme: "dark" });
    await chooseTheme(page, "Light");
    expect(await isDark(page)).toBe(false);
    await page.reload();
    expect(await isDark(page)).toBe(false);

    await chooseTheme(page, "System");
    expect(await isDark(page)).toBe(true);
  });

  test("the selected option is reflected in the menu", async ({ page }) => {
    await page.goto("/");
    await chooseTheme(page, "Dark");
    await themeToggle(page).click();
    await expect(page.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
  });

  test("saved theme is applied before first paint (no flash)", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("prorez-theme", "dark");
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { __darkAtDcl: boolean }).__darkAtDcl =
          document.documentElement.classList.contains("dark");
      });
    });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/jobs");
    expect(await page.evaluate(() => (window as unknown as { __darkAtDcl: boolean }).__darkAtDcl)).toBe(true);
  });

  test("theme persists across client-side navigation", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await chooseTheme(page, "Dark");
    await page.goto("/projects");
    expect(await isDark(page)).toBe(true);
  });
});
