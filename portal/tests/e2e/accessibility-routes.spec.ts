// Every destination of the navigation registry (web/src/app/navigation.ts), checked at 360, 768
// and 1440 pixels wide for the account that the registry shows it to: an account that is not
// linked yet, a member and a programme administrator (R18.9, WCAG 2.2 AA where practicable).
// Each page is checked with axe-core against every WCAG 2.0, 2.1 and 2.2 rule at levels A and AA,
// whatever the impact of a finding, which includes the size of targets (2.5.8); for reflow (1.4.10),
// with no sideways scroll of the page; and with the keyboard: the skip link comes first and moves
// the focus to the content, and every element that Tab reaches is in view, not covered, and
// drawn with a visible outline; the size of targets is axe's rule for 2.5.8, which allows for spacing. A destination added to the registry is
// checked here without a change to this file, and the last test fails if one is left out.
// Everyone here is invented, and every address uses the example.org domain.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { NAVIGATION, type NavigationEntry } from "../../web/src/app/navigation";
import { administratorBrowser } from "./identity-support";
import { signInAsIvy } from "./registry-support";
import { expect, signIn, test, uniqueEmail } from "./support";

const WIDTHS = [360, 768, 1440] as const;
/** How many stops of the Tab key are followed on each page. */
const TAB_STOPS = 30;

type Persona = "unlinked" | "member" | "administrator";

/** The destinations each kind of account is checked on: those the registry shows it. */
const DESTINATIONS: Readonly<Record<Persona, readonly NavigationEntry[]>> = {
  unlinked: NAVIGATION.filter((entry) => entry.requires === "portal.use" && entry.audience !== "linked"),
  member: NAVIGATION.filter((entry) => entry.group === "main" && entry.audience !== "unlinked"),
  administrator: NAVIGATION.filter((entry) => entry.group === "administration"),
};

/** Every finding of axe against WCAG 2.2 at levels A and AA, whatever its impact. */
async function wcagFindings(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help} at ${violation.nodes
        .slice(0, 5)
        .map((node) => node.target.join(" "))
        .join(", ")}`,
  );
}

/** Opens a destination and waits until its heading is shown and nothing on it is still loading. */
async function open(page: Page, entry: NavigationEntry): Promise<void> {
  await page.goto(`./#${entry.to}`);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 }).first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () =>
        page
          .getByRole("main")
          .getByRole("status")
          .filter({ hasText: /^Loading/ })
          .count(),
      { timeout: 30_000 },
    )
    .toBe(0);
}

/**
 * What the keyboard finds wrong on a destination: the skip link, and each Tab stop that is hidden,
 * covered or unmarked. The page is loaded afresh first, so that the keyboard starts at its top.
 */
async function keyboardFindings(page: Page, entry: NavigationEntry): Promise<string[]> {
  const findings: string[] = [];
  await page.reload();
  await open(page, entry);
  await page.keyboard.press("Tab");
  const first = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  if (first !== "Skip to content") return [`the first Tab stop is "${first.slice(0, 40)}", not the skip link`];
  await page.keyboard.press("Enter");
  const inMain = await page.evaluate(() => document.activeElement?.closest("main") !== null);
  if (!inMain) findings.push("the skip link does not move the focus to the content");
  for (let stop = 0; stop < TAB_STOPS; stop += 1) {
    await page.keyboard.press("Tab");
    const problem = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (element === null || element === document.body) return null;
      const label = (element.getAttribute("aria-label") ?? element.textContent ?? "").trim().slice(0, 40);
      const name = `${element.tagName.toLowerCase()} "${label}"`;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return `${name} takes the focus but is not shown`;
      if (box.bottom < 0 || box.top > window.innerHeight || box.right < 0 || box.left > window.innerWidth) {
        return `${name} takes the focus outside the window`;
      }
      // Focus not obscured (2.4.11): nothing fixed or sticky may cover the element that has the focus.
      // The part of the element that is shown: its box within the window and within each
      // ancestor that clips it, such as a table that scrolls sideways.
      let left = Math.max(box.left, 0);
      let right = Math.min(box.right, window.innerWidth);
      let top = Math.max(box.top, 0);
      let bottom = Math.min(box.bottom, window.innerHeight);
      for (let parent = element.parentElement; parent !== null; parent = parent.parentElement) {
        const overflow = getComputedStyle(parent);
        if (overflow.overflowX === "visible" && overflow.overflowY === "visible") continue;
        const clip = parent.getBoundingClientRect();
        left = Math.max(left, clip.left);
        right = Math.min(right, clip.right);
        top = Math.max(top, clip.top);
        bottom = Math.min(bottom, clip.bottom);
      }
      if (right <= left || bottom <= top) return `${name} takes the focus where it cannot be seen`;
      const probeX = (left + right) / 2;
      const probeY = (top + bottom) / 2;
      const above = document.elementFromPoint(probeX, probeY);
      if (above !== null && above !== element && !element.contains(above) && !above.contains(element)) {
        const position = getComputedStyle(above).position;
        if (position === "fixed" || position === "sticky") return `${name} is covered while it has the focus`;
      }
      // Focus visible (2.4.7): the portal draws the focus as an outline.
      const style = getComputedStyle(element);
      if (style.outlineStyle === "none" || Number.parseFloat(style.outlineWidth) < 1) {
        return `${name} shows no outline when it has the focus`;
      }
      return null;
    });
    if (problem !== null) findings.push(problem);
  }
  return [...new Set(findings)];
}

/** Checks every destination of a persona at every width, and returns what was found, page by page. */
async function sweep(page: Page, persona: Persona): Promise<string[]> {
  const found: string[] = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const entry of DESTINATIONS[persona]) {
      await open(page, entry);
      const where = `${entry.to} at ${width}px`;
      for (const finding of await wcagFindings(page)) found.push(`${where}: ${finding}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 0) found.push(`${where}: the page scrolls sideways by ${overflow}px`);
      for (const finding of await keyboardFindings(page, entry)) found.push(`${where}: ${finding}`);
    }
  }
  return found;
}

test.describe("every destination of the navigation registry", () => {
  test.describe.configure({ timeout: 900_000 });

  test("is accessible to an account that is not linked yet", async ({ page }) => {
    await signIn(page, uniqueEmail("axe.registry.unlinked"));
    expect(await sweep(page, "unlinked")).toEqual([]);
  });

  test("is accessible to a member", async ({ page }) => {
    await signInAsIvy(page);
    expect(await sweep(page, "member")).toEqual([]);
  });

  test("is accessible to a programme administrator", async ({ browser, baseURL }) => {
    const admin = await administratorBrowser(browser, baseURL as string);
    try {
      expect(await sweep(admin.page, "administrator")).toEqual([]);
    } finally {
      await admin.context.close();
    }
  });

  test("leaves no destination of the registry unchecked", () => {
    const checked = new Set(Object.values(DESTINATIONS).flatMap((entries) => entries.map((entry) => entry.id)));
    expect(NAVIGATION.filter((entry) => !checked.has(entry.id)).map((entry) => entry.id)).toEqual([]);
  });
});
