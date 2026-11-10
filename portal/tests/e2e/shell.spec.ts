// The application shell: sidebar, top bar, skip link, and their keyboard behaviour.
import { expect, signIn, test, uniqueEmail } from "./support";

test.describe("on a wide screen", () => {
  test("the sidebar collapses to an icon rail and stays that way after a reload", async ({ page }) => {
    await signIn(page, uniqueEmail("sidebar"));
    const sidebar = page.getByRole("complementary", { name: "Sidebar" });
    const home = sidebar.getByRole("link", { name: "Home", exact: true });
    await expect(home).toBeVisible();
    const expandedWidth = (await sidebar.boundingBox())?.width ?? 0;

    const collapse = page.getByRole("button", { name: "Collapse sidebar" });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await collapse.click();

    const expand = page.getByRole("button", { name: "Expand sidebar" });
    await expect(expand).toHaveAttribute("aria-expanded", "false");
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(expandedWidth / 2);
    // The destination keeps its name when only its icon is shown.
    await expect(home).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();
  });

  test("the skip link is the first stop and moves focus to the page content", async ({ page }) => {
    await signIn(page, uniqueEmail("skip.link"));
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    await expect(page).toHaveURL(/#\/$/);
  });

  test("the account menu works from the keyboard", async ({ page }) => {
    const email = uniqueEmail("keyboard.menu");
    await signIn(page, email);
    const trigger = page.getByRole("button", { name: `Account: ${email}` });
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toContainText(email);
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("the landmarks are in place", async ({ page }) => {
    await signIn(page, uniqueEmail("landmarks"));
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Home");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  });
});

test.describe("on a narrow screen", () => {
  test.use({ viewport: { width: 390, height: 800 } });

  test("navigation opens over the page, holds focus, and closes with Escape", async ({ page }) => {
    await signIn(page, uniqueEmail("narrow.screen"));
    await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeHidden();

    const open = page.getByRole("button", { name: "Open navigation" });
    await open.click();
    const panel = page.getByRole("dialog", { name: "Navigation" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");

    // Focus stays inside the panel however far Tab is pressed.
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press("Tab");
      expect(await panel.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(open).toBeFocused();

    // Choosing a destination closes the panel.
    await open.click();
    await page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Home", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Navigation" })).toBeHidden();
  });
});
