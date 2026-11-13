// Reporting, publishing and automation in the browser (phase 9), against the synthetic world of
// `seed:demo`, the fake of the website repository, which starts from the committed data files of
// this repository and never reaches GitHub, and the fake of the storage servers. Acceptance
// scenario 13: an approved public summary passes through the preview, a staging build of the
// real site in a scratch copy with its own build command, and an approval, and produces a pull
// request on the fake without private data. Then: an export from a view, a change of the digest
// preferences, an automation that opens a QC task when the data of a dataset arrives, and the
// drill-down from a dashboard widget to its records. Each new page is checked for accessibility at
// every width the portal supports. Everything here is invented, on the example.org domain.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { COLLECTIONS } from "@eegml/shared";
import { emulatorGitHubFake } from "../../functions/src/integrations/github/fake";
import { adminDb } from "../support/admin";
import { PORTAL_ROOT } from "../support/emulators";
import { administratorBrowser, reviewPage } from "./identity-support";
import { ALPHA, IVY, leadBrowser, signInAsIvy } from "./registry-support";
import { expect, test } from "./support";

const AUTOMATION_KEY = "DemoAlpha2001-automation-check";
/** A folder of its own on the Munich server, apart from the folder that AS-8 registers. */
const MUNICH_PATH = "DemoAlpha2001/automation-check";

test("AS-13: an approved public summary passes the preview, the staging build and the approval, and opens a pull request without private data", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  const admin = await administratorBrowser(browser, baseURL as string);
  const page = admin.page;
  try {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Publishing" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Publishing" })).toBeVisible({ timeout: 20_000 });
    await reviewPage(page, "publishing");

    // The outputs: the core team and member listings, the laboratory listing and the replication summaries.
    await page.getByLabel("Laboratory listing").check();
    await page.getByLabel("Replication summaries").check();
    await page.getByRole("button", { name: "Prepare and preview" }).click();
    await expect(page.getByTestId("publication-status")).toHaveText("Previewed, awaiting the staging build", {
      timeout: 30_000,
    });
    const batchId = new URL(page.url()).hash.split("/").at(-1) ?? "";
    expect(batchId).toMatch(/^[A-Za-z0-9]{20}$/);

    // The preview shows, field by field, what the website would gain, and nothing private.
    const preview = page.getByRole("region", { name: "Preview" });
    await expect(
      preview.getByTestId("publication-file").filter({ hasText: "assets/data/laboratories.tsv" }),
    ).toContainText("Demo Signal Laboratory");
    await expect(preview.getByTestId("publication-file").filter({ hasText: "data/replications.tsv" })).toContainText(
      ALPHA,
    );
    await expect(preview).not.toContainText("@example.org");
    await expect(page.getByTestId("verify-command")).toContainText(batchId);
    await expect(page.getByRole("button", { name: "Approve the live write" })).toHaveCount(0);
    await reviewPage(page, "publishing-export-preview");

    // The staging build: the site's own build command in a scratch copy outside the repository.
    await promisify(execFile)(
      "npm",
      ["run", "--silent", "-w", "@eegml/tools", "cli", "--", "publish:verify", "--batch", batchId],
      { cwd: PORTAL_ROOT, env: process.env, timeout: 240_000 },
    );
    await expect(page.getByTestId("verification-result")).toHaveText("Passed", { timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Staging build" })).toContainText("syrinx -c -e staging .");

    // Approval with the second factor in force for administrators opens the pull request on the fake.
    await page.getByRole("button", { name: "Approve the live write" }).click();
    const dialog = page.getByRole("dialog", { name: "Approve the live write" });
    await expect(dialog).toContainText("demonstration data");
    await dialog.getByRole("button", { name: "Approve and open the pull request" }).click();
    await expect(page.getByTestId("publication-status")).toHaveText("Pull request open", { timeout: 30_000 });
    // The fake's pull request is on a host that never resolves, is no link, and says it is no GitHub page.
    const pullLink = page.getByTestId("pull-request-link");
    await expect(pullLink).toHaveAttribute("data-href", /^https:\/\/github\.example\.invalid\/.+\/pull\/\d+$/);
    await expect(pullLink).toContainText("on the fake website repository (not on GitHub)");
    await expect(page.locator('a[href*="github.com"]')).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Export" })).toContainText("no site is deployed");
    await reviewPage(page, "publishing-export-staged");

    const fake = emulatorGitHubFake();
    const pull = fake.pulls().find((candidate) => candidate.state === "open");
    expect(pull?.headBranch).toBe(`portal/publication-${batchId}`);
    const files = fake.filesOf(pull?.headBranch ?? "");
    expect(files["assets/data/laboratories.tsv"]).toContain("Demo Signal Laboratory");
    const written = JSON.stringify(files);
    expect(written).not.toMatch(/[^\s@]+@example\.org/);
    expect(fake.pullBody(pull?.number ?? 0)).toContain("must never be merged");
    expect(fake.operations().some((operation) => operation.startsWith("merge"))).toBe(false);
    const batch = (await adminDb.doc(COLLECTIONS.publicationBatches.docPath(batchId)).get()).data();
    expect(batch).toMatchObject({ status: "staged", syntheticData: true });

    // A maintainer merges on the fake; the portal learns of it by reading the pull request.
    fake.merge(pull?.number ?? 0);
    await page.getByRole("button", { name: "Check the pull request again" }).click();
    await expect(page.getByTestId("publication-status")).toHaveText("Published", { timeout: 30_000 });
    await page.goto("./#/admin/publishing");
    await expect(page.getByTestId("publication-row").first()).toContainText("Published");
  } finally {
    await admin.context.close();
  }
});

test("a view of records is exported as CSV and Excel, holding what the reader sees", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const page = lead.page;
  try {
    await page.goto("./#/dashboards/programme__eegmanylabs");
    const surface = page.getByTestId("view-surface").first();
    await expect(surface).toBeVisible({ timeout: 30_000 });
    await surface.getByRole("button", { name: "Export" }).click();
    const csv = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "CSV file" }).click();
    const csvFile = await csv;
    expect(csvFile.suggestedFilename()).toMatch(/^participations-\d{4}-\d{2}-\d{2}\.csv$/);
    const text = await readFile((await csvFile.path()) ?? "", "utf8");
    expect(text.split("\r\n")[0]).toContain("Participation");
    expect(text).toContain(ALPHA);

    await surface.getByRole("button", { name: "Export" }).click();
    const xlsx = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Excel workbook" }).click();
    const workbook = await readFile((await (await xlsx).path()) ?? "");
    expect(workbook.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(workbook.toString("latin1")).toContain("xl/worksheets/sheet1.xml");
  } finally {
    await lead.context.close();
  }
});

test("drill-down opens the records behind a dashboard figure and the programme overview", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const page = lead.page;
  try {
    await page.goto("./#/dashboards/programme__eegmanylabs");
    const figure = page.getByRole("button", { name: /^Show the \d+ records$/ }).first();
    await expect(figure).toBeVisible({ timeout: 30_000 });
    await figure.click();
    const dialog = page.getByRole("dialog", { name: /^Records behind / });
    // Escape returns focus to the button that opened the records, and they open again from it.
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(figure).toBeFocused();
    await page.keyboard.press("Enter");
    const records = dialog.getByTestId("drill-down-records");
    await expect(records.getByRole("link").first()).toBeVisible();
    await reviewPage(page, "dashboard-drill-down");
    await records.getByRole("link").first().click();
    await expect(page).toHaveURL(/#\/recruitment\/participations\//);

    // The programme overview: every figure opens its records, and recruitment can be read on a past date.
    await page.goto("./#/overview");
    await expect(page.getByRole("heading", { level: 1, name: "Programme overview" })).toBeVisible({ timeout: 20_000 });
    const active = page.getByTestId("overview-tile").filter({ hasText: "Active laboratories" });
    await expect(active.getByTestId("overview-figure")).not.toHaveText("0", { timeout: 30_000 });
    // Every tile names its own records, and says where they come from: demonstration data, beside
    // a laboratory an earlier test entered in the portal.
    await expect(active).toContainText("demonstration data");
    const showActive = active.getByRole("button", { name: "Show the records behind Active laboratories" });
    await showActive.click();
    await expect(page.getByRole("dialog", { name: "Active laboratories" })).toContainText("Demo Signal Laboratory");
    await expect(page.getByRole("dialog", { name: "Active laboratories" })).toContainText("demonstration data");
    await page.keyboard.press("Escape");
    await expect(showActive).toBeFocused();
    await page.getByLabel("As of", { exact: true }).fill("2026-01-31");
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await expect(page.getByRole("region", { name: "Recruitment as of 31 Jan 2026" })).toBeVisible();
    await reviewPage(page, "overview");

    await page.goto("./#/analysis");
    await expect(page.getByTestId("analysis-breakdown").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("region", { name: "Demographics" })).toHaveCount(0);
    // Stored values read as labels, countries by their names, and the origin of the data is stated.
    const outputs = page.getByTestId("analysis-breakdown").filter({ hasText: "Outputs by status" });
    await expect(outputs).toContainText("Planned");
    await expect(outputs).not.toContainText("inPrincipleAcceptance");
    await expect(page.getByTestId("analysis-breakdown").filter({ hasText: "Laboratories by country" })).toContainText(
      "United Kingdom",
    );
    await expect(outputs.getByTestId("origin-note")).toContainText("demonstration data");
    await reviewPage(page, "analysis");
  } finally {
    await lead.context.close();
  }
});

test("a member changes their digest preferences, and the search finds what they may read", async ({ page }) => {
  test.setTimeout(150_000);
  await signInAsIvy(page);
  await page.goto("./#/account");
  const preferences = page.getByRole("region", { name: "Email and digests" });
  await expect(preferences).toBeVisible({ timeout: 20_000 });
  await expect(preferences.getByTestId("mail-delivery")).toContainText("Email delivery is not connected");
  await preferences.getByLabel("Send notifications to me by email").check();
  await preferences.getByLabel("How often").selectOption("weekly");
  await preferences.getByLabel("Keep quiet hours").check();
  await preferences
    .getByRole("group", { name: "Kinds of notification sent by email" })
    .getByLabel("A progress update")
    .uncheck();
  await preferences.getByRole("button", { name: "Save preferences" }).click();
  await expect(preferences.getByTestId("preferences-saved")).toBeVisible({ timeout: 20_000 });
  await reviewPage(page, "account-preferences");
  const uid = (await adminDb.collection(COLLECTIONS.users.collectionPath()).where("emailLower", "==", IVY.email).get())
    .docs[0]?.id;
  const stored = (await adminDb.doc(COLLECTIONS.userPreferences.docPath(uid ?? "")).get()).data();
  expect(stored).toMatchObject({
    channels: { inApp: true, email: true },
    digestFrequency: "weekly",
    quietHours: { start: "22:00", end: "07:00" },
    typeSwitches: { progressUpdate: false },
  });

  await page.goto("./#/search");
  await page.getByLabel("Search for").fill(ALPHA);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByTestId("search-record").first()).toContainText(ALPHA, { timeout: 20_000 });
  await page.getByLabel("Save this search as").fill("The Alpha study");
  await page.getByRole("button", { name: "Save the search" }).click();
  await expect(page.getByTestId("saved-search")).toContainText("The Alpha study", { timeout: 20_000 });
  await reviewPage(page, "search");

  // Opened from another search, the saved search puts its own text in the box.
  await page.getByLabel("Search for").fill("Flanker");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page).toHaveURL(/q=Flanker/);
  await page.getByTestId("saved-search").getByRole("link", { name: "The Alpha study" }).click();
  await expect(page).toHaveURL(new RegExp(`q=${ALPHA}`));
  await expect(page.getByLabel("Search for")).toHaveValue(ALPHA);

  // A removed search can be put back.
  await page.getByRole("button", { name: "Remove the saved search The Alpha study" }).click();
  const status = page.getByTestId("saved-search-status");
  await expect(status).toContainText("The saved search The Alpha study is removed.", { timeout: 20_000 });
  await expect(page.getByTestId("saved-search")).toHaveCount(0);
  await status.getByRole("button", { name: "Undo the removal of The Alpha study" }).click();
  await expect(page.getByTestId("saved-search")).toContainText("The Alpha study", { timeout: 20_000 });
});

test("an automation opens the quality-control task when the data of a dataset arrives, and logs its run", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const admin = await administratorBrowser(browser, baseURL as string);
  const lead = await leadBrowser(browser, baseURL as string);
  try {
    await admin.page.goto("./#/admin/automations");
    const rule = admin.page
      .getByTestId("automation-rule")
      .filter({ hasText: "Open a quality-control task when data arrives" });
    const ruleName = "Open a quality-control task when data arrives";
    await expect(rule.getByLabel(`On for ${ruleName}`, { exact: true })).toBeChecked({ timeout: 20_000 });
    // A change of limit is confirmed in the row, and the select is wide enough to read.
    await rule.getByLabel(`Replication that ${ruleName} is limited to`).selectOption(ALPHA);
    await expect(rule.getByRole("status")).toHaveText("Saved.", { timeout: 20_000 });
    await rule.getByLabel(`Replication that ${ruleName} is limited to`).selectOption("");
    await expect(rule.getByRole("status")).toHaveText("Saved.", { timeout: 20_000 });
    await reviewPage(admin.page, "automations");

    const page = lead.page;
    await page.goto("./#/datasets");
    await page.getByRole("button", { name: "Register a dataset" }).click();
    const dialog = page.getByRole("dialog", { name: "Register a dataset" });
    await dialog.getByLabel("Replication").selectOption(ALPHA);
    await dialog.getByLabel("Laboratory").selectOption({ label: "Demo Signal Laboratory" });
    await dialog.getByLabel("Title").fill("Automation check, main experiment (synthetic)");
    await dialog.getByLabel("Dataset key").fill(AUTOMATION_KEY);
    await dialog.getByLabel("Storage server").selectOption({ label: "Synthetic Munich EEG server (FTPS)" });
    await dialog.getByLabel("Path on the server").fill(MUNICH_PATH);
    await dialog.getByRole("button", { name: "Register the dataset" }).click();
    await expect(page.getByRole("heading", { level: 1, name: AUTOMATION_KEY })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("tab", { name: "Storage", exact: true }).click();
    await page.getByTestId("storage-refs").getByRole("button", { name: "Scan now" }).click();
    await expect(page.getByTestId("scan-result")).toContainText("present", { timeout: 30_000 });

    const tasks = await adminDb
      .collection(COLLECTIONS.tasks.collectionPath())
      .where("title", "==", `Quality control of ${AUTOMATION_KEY}`)
      .get();
    expect(tasks.size).toBe(1);
    expect(tasks.docs[0]?.get("writeContext")).toMatchObject({ origin: "user" });

    // The run is logged on the page of automations.
    await admin.page.reload();
    const run = admin.page
      .getByTestId("automation-run")
      .filter({ hasText: "Open a quality-control task when data arrives" })
      .first();
    await expect(run).toBeVisible({ timeout: 20_000 });
    await expect(run).not.toContainText("qcTaskOnArrival");
    await run.locator("summary").click();
    await expect(run).toContainText("Open a quality-control task: opened the quality-control task");
  } finally {
    await lead.context.close();
    await admin.context.close();
  }
});
