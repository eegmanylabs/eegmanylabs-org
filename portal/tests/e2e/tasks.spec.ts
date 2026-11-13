// Tasks in the browser (D-019), against the synthetic world of `seed:demo`: acceptance scenario
// AS-6, in which a lead plans nested work with a dependency, a deadline and a link and the
// assignee is told of it and finds it in My tasks; the action items of a meeting; the progress
// log and its followers; the keyboard operation of the task tree and of the board; and the
// accessibility of each new page. Everyone here is invented, and every address uses the
// example.org domain.
import type { Page } from "@playwright/test";
import { DEMO_DATASET } from "../../tools/src/fixtures/demo-world";
import { reviewPage } from "./identity-support";
import { ALPHA, IVY, leadBrowser, signInAsIvy } from "./registry-support";
import { expect, seriousFindings, test } from "./support";

/** Today as the portal shows a date, which the browsers of this suite read in the same zone. */
const today = () => new Date().toISOString().slice(0, 10);
/** The dataset of the demonstration world, which a task links to. */
const DATASET_KEY = DEMO_DATASET.key;

let counter = 0;
/** A name no other test of this run uses. */
function unique(label: string): string {
  counter += 1;
  return `${label} ${Date.now().toString(36)}${counter}`;
}

/** Creates a task list through the dialog and waits until its tree is shown. */
async function createList(page: Page, name: string, belongsTo: string): Promise<void> {
  await page.goto("./#/tasks");
  await page.getByRole("button", { name: "New list" }).click();
  const dialog = page.getByRole("dialog", { name: "New task list" });
  await dialog.getByLabel("Name").fill(name);
  await expect(dialog.getByLabel("Belongs to").locator("option", { hasText: belongsTo })).toHaveCount(1);
  await dialog.getByLabel("Belongs to").selectOption({ label: belongsTo });
  await dialog.getByRole("button", { name: "Create the list" }).click();
  await expect(page.getByRole("heading", { level: 2, name })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("tab", { name: "Tree", selected: true })).toBeVisible();
}

/** Adds a task at the top of the open list, or beneath a parent, through the form of the tree. */
async function addTask(page: Page, title: string, parent?: string): Promise<void> {
  if (parent !== undefined) {
    await page.getByRole("button", { name: `Add a subtask to ${parent}` }).click();
    await page.getByLabel(`New subtask of ${parent}`).fill(title);
    await page.getByRole("button", { name: "Add subtask" }).click();
  } else {
    await page.getByLabel("New task", { exact: true }).fill(title);
    await page.getByRole("button", { name: "Add task" }).click();
  }
  await expect(page.getByRole("tree").getByRole("button", { name: title, exact: true })).toBeVisible({
    timeout: 20_000,
  });
}

/** The panel of an open task. */
const panelOf = (page: Page, title: string) => page.getByLabel(`Preview of ${title}`);

/** Opens a task of the tree in its panel. */
async function openTask(page: Page, title: string) {
  await page.getByRole("tree").getByRole("button", { name: title, exact: true }).click();
  const panel = panelOf(page, title);
  await expect(panel).toBeVisible();
  return panel;
}

/** Sets a date of the open task, which is saved when the field loses focus. */
async function setDate(page: Page, title: string, label: "Start" | "Due", day: string): Promise<void> {
  const field = panelOf(page, title).getByLabel(label, { exact: true });
  await field.fill(day);
  await field.blur();
  await expect(field).toHaveValue(day);
}

/** Shows the views of the open list as the given layout. */
async function showAs(page: Page, layout: "List" | "Board" | "Calendar" | "Timeline"): Promise<void> {
  await page.getByLabel("Show as").selectOption({ label: layout });
  await expect(page.getByTestId("view-surface")).toHaveAttribute("data-view-type", layout.toLowerCase());
}

test("AS-6: a lead plans nested work that the assignee is told of and finds in My tasks", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const listName = unique("Synthetic plan");
  const parent = unique("Prepare the ethics bundle");
  const child = unique("Draft the consent form");
  const prior = unique("Pilot the paradigm");
  const day = today();
  try {
    const ben = lead.page;
    await createList(ben, listName, `Replication ${ALPHA}`);
    await addTask(ben, parent);
    await addTask(ben, prior);
    await addTask(ben, child, parent);
    await expect(ben.getByRole("treeitem").filter({ hasText: child })).toHaveAttribute("aria-level", "2");

    // The task it depends on is due today too, so that both stand on the timeline.
    await openTask(ben, prior);
    await setDate(ben, prior, "Due", day);

    const panel = await openTask(ben, child);
    await setDate(ben, child, "Due", day);
    await panel.getByLabel("Task this one depends on").selectOption({ label: prior });
    await panel.getByRole("button", { name: "Add dependency" }).click();
    await expect(panel.getByRole("button", { name: "Remove the dependency" })).toBeVisible({ timeout: 20_000 });
    await panel.getByLabel("Kind of record to link").selectOption("replication");
    await panel.getByLabel("Record to link", { exact: true }).selectOption(ALPHA);
    await panel.getByRole("button", { name: "Add link" }).click();
    await expect(panel.getByRole("link", { name: ALPHA })).toBeVisible({ timeout: 20_000 });
    // The dataset of the work is linked from the registry, and the link opens it.
    await panel.getByLabel("Kind of record to link").selectOption("dataset");
    await panel.getByLabel("Record to link", { exact: true }).selectOption(DATASET_KEY);
    await panel.getByRole("button", { name: "Add link" }).click();
    await expect(panel.getByRole("link", { name: new RegExp(`^${DATASET_KEY}`) })).toBeVisible({ timeout: 20_000 });
    // A hypothesis of the replication is linked too, and its link opens the replication's hypotheses.
    await panel.getByLabel("Kind of record to link").selectOption("hypothesis");
    await panel.getByLabel("Record to link", { exact: true }).selectOption({ label: `${ALPHA}, hypothesis 1` });
    await panel.getByRole("button", { name: "Add link" }).click();
    await expect(panel.getByRole("link", { name: `${ALPHA}, hypothesis 1` })).toHaveAttribute(
      "href",
      new RegExp(`/replications/${ALPHA}\\?tab=hypotheses$`),
      { timeout: 20_000 },
    );
    const assignees = panel.getByLabel("Add to the assignees");
    await assignees.selectOption({ label: IVY.name });
    // The first of the buttons named Add is that of the assignees, the first role of the panel.
    await panel.getByRole("button", { name: "Add", exact: true }).first().click();
    await expect(panel.getByRole("button", { name: `Remove ${IVY.name} from the assignees` })).toBeVisible({
      timeout: 20_000,
    });

    // The list, the board, the calendar and the timeline show the same task, due the same day.
    await ben.getByRole("tab", { name: "Views" }).click();
    await showAs(ben, "List");
    const listed = ben.getByRole("list", { name: listName }).getByRole("listitem");
    await expect(listed.filter({ hasText: child })).toHaveAttribute("data-depth", "1");
    await showAs(ben, "Board");
    await expect(
      ben.getByRole("listitem", { name: /^To do, \d+$/ }).getByRole("button", { name: child, exact: true }),
    ).toBeVisible();
    await showAs(ben, "Calendar");
    await expect(ben.getByRole("table").getByRole("button", { name: child, exact: true })).toBeVisible();
    await showAs(ben, "Timeline");
    await expect(ben.getByRole("list", { name: listName })).toContainText(child);
    await expect(ben.getByTestId("timeline-dependencies").locator("path")).toHaveCount(1);
    await expect(ben.getByRole("list", { name: listName })).toContainText(`Depends on ${prior}.`);

    // The task waits on unfinished work, which the risks of the list name.
    await ben.getByRole("tab", { name: "Risks and blockers" }).click();
    const risks = ben.getByRole("table", { name: /Tasks at risk/ });
    await expect(risks.getByRole("row").filter({ hasText: child })).toContainText("Waiting on unfinished work");
    await expect(risks.getByRole("row").filter({ hasText: child })).toContainText(prior);

    // The assignee is told, and finds the task among her own.
    await signInAsIvy(page);
    const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
    await expect(bell).toBeVisible({ timeout: 30_000 });
    await bell.click();
    const notifications = page.getByRole("dialog", { name: "Notifications" });
    await expect(notifications).toContainText("A task was assigned to you");
    await expect(notifications).toContainText(child);
    await page.keyboard.press("Escape");
    await page.goto("./#/tasks");
    await expect(page.getByRole("heading", { level: 2, name: "My tasks" })).toBeVisible();
    await expect(page.getByRole("list", { name: "My tasks" })).toContainText(child);
    // Opened from My tasks, the task opens in its own panel, where the assignee changes its progress.
    await page.getByRole("list", { name: "My tasks" }).getByRole("button", { name: child, exact: true }).click();
    const own = panelOf(page, child);
    await expect(own).toBeVisible({ timeout: 20_000 });
    await expect(own.getByLabel("Status", { exact: true })).toBeEnabled();
    const progress = own.getByLabel("Progress in per cent");
    await progress.fill("140");
    await progress.blur();
    await expect(own.getByText("Give the progress as a whole number from 0 to 100.")).toBeVisible();
    await expect(progress).toHaveAttribute("aria-invalid", "true");
    await expect(progress).not.toHaveValue("140");
    // The dataset link of the task opens the dataset in the registry (acceptance scenario 6).
    await own.getByRole("link", { name: new RegExp(`^${DATASET_KEY}`) }).click();
    await expect(page.getByRole("heading", { level: 1, name: DATASET_KEY })).toBeVisible({ timeout: 20_000 });
  } finally {
    await lead.context.close();
  }
});

test("a line of a meeting becomes an action item that shows its task live", async ({ page }) => {
  test.setTimeout(180_000);
  const listName = unique("Ivy's actions");
  const meeting = unique("Synthetic planning meeting");
  const line = unique("Book the recording room");
  await signInAsIvy(page);
  await createList(page, listName, "Only me: a personal list");

  await page.goto("./#/pages");
  await page.getByRole("button", { name: "New meeting" }).click();
  const dialog = page.getByRole("dialog", { name: "New meeting" });
  await dialog.getByLabel("Title").fill(meeting);
  await dialog.getByLabel("Date").fill(today());
  await dialog.getByRole("button", { name: "Create the meeting" }).click();
  await expect(page.getByRole("heading", { level: 1, name: meeting })).toBeVisible({ timeout: 20_000 });
  const editor = page.getByTestId("page-editor").locator(".bn-editor");
  await expect(editor.getByRole("heading", { name: "Action items" })).toBeVisible({ timeout: 20_000 });
  await expect(editor).toContainText(`Date: ${today()}`);
  // How to make a task is said beside the page, and is no line of it that could become one.
  await expect(page.getByTestId("action-item-help")).toBeVisible();
  await expect(editor).not.toContainText("choose Action item");

  // Once the sections are saved, a new line goes beneath the heading of the action items.
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 20_000 });
  // A click at the far right of the heading puts the caret at its end.
  const heading = editor.getByRole("heading", { name: "Action items" });
  const box = await heading.boundingBox();
  if (box === null) throw new Error("The heading of the action items has no box.");
  await heading.click({ position: { x: box.width - 4, y: box.height / 2 } });
  await page.keyboard.press("Enter");
  await page.keyboard.type(line);
  await expect(editor.getByText(line, { exact: true })).toBeVisible();
  await page.getByRole("toolbar", { name: "Page actions" }).getByRole("button", { name: "Action item" }).click();
  const make = page.getByRole("dialog", { name: "Make an action item" });
  await expect(make.getByLabel("Task")).toHaveValue(line);
  await make.getByLabel("List").selectOption({ label: listName });
  await make.getByLabel("Assignee").selectOption({ label: IVY.name });
  await make.getByLabel("Due").fill(today());
  await make.getByRole("button", { name: "Create the action item" }).click();
  await expect(make).toBeHidden({ timeout: 20_000 });

  const item = page.locator("[data-action-item]");
  await expect(item).toContainText(line);
  await expect(item).toContainText("To do");
  await expect(item).toContainText(`Due ${today()}`);
  await expect(item).toContainText("1 assignee");
  // The link of the action item takes the colour of every other link, never the browser's blue.
  expect(await item.getByRole("link", { name: line }).evaluate((link) => getComputedStyle(link).color)).not.toBe(
    "rgb(0, 0, 238)",
  );
  expect(await seriousFindings(page)).toEqual([]);

  // The task links back to the meeting, and its status shows on the page as it changes.
  await item.getByRole("link", { name: line }).click();
  const panel = panelOf(page, line);
  await expect(panel).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole("link", { name: meeting })).toBeVisible();
  await panel.getByLabel("Status", { exact: true }).selectOption({ label: "In progress" });
  await expect(panel.getByLabel("Status", { exact: true })).toHaveValue("inProgress", { timeout: 20_000 });
  await page.goBack();
  await expect(page.locator("[data-action-item]")).toContainText("In progress", { timeout: 20_000 });
});

test("the task tree and the board are operable with the keyboard alone", async ({ page }) => {
  test.setTimeout(180_000);
  const listName = unique("Keyboard plan");
  const first = unique("First step");
  const second = unique("Second step");
  const third = unique("Third step");
  await signInAsIvy(page);
  await createList(page, listName, "Only me: a personal list");
  await addTask(page, first);
  await addTask(page, second);
  await addTask(page, third);
  const row = (title: string) => page.getByRole("treeitem").filter({ hasText: title });

  // Arrow keys move between rows; Alt with an arrow nests, lifts and reorders.
  await row(first).focus();
  await page.keyboard.press("ArrowDown");
  await expect(row(second)).toBeFocused();
  await page.keyboard.press("Alt+ArrowRight");
  await expect(row(second)).toHaveAttribute("aria-level", "2", { timeout: 20_000 });
  await expect(row(first)).toHaveAttribute("aria-expanded", "true");
  await expect(row(second)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(row(first)).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(row(first)).toHaveAttribute("aria-expanded", "false");
  await expect(row(second)).toBeHidden();
  await page.keyboard.press("ArrowRight");
  await expect(row(second)).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(row(second)).toBeFocused();
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(row(second)).toHaveAttribute("aria-level", "1", { timeout: 20_000 });
  await expect(row(second)).toBeFocused();
  // Moved up twice, the third task keeps the focus and climbs two places.
  await page.keyboard.press("ArrowDown");
  await expect(row(third)).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByRole("treeitem").nth(1)).toContainText(third, { timeout: 20_000 });
  await expect(row(third)).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByRole("treeitem").first()).toContainText(third, { timeout: 20_000 });
  await expect(row(third)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(first)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(row(second)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panelOf(page, second)).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);
  // Closing the panel, by Escape or by its button, returns the focus to the row that opened it.
  await page.keyboard.press("Escape");
  await expect(panelOf(page, second)).toBeHidden();
  await expect(row(second)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panelOf(page, second)).toBeVisible();
  await panelOf(page, second).getByRole("button", { name: "Close the preview" }).click();
  await expect(row(second)).toBeFocused();

  // On the board, a card moves to another column through its own control.
  await page.getByRole("tab", { name: "Views" }).click();
  await showAs(page, "Board");
  const card = page.getByRole("listitem", { name: /^To do, \d+$/ }).getByRole("button", { name: third, exact: true });
  await card.focus();
  await page.keyboard.press("Tab");
  const control = page.getByLabel(`Move ${third} to`);
  await expect(control).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("listitem", { name: /^In progress, \d+$/ }).getByRole("button", { name: third, exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  expect(await seriousFindings(page)).toEqual([]);
});

test("followers of a replication are told of its progress updates", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  const body = unique("Recording started at the synthetic site");
  await signInAsIvy(page);
  await page.goto(`./#/replications/${ALPHA}?tab=updates`);
  await expect(page.getByRole("tab", { name: "Updates", selected: true })).toBeVisible();
  const follow = page.getByRole("button", { name: "Follow updates" });
  await follow.click();
  await expect(page.getByRole("button", { name: "Stop following" })).toHaveAttribute("aria-pressed", "true", {
    timeout: 20_000,
  });
  expect(await seriousFindings(page)).toEqual([]);

  const lead = await leadBrowser(browser, baseURL as string);
  try {
    await lead.page.goto(`./#/replications/${ALPHA}?tab=updates`);
    await lead.page.getByLabel("New progress update").fill(body);
    await lead.page.getByLabel("Pin this update at the top").check();
    await lead.page.getByRole("button", { name: "Post the update" }).click();
    await expect(lead.page.getByRole("status").filter({ hasText: "The update was posted." })).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await lead.context.close();
  }

  await expect(page.getByRole("article").filter({ hasText: body })).toContainText("Pinned", { timeout: 20_000 });
  const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
  await expect(bell).toBeVisible({ timeout: 30_000 });
  await bell.click();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toContainText(
    "A pinned progress update was posted",
  );
});

test("the new pages of tasks have no serious accessibility findings", async ({ page }) => {
  test.setTimeout(180_000);
  await signInAsIvy(page);
  await page.goto("./#/tasks");
  await expect(page.getByRole("heading", { level: 1, name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Task lists" })).toBeVisible();
  // Every way of seeing the tasks fits the narrowest screen without scrolling sideways.
  await reviewPage(page, "tasks-my-tasks");
  for (const tab of ["Workload", "Risks and blockers", "Roadmap", "Dependencies"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab, selected: true })).toBeVisible();
    await reviewPage(page, `tasks-${tab.toLowerCase().replaceAll(" ", "-")}`);
  }
  await page.getByRole("button", { name: "New list" }).click();
  await expect(page.getByRole("dialog", { name: "New task list" })).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);
  await page.keyboard.press("Escape");

  await page.goto(`./#/replications/${ALPHA}?tab=tasks`);
  await expect(page.getByRole("tab", { name: "Tasks", selected: true })).toBeVisible();
  await expect(page.getByText(/No tasks here yet|Tasks of this record/).first()).toBeVisible({ timeout: 20_000 });
  expect(await seriousFindings(page)).toEqual([]);

  await page.goto(`./#/members/${IVY.personId}?tab=tasks`);
  await expect(page.getByRole("tab", { name: "Tasks", selected: true })).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);

  await page.goto("./#/pages");
  await expect(page.getByRole("heading", { level: 2, name: "Meetings" })).toBeVisible();
  await page.getByRole("button", { name: "New meeting" }).click();
  await expect(page.getByRole("dialog", { name: "New meeting" })).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);
});
