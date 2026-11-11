// Databases, views and dashboards in the browser (D-011), against the synthetic world of
// `seed:demo`: every kind of view of a database, inline and bulk editing and what a reader who
// may not edit is offered, a personal view that nobody else sees, a linked view in a page, the
// same participations on the programme's dashboard, a replication and a laboratory changing
// together, a dashboard arranged with the keyboard, and axe on every new page. The table of
// 5,000 rows is in workspace.table-performance.spec.ts. Everyone here is invented, and every
// address uses the example.org domain.
import type { Page } from "@playwright/test";
import { administratorBrowser, reviewPage } from "./identity-support";
import { linkedBrowser } from "./laboratory-support";
import { BEN, signInAsIvy } from "./registry-support";
import { expect, test } from "./support";

const GAMMA = "DemoGamma2010";
const ALPHA = "DemoAlpha2001";
const ATTENTION_LAB = "demo-lab-attention";

/** Creates a database on the notes of DemoGamma2010, which Ivy's team edits and every other member reads. */
async function databaseOnGammaNotes(page: Page, name: string): Promise<string> {
  await page.goto(`./#/replications/${GAMMA}?tab=notes`);
  await expect(page.getByRole("tab", { name: "Notes", selected: true })).toBeVisible();
  await page.getByRole("button", { name: "Add a database" }).click();
  await page.getByLabel("Name of the new database").fill(name);
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return page.url();
}

async function addRow(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "New row" }).click();
  await page.getByLabel("Name of the new row").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByTestId("view-table").getByRole("row").filter({ hasText: name })).toHaveCount(1, {
    timeout: 20_000,
  });
}

async function showAs(page: Page, type: string): Promise<void> {
  await page.getByLabel("Show as").selectOption({ label: type });
  await expect(page.getByTestId("view-surface")).toHaveAttribute("data-view-type", type.toLowerCase());
}

test("a database shows its rows as a table, a list, a board, a calendar, a timeline and a gallery", async ({
  page,
}) => {
  await signInAsIvy(page);
  await databaseOnGammaNotes(page, "Synthetic trial sites");
  await addRow(page, "Site Aland");
  await addRow(page, "Site Berwick");

  // A date property, given a value in the table.
  await page.getByRole("button", { name: "Properties" }).click();
  await page.getByRole("button", { name: "Add a property" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a property" });
  await dialog.getByLabel("Name").fill("Visit");
  await dialog.getByLabel("Type").selectOption({ label: "Date" });
  await dialog.getByRole("button", { name: "Save the property" }).click();
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Escape");
  const today = new Date().toISOString().slice(0, 10);
  await page.getByRole("button", { name: /^Visit of Site Aland:/ }).click();
  await page.getByRole("dialog", { name: "Change Visit" }).getByLabel("Visit").fill(today);
  await page.getByRole("dialog", { name: "Change Visit" }).getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: /^Visit of Site Aland:/ })).not.toContainText("Empty", {
    timeout: 20_000,
  });

  await showAs(page, "List");
  await expect(
    page.getByRole("list", { name: "Synthetic trial sites" }).getByRole("button", { name: "Site Berwick" }),
  ).toBeVisible();
  await showAs(page, "Board");
  await expect(page.getByRole("listitem", { name: /^No status, 2$/ })).toBeVisible();
  await expect(page.getByRole("listitem", { name: /^Done, 0$/ })).toBeVisible();
  await showAs(page, "Calendar");
  await expect(page.getByRole("button", { name: "Site Aland" })).toBeVisible();
  await showAs(page, "Timeline");
  await expect(page.getByText(/^On \d+ \w+ \d{4}$/)).toBeAttached();
  await showAs(page, "Gallery");
  await expect(
    page.getByRole("list", { name: "Synthetic trial sites" }).getByRole("button", { name: "Site Aland" }),
  ).toBeVisible();
  await reviewPage(page, "database-gallery");
  await showAs(page, "Table");
  await reviewPage(page, "database-table");
});

test("an editor changes a value in place and many rows at once, and a reader is offered neither", async ({
  page,
  browser,
  baseURL,
}) => {
  await signInAsIvy(page);
  const address = await databaseOnGammaNotes(page, "Synthetic pilots");
  await addRow(page, "Pilot one");
  await addRow(page, "Pilot two");
  await addRow(page, "Pilot three");

  // In place: a status, through the editor of the cell.
  await page.getByRole("button", { name: /^Status of Pilot one:/ }).click();
  const editor = page.getByRole("dialog", { name: "Change Status" });
  await editor.getByLabel("Status").selectOption({ label: "In progress" });
  await editor.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: /^Status of Pilot one:/ })).toContainText("In progress");

  // In bulk: two rows at once.
  await page.getByLabel("Select Pilot two").check();
  await page.getByLabel("Select Pilot three").check();
  await page.getByRole("button", { name: "Change a property" }).click();
  const bulk = page.getByRole("dialog", { name: "Change 2 records" });
  await bulk.getByLabel("Property").selectOption({ label: "Status" });
  await bulk.getByLabel("Status").selectOption({ label: "Done" });
  await bulk.getByRole("button", { name: "Save" }).click();
  await expect(bulk).toBeHidden({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Status of Pilot two:/ })).toContainText("Done");
  await expect(page.getByRole("button", { name: /^Status of Pilot three:/ })).toContainText("Done");

  // Ben reads the notes of DemoGamma2010 and is on no team of it: he sees the rows and changes nothing.
  const ben = await linkedBrowser(browser, baseURL as string, BEN.email);
  try {
    await ben.page.goto(address);
    const table = ben.page.getByTestId("view-table");
    await expect(table).toContainText("Pilot three");
    await expect(table).toContainText("Done");
    await expect(ben.page.getByRole("button", { name: "New row" })).toHaveCount(0);
    await expect(ben.page.locator("[data-cell-editor]")).toHaveCount(0);
    await ben.page.getByLabel("Select Pilot one").check();
    await ben.page.getByRole("button", { name: "Change a property" }).click();
    await expect(
      ben.page
        .getByRole("dialog", { name: "Change 1 record" })
        .getByText("Your account may not change any property of every selected record."),
    ).toBeVisible();
  } finally {
    await ben.context.close();
  }
});

test("a personal view is its owner's alone until it is shared", async ({ page, browser, baseURL }) => {
  await signInAsIvy(page);
  const address = await databaseOnGammaNotes(page, "Synthetic views");
  await addRow(page, "Row to see");
  await showAs(page, "Board");
  await page.getByRole("button", { name: "Views" }).click();
  await page.getByLabel("Name of the new view").fill("Ivy's board");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByLabel("Saved view")).toHaveValue(/.+/, { timeout: 20_000 });
  await page.keyboard.press("Escape");

  const ben = await linkedBrowser(browser, baseURL as string, BEN.email);
  try {
    await ben.page.goto(address);
    await expect(ben.page.getByTestId("view-table")).toContainText("Row to see");
    await ben.page.getByRole("button", { name: "Views" }).click();
    await expect(ben.page.getByLabel("Saved view").locator("option")).toHaveText(["Not saved"]);

    // Shared, the view reaches Ben.
    await page.getByRole("button", { name: "Views" }).click();
    await page.getByRole("button", { name: "Share with every member" }).click();
    await expect(page.getByRole("button", { name: "Stop sharing" })).toBeVisible({ timeout: 20_000 });
    await expect(ben.page.getByLabel("Saved view").locator("option")).toHaveText(["Not saved", "Ivy's board (shared)"]);
  } finally {
    await ben.context.close();
  }
});

test("a linked view in a page shows the records of a collection, chosen from the slash menu", async ({ page }) => {
  await signInAsIvy(page);
  await page.goto(`./#/replications/${GAMMA}?tab=notes`);
  const body = page.getByTestId("page-editor").locator(".bn-editor");
  await expect(body).toBeVisible();
  await body.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("/Linked view");
  await expect(page.getByRole("option", { name: /Linked view/ })).toBeVisible();
  await page.keyboard.press("Enter");
  const block = page.getByTestId("linked-view").last();
  await block.getByLabel("Records").selectOption({ label: "Participations" });
  await block.getByLabel("Title of the linked view").fill("Participations of the programme");
  await block.getByRole("button", { name: "Show the view" }).click();
  await expect(block.getByTestId("view-table")).toContainText("DemoAlpha2001 at", { timeout: 20_000 });
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 30_000 });
  // The block travels with the page.
  await page.reload();
  await expect(page.getByTestId("linked-view").last().getByTestId("view-table")).toContainText("DemoGamma2010 at", {
    timeout: 30_000,
  });
});

test("the same participations on the programme dashboard, a replication and a laboratory change together", async ({
  page,
  browser,
  baseURL,
}) => {
  const participation = /DemoAlpha2001 at Demo Attention/;
  await signInAsIvy(page);
  const laboratory = page;
  await laboratory.goto(`./#/labs/${ATTENTION_LAB}?tab=dashboard`);
  const replication = await page.context().newPage();
  await replication.goto(`./#/replications/${ALPHA}?tab=dashboard`);
  for (const view of [laboratory, replication]) {
    await expect(view.getByRole("region", { name: "Participations" }).getByTestId("view-table")).toContainText(
      participation,
      {
        timeout: 30_000,
      },
    );
  }

  const admin = await administratorBrowser(browser, baseURL as string);
  try {
    await admin.page.goto("./#/dashboards/programme__eegmanylabs");
    const table = admin.page.getByRole("region", { name: "Participations" }).getByTestId("view-table");
    await expect(table).toContainText(participation, { timeout: 30_000 });
    const cell = admin.page.getByRole("button", {
      name: /^Target, main experiment of DemoAlpha2001 at Demo Attention[^:]*:/,
    });
    await cell.click();
    const editor = admin.page.getByRole("dialog", { name: "Change Target, main experiment" });
    await editor.getByLabel("Target, main experiment").fill("77");
    await editor.getByRole("button", { name: "Save" }).click();
    await expect(cell).toContainText("77", { timeout: 20_000 });
    await reviewPage(admin.page, "dashboard-programme");
  } finally {
    await admin.context.close();
  }
  for (const view of [laboratory, replication]) {
    const row = view
      .getByRole("region", { name: "Participations" })
      .getByRole("row")
      .filter({ hasText: participation });
    await expect(row).toContainText("77", { timeout: 30_000 });
  }
  await reviewPage(replication, "dashboard-replication");
});

test("a member arranges a personal dashboard with the keyboard, and the layout is kept", async ({ page }) => {
  await signInAsIvy(page);
  await page.goto("./#/dashboards");
  await reviewPage(page, "dashboards");
  await page.getByLabel("Name of the new dashboard").fill("Synthetic dashboard");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Synthetic dashboard" })).toBeVisible();
  for (const title of ["First note", "Second note"]) {
    await page.getByRole("button", { name: "Add a widget" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a widget" });
    await dialog.getByLabel("Kind").selectOption({ label: "A note" });
    await dialog.getByLabel("Title").fill(title);
    await dialog.getByLabel("Text").fill(`${title}, written for the test.`);
    await dialog.getByRole("button", { name: "Add the widget" }).click();
    await expect(page.getByRole("region", { name: title })).toBeVisible({ timeout: 20_000 });
  }
  // The second note takes the free place beside the first.
  const second = page.getByRole("region", { name: "Second note" });
  await expect(second).toHaveAttribute("data-place", "6,0,6,4");

  const handle = page.getByRole("button", { name: "Rearrange Second note" });
  await handle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("dashboard-status")).toContainText("Arranging Second note");
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("dashboard-status")).toContainText("Saved", { timeout: 20_000 });
  }
  await expect(second).toHaveAttribute("data-place", "0,0,6,4");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByTestId("dashboard-status")).toContainText("7 wide");
  await expect(page.getByTestId("dashboard-status")).toContainText("Saved", { timeout: 20_000 });
  await page.keyboard.press("Escape");
  await expect(second).toHaveAttribute("data-place", "0,0,7,4");
  await expect(page.getByRole("region", { name: "First note" })).toHaveAttribute("data-place", "0,4,6,4");

  await page.reload();
  await expect(page.getByRole("region", { name: "Second note" })).toHaveAttribute("data-place", "0,0,7,4", {
    timeout: 20_000,
  });
  await reviewPage(page, "dashboard-personal");
});

test("an option property takes its options with Enter, and every kind of view fits a narrow screen", async ({
  page,
}) => {
  await signInAsIvy(page);
  await databaseOnGammaNotes(page, "Synthetic phases");
  await addRow(page, "Site Corran");

  await page.getByRole("button", { name: "Properties" }).click();
  await page.getByRole("button", { name: "Add a property" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a property" });
  await dialog.getByLabel("Name").fill("Phase");
  await dialog.getByLabel("Type").selectOption({ label: "Select" });
  // Saving with no option is refused, Enter adds an option and stays in the dialog, and an
  // option still typed when the property is saved is kept.
  await dialog.getByRole("button", { name: "Save the property" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Add at least one option, so that a value can be chosen.");
  await dialog.getByLabel("New option").fill("Alpha");
  await dialog.getByLabel("New option").press("Enter");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Option 1" })).toHaveValue("Alpha");
  await expect(dialog.getByLabel("New option")).toBeFocused();
  await dialog.getByLabel("New option").fill("Beta");
  await dialog.getByRole("button", { name: "Save the property" }).click();
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /^Phase of Site Corran:/ }).click();
  const editor = page.getByRole("dialog", { name: "Change Phase" });
  await expect(editor.getByLabel("Phase").locator("option")).toHaveText(["None", "Alpha", "Beta"]);
  await editor.getByRole("button", { name: "Cancel" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  for (const type of ["Table", "List", "Board", "Calendar", "Timeline", "Gallery"]) {
    await showAs(page, type);
    expect(await page.evaluate(() => document.documentElement.scrollWidth), type).toBeLessThanOrEqual(390);
  }
});
