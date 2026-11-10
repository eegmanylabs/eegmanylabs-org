// The application shell: sidebar, top bar, skip link, and their keyboard behaviour.
// Fixtures are synthetic: every address is invented and uses the example.org domain.
import { adminAuth, adminDb } from "../support/admin";
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

  test("the account menu is reached, opened, closed and used with the keyboard alone", async ({ page }) => {
    const email = uniqueEmail("keyboard.menu");
    await signIn(page, email);
    await page.reload();
    await expect(page.getByTestId("account-details")).toContainText(email);
    const trigger = page.getByRole("button", { name: `Account: ${email}` });

    // Tab alone leads to the menu: no script puts focus there.
    const isFocused = () => trigger.evaluate((element) => element === document.activeElement);
    let presses = 0;
    while (!(await isFocused())) {
      presses += 1;
      expect(presses, "Tab presses before the account button has focus").toBeLessThanOrEqual(12);
      await page.keyboard.press("Tab");
    }
    // Every stop on the way was visible as one: the focused element has an outline.
    await expect(trigger).toHaveCSS("outline-style", "solid");

    await page.keyboard.press("Enter");
    await expect(page.getByRole("menu")).toContainText(email);
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // Open it again and sign out, still without the mouse.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByText("You have signed out.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
  });

  test("the top bar spans the window and long account names get the room that is there", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // About forty characters: more than the button showed before it was given the room.
    const email = uniqueEmail("long.account.name");
    await signIn(page, email);
    const banner = await page.getByRole("banner").boundingBox();
    const sidebar = await page.getByRole("complementary", { name: "Sidebar" }).boundingBox();
    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    // No strip is reserved beside the content: the bar ends where the window ends.
    expect((banner?.x ?? 0) + (banner?.width ?? 0)).toBe(viewportWidth);
    expect(banner?.x).toBe(sidebar?.width);

    // The whole address fits in the button on a wide screen.
    const label = page.getByRole("button", { name: `Account: ${email}` }).locator("span");
    expect(await label.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
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

  test("the scrim of the navigation panel dims the whole window", async ({ page }) => {
    await signIn(page, uniqueEmail("narrow.scrim"));
    await page.getByRole("button", { name: "Open navigation" }).click();
    const panel = page.getByRole("dialog", { name: "Navigation" });
    await expect(panel).toBeVisible();
    // The right edge of the window, beside the panel, belongs to the scrim and not to the page.
    const covered = await page.evaluate(() => {
      const edge = document.elementFromPoint(window.innerWidth - 2, window.innerHeight / 2);
      return edge ? getComputedStyle(edge).position : null;
    });
    expect(covered).toBe("fixed");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  test("the account menu and the notification stay inside the window with a long address", async ({ page }) => {
    const email = uniqueEmail("an.exceptionally.long.address.that.would.not.fit.on.one.line.of.a.phone");
    await signIn(page, email);
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };

    await page.getByRole("button", { name: `Account: ${email}` }).click();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const menuBox = await menu.boundingBox();
    // The page margin of 16px on both sides, and the whole address readable inside the menu.
    expect(menuBox?.x).toBeGreaterThanOrEqual(16);
    expect((menuBox?.x ?? 0) + (menuBox?.width ?? 0)).toBeLessThanOrEqual(viewport.width - 16);
    const address = menu.getByText(email);
    await expect(address).toBeVisible();
    expect(await address.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const addressBox = await address.boundingBox();
    expect((addressBox?.x ?? 0) + (addressBox?.width ?? 0)).toBeLessThanOrEqual(
      (menuBox?.x ?? 0) + (menuBox?.width ?? 0),
    );

    // The notification after signing out has the same margin on both sides.
    await page.getByRole("menuitem", { name: "Sign out" }).click();
    const toast = page.getByRole("listitem").filter({ hasText: "You have signed out." });
    await expect(toast).toBeVisible();
    const toastBox = await toast.boundingBox();
    expect(toastBox?.x).toBe(16);
    expect((toastBox?.x ?? 0) + (toastBox?.width ?? 0)).toBe(viewport.width - 16);
  });

  test("the demonstration label wraps under the address without an indent", async ({ page }) => {
    const email = uniqueEmail("demonstration.account.with.a.long.address.for.a.phone");
    await signIn(page, email);
    const details = page.getByTestId("account-details");
    await expect(details).toContainText(email);
    const { uid } = await adminAuth.getUserByEmail(email);
    await adminDb.doc(`users/${uid}`).update({ dataOrigin: "demo" });

    const label = details.getByText("Demonstration data");
    await expect(label).toBeVisible();
    const addressBox = await details.getByText(email).boundingBox();
    const labelBox = await label.boundingBox();
    // On this width the label is on a line of its own, and starts where the address starts.
    expect(labelBox?.y).toBeGreaterThan(addressBox?.y ?? 0);
    expect(labelBox?.x).toBe(addressBox?.x);
  });
});

test.describe("on a touch screen", () => {
  test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

  test("the controls of the shell are large enough for a finger", async ({ page }) => {
    await signIn(page, uniqueEmail("touch.screen"));
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);

    const sizeOf = async (name: string | RegExp, role: "button" | "link" | "menuitem" = "button") => {
      const box = await page.getByRole(role, { name }).first().boundingBox();
      return { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
    };
    const atLeast44 = { width: expect.any(Number), height: expect.any(Number) };
    for (const name of ["Open navigation", /^Account:/]) {
      const size = await sizeOf(name);
      expect(size, String(name)).toEqual(atLeast44);
      expect(size.width, String(name)).toBeGreaterThanOrEqual(44);
      expect(size.height, String(name)).toBeGreaterThanOrEqual(44);
    }

    await page.getByRole("button", { name: "Open navigation" }).tap();
    const panel = page.getByRole("dialog", { name: "Navigation" });
    await expect(panel).toBeVisible();
    for (const [role, name] of [
      ["button", "Close"],
      ["link", "Home"],
    ] as const) {
      const box = await panel.getByRole(role, { name, exact: true }).boundingBox();
      expect(box?.height, name).toBeGreaterThanOrEqual(44);
      expect(box?.width, name).toBeGreaterThanOrEqual(44);
    }
    await panel.getByRole("button", { name: "Close" }).tap();

    await page.getByRole("button", { name: /^Account:/ }).tap();
    expect((await sizeOf("Sign out", "menuitem")).height).toBeGreaterThanOrEqual(44);
    await page.getByRole("menuitem", { name: "Sign out" }).tap();

    // The notification's dismiss button: at least 44px to hit, without making the notification taller.
    const dismiss = page.getByRole("button", { name: "Dismiss" });
    await expect(dismiss).toBeVisible();
    const dismissBox = await dismiss.boundingBox();
    expect(dismissBox?.width).toBeGreaterThanOrEqual(44);
    expect(dismissBox?.height).toBeGreaterThanOrEqual(44);
    await dismiss.tap();
    await expect(page.getByText("You have signed out.", { exact: true })).toHaveCount(0);
  });
});
