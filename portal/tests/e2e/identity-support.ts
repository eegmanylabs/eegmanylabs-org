// Helpers of the browser tests of identity, claiming and administration. They use the synthetic
// world of `seed:demo` (tools/src/fixtures/), whose people are invented and whose addresses use
// the example.org domain.
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect, seriousFindings, signIn } from "./support";

/** The administrator of the demonstration world: the bootstrap record makes the account one. */
export const ADMIN_EMAIL = "demo.admin@example.org";

/**
 * Where the screenshots for the reviewers go. Set PORTAL_REVIEW_SCREENSHOTS to a directory to
 * take them. Without it no screenshot is taken, so the suite leaves nothing behind.
 */
const SCREENSHOTS = process.env.PORTAL_REVIEW_SCREENSHOTS;

const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "390x844", width: 390, height: 844 },
] as const;

/**
 * Checks a page with axe-core at a wide and a narrow viewport, checks that the page itself
 * never scrolls sideways there (a wide table scrolls inside its own region), and takes its
 * screenshots when they are asked for. The viewport is restored afterwards.
 */
export async function reviewPage(page: Page, name: string): Promise<void> {
  const original = page.viewportSize();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    expect(await seriousFindings(page), `${name} at ${viewport.label}`).toEqual([]);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
        message: `${name} scrolls sideways at ${viewport.label}`,
      })
      .toBeLessThanOrEqual(0);
    if (SCREENSHOTS !== undefined) {
      mkdirSync(SCREENSHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SCREENSHOTS, `${name}-${viewport.label}.png`), fullPage: true });
    }
  }
  if (original !== null) await page.setViewportSize(original);
}

/** A second browser, as another person would use, signed in with the given address. */
export async function personInAnotherBrowser(
  browser: Browser,
  baseURL: string,
  email: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await signIn(page, email);
  return { context, page };
}

/** Signs the demonstration administrator in, in a browser of its own, and waits until the console is open to it. */
export async function administratorBrowser(browser: Browser, baseURL: string) {
  const admin = await personInAnotherBrowser(browser, baseURL, ADMIN_EMAIL);
  // A first sign-in links the administrator to the profile that carries the address.
  await expect(
    admin.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit log" }),
  ).toBeVisible();
  return admin;
}

/** The outcome section of the claim page. */
export const claimOutcome = (page: Page) => page.getByTestId("claim-outcome");
