// Global search, the command palette, favourites and recent items in the browser, against the
// synthetic world of `seed:demo`. Everyone here is invented, and every address uses the
// example.org domain.
import { reviewPage } from "./identity-support";
import { ALPHA, BEN, signInAsIvy } from "./registry-support";
import { expect, seriousFindings, test } from "./support";

test("the command palette is used by keyboard alone: records, recent items, destinations and page actions", async ({
  page,
}) => {
  await signInAsIvy(page);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  // Control and K opens it, with the focus in the search field.
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search the portal" });
  const combobox = dialog.getByRole("combobox", { name: "Search replications, members and pages" });
  await expect(combobox).toBeFocused();
  await expect(combobox).toHaveAttribute("aria-expanded", "true");
  expect(await seriousFindings(page)).toEqual([]);

  // Another spelling of a study identifier finds the replication; Enter opens it.
  await page.keyboard.type("demoalpha");
  const results = dialog.getByRole("listbox", { name: "Results" });
  await expect(results.getByRole("group", { name: "Replications" }).getByRole("option")).toHaveText([/DemoAlpha2001/]);
  const activeId = await combobox.getAttribute("aria-activedescendant");
  expect(activeId).not.toBeNull();
  await expect(page.locator(`[id="${activeId}"]`)).toHaveAttribute("aria-selected", "true");
  await reviewPage(page, "command-palette");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: ALPHA })).toBeVisible();

  // A member by name and affiliation, grouped apart, with the arrow keys.
  await page.keyboard.press("Control+k");
  await page.keyboard.type("sample northfield");
  await expect(dialog.getByRole("group", { name: "Members" }).getByRole("option")).toHaveText([/Ben Sample/]);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: BEN.name })).toBeVisible();

  // With nothing typed, the recent items come first, latest first.
  await page.keyboard.press("Control+k");
  const recent = dialog.getByRole("group", { name: "Recent" }).getByRole("option");
  await expect(recent.first()).toHaveText(/Ben Sample/);
  await expect(recent).toContainText([/Ben Sample/, /DemoAlpha2001/]);
  // A destination, by name.
  await page.keyboard.type("members");
  await expect(dialog.getByRole("group", { name: "Go to" }).getByRole("option")).toHaveText([/Members/]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();

  // An action of the current page: star the replication from the palette.
  await page.goto(`./#/replications/${ALPHA}`);
  await expect(page.getByRole("heading", { level: 1, name: ALPHA })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.keyboard.type("star");
  await expect(dialog.getByRole("group", { name: "On this page" }).getByRole("option")).toHaveText([`Star ${ALPHA}`]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: `Star ${ALPHA}` })).toHaveAttribute("aria-pressed", "true");
  const shortcuts = page.getByTestId("sidebar-shortcuts");
  await expect(shortcuts.getByRole("list", { name: "Starred" }).getByRole("link", { name: ALPHA })).toBeVisible();

  // Another tab of the page, from the palette.
  await page.keyboard.press("Control+k");
  await page.keyboard.type("hypotheses");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { name: "Hypotheses" })).toHaveAttribute("aria-selected", "true");

  // Escape closes it, and nothing found says so.
  await page.keyboard.press("Control+k");
  await page.keyboard.type("nothing by this name");
  await expect(dialog.getByRole("status")).toContainText("Nothing matches.");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  // The search control of the top bar opens it too.
  await page.getByTestId("open-search").click();
  await expect(combobox).toBeFocused();
  await page.keyboard.press("Escape");
});

test("a member stars a member, and the sidebar lists favourites and recent items that open the record", async ({
  page,
}) => {
  await signInAsIvy(page);
  await page.goto(`./#/members/${BEN.personId}`);
  const star = page.getByRole("button", { name: `Star ${BEN.name}` });
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "true");
  const shortcuts = page.getByTestId("sidebar-shortcuts");
  await expect(shortcuts.getByRole("list", { name: "Starred" }).getByRole("link", { name: BEN.name })).toBeVisible();
  await expect(shortcuts.getByRole("list", { name: "Recent" }).getByRole("link", { name: BEN.name })).toBeVisible();

  await page.goto("./#/");
  await shortcuts.getByRole("list", { name: "Starred" }).getByRole("link", { name: BEN.name }).click();
  await expect(page.getByRole("heading", { level: 1, name: BEN.name })).toBeVisible();
  await star.click();
  await expect(star).toHaveAttribute("aria-pressed", "false");
  await expect(shortcuts.getByRole("list", { name: "Starred" }).getByRole("link", { name: BEN.name })).toHaveCount(0);
});
