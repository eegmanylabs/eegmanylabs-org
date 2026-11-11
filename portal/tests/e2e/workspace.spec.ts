// The workspace in the browser (D-010), against the synthetic world of `seed:demo`: acceptance
// scenario AS-7 on the notes of a replication, the convergence of two editors, edits made
// offline, the keyboard access of the editor, and the accessibility of the page view. Everyone
// here is invented, and every address uses the example.org domain.
import { systemWriteContext } from "@eegml/shared";
import type { Page } from "@playwright/test";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../support/admin";
import { setBackgroundTriggers } from "../support/emulators";
import { reviewPage } from "./identity-support";
import { linkedBrowser } from "./laboratory-support";
import { BEN, IVY, signInAsIvy } from "./registry-support";
import { expect, seriousFindings, test } from "./support";

const GAMMA = "DemoGamma2010";

// The triggers of this spec (mentions, activity, the index) must not wait behind those of the
// specs before it: the load fixture of the registry queues thousands. Switching the triggers off
// drops the queued work, switching them on loads them anew, and a sentinel write that is audited
// shows that they are running again, as in the functions suite.
test.beforeAll(async () => {
  test.setTimeout(180_000);
  await setBackgroundTriggers(false);
  await setBackgroundTriggers(true);
  const now = Timestamp.now();
  const sentinel = adminDb.doc(`countCategories/zz-e2e-workspace-${Date.now().toString(36)}`);
  await sentinel.set({
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "system:e2e",
    updatedBy: "system:e2e",
    archivedAt: null,
    writeContext: systemWriteContext(),
    key: "zzE2eSentinel",
    label: "Sentinel",
    definition: "A sentinel.",
    position: 999,
    isCore: false,
  });
  await expect
    .poll(async () => (await adminDb.collection("auditEvents").where("documentPath", "==", sentinel.path).get()).size, {
      timeout: 150_000,
    })
    .toBeGreaterThan(0);
  await sentinel.delete();
});

/** The text of the editor of a page, as the reader sees it. */
const editorOf = (page: Page) => page.getByTestId("page-editor").locator(".bn-editor");

/** Waits until the page says that every change has reached the server. */
async function saved(page: Page): Promise<void> {
  await expect(page.getByTestId("save-state")).toHaveText("Saved", { timeout: 30_000 });
}

/** Opens a page of the workspace that a member creates at its top, and returns its address. */
async function newWorkspacePage(page: Page, title: string): Promise<string> {
  await page.goto("./#/pages");
  await expect(page.getByRole("heading", { level: 1, name: "Workspace" })).toBeVisible();
  await page.getByRole("main").getByRole("button", { name: "New page", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "New page" });
  await dialog.getByLabel("Title").fill(title);
  await dialog.getByRole("button", { name: "Create the page" }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(editorOf(page)).toBeVisible();
  return page.url();
}

test("AS-7: a member edits the notes of a replication, comments, mentions a member, and autosave, history and notifications work", async ({
  page,
  browser,
  baseURL,
}) => {
  // Ben has claimed his profile, so he can be mentioned and notified.
  const ben = await linkedBrowser(browser, baseURL as string, BEN.email);
  try {
    await signInAsIvy(page);
    await page.goto(`./#/replications/${GAMMA}?tab=notes`);
    await expect(page.getByRole("tab", { name: "Notes", selected: true })).toBeVisible();
    const editor = editorOf(page);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveAttribute("contenteditable", "true");

    // Text, a heading by its Markdown shortcut, a list, a callout from the slash menu and a mention,
    // on notes cleared first, so the scenario can run again on the same data.
    await editor.click();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Delete");
    await expect(editor.locator(".bn-block-content")).toHaveCount(1);
    await page.keyboard.type("Electrode montage agreed with the original authors.");
    await page.keyboard.press("Enter");
    await page.keyboard.type("## Pilot results");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- Impedance below ten kilo-ohm");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("/callout");
    await expect(page.getByRole("option", { name: /Callout/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await page.keyboard.type("Data freeze on Friday. Ask ");
    await page.keyboard.type("@Ben");
    await expect(page.getByRole("option", { name: BEN.name })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(editor.locator("h2")).toHaveText("Pilot results");
    await expect(editor.locator(".portal-callout")).toContainText("Data freeze on Friday.");
    await expect(editor.locator(".portal-mention")).toHaveText(`@${BEN.name}`);
    await expect(page.getByTestId("save-state")).toHaveText(/Saving|Saved/);
    await saved(page);

    // Autosave: the content is there after a reload.
    await page.reload();
    await expect(editorOf(page)).toContainText("Electrode montage agreed with the original authors.");
    await expect(editorOf(page).locator(".portal-mention")).toHaveText(`@${BEN.name}`);

    // A comment anchored to a selection of the text, which mentions Ben too.
    await editorOf(page).getByText("Electrode montage agreed").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.locator(".bn-formatting-toolbar").getByRole("button", { name: "Comment", exact: true }).click();
    const composer = page.getByTestId("new-thread");
    await expect(composer).toContainText("Electrode montage agreed");
    const field = composer.getByRole("combobox", { name: "Your comment on the selected text" });
    await field.fill("Please confirm the montage, ");
    await field.pressSequentially("@Ben");
    await page.getByRole("option", { name: BEN.name }).click();
    await composer.getByRole("button", { name: "Comment", exact: true }).click();
    const thread = page.getByTestId("thread").first();
    await expect(thread).toContainText("Please confirm the montage, @Ben Sample");
    await expect(editorOf(page).locator(".portal-comment-anchor")).toContainText("Electrode montage agreed");

    // Version history: a named version, listed with its author, shown read only.
    await page.getByRole("button", { name: "History" }).click();
    await page.getByRole("button", { name: "Save a version" }).click();
    const version = page.getByTestId("version").first();
    await expect(version).toContainText(IVY.name);
    await version.click();
    const preview = page.getByTestId("version-preview");
    await expect(preview).toContainText("Electrode montage agreed");
    await expect(preview.locator(".bn-editor")).toHaveAttribute("contenteditable", "false");
    await page.getByRole("button", { name: "Back to the current page" }).click();

    // The activity names the editor and holds no content.
    await page.getByRole("button", { name: "Activity" }).click();
    // A trigger writes it after the update documents, so it may take a moment.
    await expect(page.getByTestId("activity").first()).toContainText(`${IVY.name} edited the page`, {
      timeout: 30_000,
    });

    // Ben is told, once by the page and once by the comment, and the notification leads to the page.
    await ben.page.getByRole("button", { name: /^Notifications/ }).click();
    await expect(ben.page.getByText(`${IVY.name} mentioned you on a page`).first()).toBeVisible({ timeout: 30_000 });
    await expect(ben.page.getByText(`${IVY.name} mentioned you in a comment`).first()).toBeVisible({ timeout: 30_000 });
    await ben.page
      .getByRole("link", { name: `${IVY.name} mentioned you in a comment` })
      .first()
      .click();
    await expect(ben.page.getByTestId("thread").first()).toContainText("Please confirm the montage");
    // Ben is no member of the team of the replication: he reads and comments, and does not edit.
    await expect(editorOf(ben.page)).toHaveAttribute("contenteditable", "false");

    await page.getByRole("button", { name: "Comments" }).click();
    expect(await seriousFindings(page)).toEqual([]);
    await reviewPage(page, "page-view");
  } finally {
    await ben.context.close();
  }
});

test("two members typing in the same paragraph converge, and a reload restores what both wrote", async ({
  page,
  browser,
  baseURL,
}) => {
  const ben = await linkedBrowser(browser, baseURL as string, BEN.email);
  try {
    await signInAsIvy(page);
    const address = await newWorkspacePage(page, "Convergence check");
    await editorOf(page).click();
    await page.keyboard.type("Shared paragraph");
    await saved(page);

    await ben.page.goto(address);
    const benEditor = editorOf(ben.page);
    await expect(benEditor).toContainText("Shared paragraph");
    // Both type at once: Ivy at the start of the paragraph, Ben at its end.
    await benEditor.getByText("Shared paragraph").click();
    await ben.page.keyboard.press("End");
    await editorOf(page).getByText("Shared paragraph").click();
    await page.keyboard.press("Home");
    await Promise.all([page.keyboard.type("IVY-AT-START "), ben.page.keyboard.type(" BEN-AT-END")]);
    await Promise.all([saved(page), saved(ben.page)]);
    const expected = "IVY-AT-START Shared paragraph BEN-AT-END";
    await expect(editorOf(page)).toContainText(expected, { timeout: 30_000 });
    await expect(benEditor).toContainText(expected, { timeout: 30_000 });

    // A reload, and a browser that opens the page afresh, show the same.
    await ben.page.reload();
    await expect(editorOf(ben.page)).toContainText(expected);
  } finally {
    await ben.context.close();
  }
});

test("an edit made offline is kept and reaches the other member once the connection is back", async ({
  page,
  browser,
  baseURL,
  monitor,
}) => {
  const ben = await linkedBrowser(browser, baseURL as string, BEN.email);
  try {
    await signInAsIvy(page);
    const address = await newWorkspacePage(page, "Offline check");
    await editorOf(page).click();
    await page.keyboard.type("Written online.");
    await saved(page);
    await ben.page.goto(address);
    await expect(editorOf(ben.page)).toContainText("Written online.");

    await page.context().setOffline(true);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Written while offline.");
    await expect(page.getByTestId("save-state")).toHaveText("Saving");
    await editorOf(ben.page).getByText("Written online.").click();
    await ben.page.keyboard.press("End");
    await ben.page.keyboard.type(" Ben meanwhile.");
    await saved(ben.page);

    await page.context().setOffline(false);
    await saved(page);
    for (const editor of [editorOf(page), editorOf(ben.page)]) {
      await expect(editor).toContainText("Written online. Ben meanwhile.", { timeout: 30_000 });
      await expect(editor).toContainText("Written while offline.", { timeout: 30_000 });
    }
    // Offline, Firestore loads an image from Google to tell "network down" from "server down",
    // which the policy of an emulator build refuses. That is the one problem allowed here.
    const probe = "www.google.com/images/cleardot.gif";
    expect(monitor.cspViolations.filter((violation) => !violation.includes(probe))).toEqual([]);
    expect(
      monitor.requests.filter((request) => new URL(request).host === "www.google.com" && !request.includes(probe)),
    ).toEqual([]);
    expect([...monitor.foreignHosts].filter((host) => host !== "www.google.com")).toEqual([]);
    expect(monitor.uncaughtErrors).toEqual([]);
    monitor.expectProblems();
  } finally {
    await ben.context.close();
  }
});

test("the formatting toolbar, the blocks and the comment of a selection are reached from the keyboard", async ({
  page,
}) => {
  await signInAsIvy(page);
  await newWorkspacePage(page, "Keyboard check");
  await editorOf(page).click();
  await page.keyboard.type("Make this bold");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Second block");
  await saved(page);

  // Alt F10 selects the text of the block and moves into the formatting toolbar; the arrows move in it.
  await editorOf(page).getByText("Make this bold").click();
  await page.keyboard.press("Alt+F10");
  const toolbar = page.locator(".bn-formatting-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator("button:focus, [role='combobox']:focus")).toHaveCount(1);
  const bold = toolbar.getByRole("button", { name: /Bold/ });
  for (let step = 0; step < 12; step += 1) {
    if (await bold.evaluate((element) => element === document.activeElement)) break;
    await page.keyboard.press("ArrowRight");
  }
  await expect(bold).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editorOf(page).locator("strong")).toHaveText("Make this bold");
  await page.keyboard.press("Escape");

  // Control Alt M comments on the selection.
  await editorOf(page).getByText("Second block").click();
  await expect(page.locator(".bn-formatting-toolbar")).toBeHidden();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+Home");
  // The formatting toolbar shows once the editor holds the selection.
  await expect(page.locator(".bn-formatting-toolbar")).toBeVisible();
  await page.keyboard.press("Control+Alt+m");
  await expect(page.getByTestId("new-thread")).toContainText("Second block");
  await page.getByTestId("new-thread").getByRole("button", { name: "Cancel" }).click();

  // Control Shift Up moves the current block up.
  await editorOf(page).getByText("Second block").click();
  await page.keyboard.press("Control+Shift+ArrowUp");
  await expect(editorOf(page).locator(".bn-block-content").first()).toHaveText("Second block");

  // The shortcuts are listed for everyone.
  await page.getByRole("button", { name: "More actions for this page" }).click();
  await page.getByRole("menuitem", { name: "Keyboard shortcuts" }).click();
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("Alt F10");
  expect(await seriousFindings(page)).toEqual([]);
});
