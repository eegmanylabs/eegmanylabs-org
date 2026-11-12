// Every interface primitive, checked in a real browser on the page that emulator builds carry
// for this purpose (web/src/pages/dev/ComponentsPage.tsx). Several of the primitives are not
// used by any page of the portal yet. They are checked here before the first page relies on them.
import AxeBuilder from "@axe-core/playwright";
import { elementsWithBoxShadow, expect, test } from "./support";

const PAGE = "./#/dev/components";

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.getByRole("heading", { level: 1, name: "Interface components" })).toBeVisible();
});

test("no primitive has a box shadow or an accessibility finding, in any of its states", async ({ page }) => {
  const findings = async () =>
    (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()
    ).violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  const check = async (state: string) => {
    expect(await elementsWithBoxShadow(page), `box shadows: ${state}`).toEqual([]);
    expect(await findings(), `accessibility: ${state}`).toEqual([]);
  };

  await check("at rest");

  // A field with an error.
  await page.getByLabel("Note").fill("This note is longer than twenty characters.");
  await expect(page.getByLabel("Note")).toHaveAttribute("aria-invalid", "true");
  await check("a field with an error");

  // The second tab.
  await page.getByRole("tab", { name: "People" }).click();
  await expect(page.getByRole("tabpanel")).toHaveText("The people panel.");
  await check("the second tab");

  // A focused control with its tooltip.
  await page.getByRole("button", { name: "Add one" }).focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await check("a tooltip");

  // Both kinds of notification.
  await page.getByRole("button", { name: "Show a notification" }).click();
  await page.getByRole("button", { name: "Show a failure notification" }).click();
  await expect(page.getByText("It failed again.", { exact: true })).toBeVisible();
  await check("notifications");

  // The dialog.
  await page.getByRole("button", { name: "Open the dialog" }).click();
  await expect(page.getByRole("dialog", { name: "Sample dialog" })).toBeVisible();
  await check("the dialog");
});

test("buttons act on a press, by mouse and by keyboard, and a disabled button does not", async ({ page }) => {
  const count = page.getByTestId("press-count");
  await expect(count).toHaveText("Buttons pressed: 0");
  await page.getByRole("button", { name: "Primary action" }).click();
  await page.getByRole("button", { name: "Add one" }).click();
  await expect(count).toHaveText("Buttons pressed: 2");

  await page.getByRole("button", { name: "Quiet action" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await expect(count).toHaveText("Buttons pressed: 4");

  const disabled = page.getByRole("button", { name: "Unavailable action" });
  await expect(disabled).toBeDisabled();
  await disabled.click({ force: true });
  await expect(count).toHaveText("Buttons pressed: 4");
});

test("tabs move with the arrow keys and skip a disabled tab", async ({ page }) => {
  const overview = page.getByRole("tab", { name: "Overview" });
  const people = page.getByRole("tab", { name: "People" });
  await expect(overview).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveText("The overview panel.");

  await overview.focus();
  await page.keyboard.press("ArrowRight");
  await expect(people).toBeFocused();
  await expect(people).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toHaveText("The people panel.");

  // The disabled tab is passed over: the next press wraps round to the first tab.
  await page.keyboard.press("ArrowRight");
  await expect(overview).toBeFocused();
  await expect(page.getByRole("tab", { name: "Closed section" })).toBeDisabled();

  // The current tab carries the coral underline, the others none.
  await expect(overview).toHaveCSS("border-bottom-color", "rgb(216, 75, 77)");
  await expect(people).toHaveCSS("border-bottom-color", "rgba(0, 0, 0, 0)");
});

test("the dialog holds focus, closes with its buttons and with Escape, and gives focus back", async ({ page }) => {
  const open = page.getByRole("button", { name: "Open the dialog" });
  const dialog = page.getByRole("dialog", { name: "Sample dialog" });
  const count = page.getByTestId("press-count");

  await open.click();
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription("A dialog holds focus until it is closed.");
  // It is centred in the window and fits inside it.
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize() ?? { width: 0, height: 0 };
  expect(Math.abs((box?.x ?? 0) + (box?.width ?? 0) / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs((box?.y ?? 0) + (box?.height ?? 0) / 2 - viewport.height / 2)).toBeLessThanOrEqual(1);

  for (let press = 0; press < 5; press += 1) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }

  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
  await expect(count).toHaveText("Buttons pressed: 0");

  await open.click();
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(dialog).toBeHidden();
  await expect(count).toHaveText("Buttons pressed: 1");

  await open.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(open).toBeFocused();
});

test("the dialog fits a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.getByRole("button", { name: "Open the dialog" }).click();
  const box = await page.getByRole("dialog", { name: "Sample dialog" }).boundingBox();
  expect(box?.x).toBe(16);
  expect(box?.width).toBe(390 - 32);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("the table is a named region that the keyboard can reach and scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const region = page.getByRole("region", { name: "Sample laboratories" });
  await expect(region.getByRole("columnheader")).toHaveText(["Name", "Country", "Status"]);
  await expect(region.getByRole("row")).toHaveCount(3);
  await region.focus();
  await expect(region).toBeFocused();
  await expect(region).toHaveCSS("outline-style", "solid");
  // The page itself never scrolls sideways: a wide table scrolls inside its own region.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("a region that scrolls sideways marks the edge beyond which more lies, and clears it at the end", async ({
  page,
}) => {
  const sample = page.getByTestId("sample-horizontal-scroll");
  await expect(sample.getByTestId("scroll-more-after")).toBeVisible();
  await expect(sample.getByTestId("scroll-more-before")).toHaveCount(0);
  await sample.locator("div.overflow-x-auto").evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect(sample.getByTestId("scroll-more-before")).toBeVisible();
  await expect(sample.getByTestId("scroll-more-after")).toHaveCount(0);
});

test("badges and states use the colours of the tokens", async ({ page }) => {
  const colours = async (text: string) =>
    page.getByText(text, { exact: true }).evaluate((element) => {
      const style = getComputedStyle(element);
      return [style.backgroundColor, style.color];
    });
  // Deep coral with a white label for the one solid badge. Tinted backgrounds for the others.
  expect(await colours("Most important state")).toEqual(["rgb(169, 53, 58)", "rgb(255, 255, 255)"]);
  expect(await colours("Needs attention")).toEqual(["rgb(249, 230, 232)", "rgb(159, 47, 55)"]);
  expect(await colours("Ordinary state")).toEqual(["rgb(243, 233, 231)", "rgb(106, 67, 74)"]);
  await expect(page.getByText("Nothing here yet", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Something could not be loaded." })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Loading the sample" })).toBeVisible();
});

test("the panel, the sortable column and the pages work by keyboard and have no accessibility finding", async ({
  page,
}) => {
  const findings = async () =>
    (
      await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze()
    ).violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => violation.id);

  // A sortable column says how it is sorted, and turns round on a press of Enter.
  const column = page.getByRole("columnheader", { name: "Name" });
  await expect(column).toHaveAttribute("aria-sort", "ascending");
  await column.getByRole("button").focus();
  await page.keyboard.press("Enter");
  await expect(column).toHaveAttribute("aria-sort", "descending");
  await expect(page.getByRole("cell").first()).toHaveText("Sample laboratory two");

  // Pages: the first has no previous page, and the next one says which rows it shows.
  const pages = page.getByRole("navigation", { name: "Pages of sample rows" });
  await expect(pages.getByRole("button", { name: "Previous" })).toBeDisabled();
  await pages.getByRole("button", { name: "Next" }).click();
  await expect(pages).toContainText("Showing 3 to 4 of 5 sample rows");

  // The panel takes focus when it opens and gives it back when Escape closes it.
  const trigger = page.getByRole("button", { name: "Open the panel" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "Sample panel" });
  await expect(panel).toBeVisible();
  expect(await elementsWithBoxShadow(page)).toEqual([]);
  expect(await findings()).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(trigger).toBeFocused();

  // The select and the longer text field are labelled.
  await expect(page.getByLabel("Choice")).toHaveValue("second");
  await expect(page.getByLabel("Longer text")).toBeEditable();
});
