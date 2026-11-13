// The scientific workflows of a replication in the browser (phase 8), against the synthetic world
// of `seed:demo` and the fake of OSF that the emulator's functions use (never the real OSF): a
// lead prepares the authorship list of a report and a contributor confirms her own entry; a
// Stage 1 Registered Report is followed to its Stage 2 report through an OSF page, events and a
// milestone; an analysis run is recorded against a dataset of the registry and its provenance is
// exported; an incident is reported and given a corrective action; and a risk is entered in the
// register, rated, given an owner and closed. Each new page is checked
// for accessibility at every width the portal supports. Everything here is invented, on the
// example.org domain.
import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { FAKE_OSF } from "../../functions/src/integrations/osf/fake";
import { DEMO_DATASET } from "../../tools/src/fixtures/demo-world";
import { reviewPage } from "./identity-support";
import { ALPHA, BEN, IVY, leadBrowser, signInAsIvy } from "./registry-support";
import { expect, test } from "./support";

const STAGE_1 = "Demonstration study Alpha: a synthetic stage 1 registered report";

async function openTab(page: Page, name: string): Promise<void> {
  await page.goto(`./#/replications/${ALPHA}`);
  await expect(page.getByRole("heading", { level: 1, name: ALPHA })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("tab", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
}

test("a lead prepares the authorship list of a report and a contributor confirms her own entry", async ({
  browser,
  baseURL,
  page,
}) => {
  test.setTimeout(240_000);
  const lead = await leadBrowser(browser, baseURL as string);
  try {
    const ben = lead.page;
    await openTab(ben, "Outputs");
    await expect(ben.getByRole("table", { name: "Outputs of the replication" })).toContainText(STAGE_1);
    await ben.getByRole("button", { name: `Open ${STAGE_1}` }).click();
    const authorship = ben.getByTestId("authorship");
    await expect(authorship).toContainText("Not prepared");

    // The list starts from the contributor table of the report, and Ivy is added from the directory.
    await authorship.getByRole("button", { name: "Prepare from the contributor table" }).click();
    await expect(authorship.getByLabel("Name as published").first()).toHaveValue("Ben Sample");
    await authorship.getByLabel("Add a person from the directory").selectOption({ label: IVY.name });
    await authorship.getByRole("button", { name: "Add the person" }).click();
    await authorship.getByLabel(`Affiliations of ${IVY.name}`).fill("Ridgeway Example Institute");
    await authorship
      .getByRole("group", { name: `Roles of ${IVY.name} in the replication` })
      .getByLabel("Data collection")
      .check();
    await authorship
      .getByRole("group", { name: `CRediT roles of ${IVY.name}` })
      .getByLabel("Investigation")
      .check();
    await authorship.getByLabel("Ordering rule").selectOption("leadsFirstThenAlphabetical");
    await reviewPage(ben, "authorship-editor");
    await authorship.getByRole("button", { name: "Save and ask for confirmation" }).click();
    const entries = authorship.getByTestId("authorship-entries");
    await expect(entries).toContainText(IVY.name, { timeout: 20_000 });
    await expect(authorship).toContainText("In review, 0 of 3 confirmed");

    // Ivy answers her own entry from Home, without reading the rest of the list.
    await signInAsIvy(page);
    await page.goto("./#/");
    const panel = page.getByTestId("authorship-panel");
    await expect(panel).toContainText(STAGE_1, { timeout: 20_000 });
    await expect(panel).toContainText("Data collection");
    await expect(panel).toContainText("Investigation");
    await expect(panel).not.toContainText("Eli Madeup");
    await reviewPage(page, "home-authorship");
    await panel.getByRole("button", { name: `Confirm my entry on ${STAGE_1}` }).click();
    await expect(panel.getByTestId("authorship-entry")).toContainText("Confirmed", { timeout: 20_000 });

    // The lead sees the confirmation, and exports the list for the journal.
    await expect(entries.getByRole("listitem").filter({ hasText: IVY.name })).toContainText("Confirmed", {
      timeout: 20_000,
    });
    await expect(authorship).toContainText("1 of 3 confirmed");
    const download = ben.waitForEvent("download");
    await authorship.getByRole("button", { name: "Export for the journal" }).click();
    const text = await readFile(await (await download).path(), "utf8");
    expect(text).toContain(IVY.name);
    expect(text).toContain("Ridgeway Example Institute");
    // Leads first, then alphabetical by surname: the lead heads the author line, as in the editor.
    expect(text).toMatch(/Authors\nBen Sample\b[^\n]*, Eli Madeup\b[^\n]*, Ivy Pretend\b/);
    await expect(entries.getByRole("listitem").first()).toContainText("1. Ben Sample");
  } finally {
    await lead.context.close();
  }
});

test("a laboratory's team is chosen and acknowledges the protocol it follows, which makes it compliant", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const page = lead.page;
  try {
    await openTab(page, "Protocol");
    const attention = page.getByRole("row").filter({ hasText: "Demo Attention Laboratory" });
    await expect(attention).toContainText("Awaiting acknowledgement", { timeout: 20_000 });
    await expect(attention).toContainText("0 of 2");
    await expect(attention.getByLabel("Protocol that Demo Attention Laboratory follows")).toHaveValue(
      "demo-protocol-alpha",
    );

    // Ben, on the team, acknowledges the approved version in his own name.
    await attention
      .getByRole("button", { name: "Acknowledge the current version for Demo Attention Laboratory" })
      .click();
    await expect(attention).toContainText("1 of 2", { timeout: 20_000 });

    // The team is managed from the same row: Eli leaves it, and the laboratory is compliant.
    await attention.getByRole("button", { name: "Team of Demo Attention Laboratory" }).click();
    const team = page.getByRole("dialog", { name: "Team of Demo Attention Laboratory" });
    await expect(team.getByTestId("team-members")).toContainText("Eli Madeup");
    await reviewPage(page, "protocol-team-dialog");
    await team.getByRole("button", { name: "Remove Eli Madeup" }).click();
    await expect(team.getByTestId("team-members")).not.toContainText("Eli Madeup", { timeout: 20_000 });
    await team.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(team).toBeHidden();
    await expect(attention).toContainText("Compliant", { timeout: 20_000 });
    await expect(attention).toContainText("1 of 1");

    // Eli comes back as the analyst, whose acknowledgement is awaited again.
    await attention.getByRole("button", { name: "Team of Demo Attention Laboratory" }).click();
    await team.getByLabel("Person of the laboratory").selectOption({ label: "Eli Madeup" });
    await team.getByLabel("Role", { exact: true }).selectOption("analyst");
    await team.getByRole("button", { name: "Add to the team" }).click();
    await expect(team.getByTestId("team-members")).toContainText("Eli Madeup", { timeout: 20_000 });
    await team.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(team).toBeHidden();
    await expect(attention).toContainText("1 of 2", { timeout: 20_000 });

    // The second laboratory is told which protocol to follow; it has no team yet.
    const signal = page.getByRole("row").filter({ hasText: "Demo Signal Laboratory" });
    await expect(signal).toContainText("No protocol named");
    await signal
      .getByLabel("Protocol that Demo Signal Laboratory follows")
      .selectOption({ label: "Demonstration protocol (synthetic)" });
    await expect(signal).toContainText("No team recorded", { timeout: 20_000 });
    await reviewPage(page, "protocol");
  } finally {
    await lead.context.close();
  }
});

test("a Stage 1 Registered Report is followed to its Stage 2 report with an OSF page, events and a milestone", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const page = lead.page;
  try {
    // A task list of the replication, which the milestones of its outputs are planned in.
    await page.goto("./#/tasks");
    await page.getByRole("button", { name: "New list" }).click();
    const listDialog = page.getByRole("dialog", { name: "New task list" });
    await listDialog.getByLabel("Name").fill("Publication plan (synthetic)");
    await listDialog.getByLabel("Belongs to").selectOption({ label: `Replication ${ALPHA}` });
    await listDialog.getByRole("button", { name: "Create the list" }).click();
    await expect(page.getByRole("heading", { level: 2, name: "Publication plan (synthetic)" })).toBeVisible({
      timeout: 20_000,
    });

    await openTab(page, "Registered Reports");
    const stage1 = page.getByRole("article", { name: STAGE_1 });
    await expect(stage1).toContainText("In-principle acceptance");
    await expect(stage1).toContainText("Not started");

    // The registration of the Stage 1 report on OSF is linked and checked through the fake of OSF.
    await stage1.getByRole("button", { name: "Link a document" }).click();
    const link = page.getByRole("dialog", { name: "Link a document" });
    await link.getByLabel("Address").fill(`https://osf.io/${FAKE_OSF.stage1Registration}/`);
    await link.getByLabel("Title").fill("Stage 1 registration (synthetic)");
    await link.getByRole("button", { name: "Link the document" }).click();
    await expect(stage1).toContainText("Stage 1 registration (synthetic)", { timeout: 20_000 });
    await stage1.getByRole("button", { name: "Check on OSF Stage 1 registration (synthetic)" }).click();
    await expect(stage1).toContainText("checked", { timeout: 20_000 });

    // A registration that has been withdrawn on OSF is marked so and raised, though it stays public.
    await stage1.getByRole("button", { name: "Link a document" }).click();
    await link.getByLabel("Address").fill(`https://osf.io/${FAKE_OSF.withdrawnRegistration}/`);
    await link.getByLabel("Title").fill("Withdrawn registration (synthetic)");
    await link.getByRole("button", { name: "Link the document" }).click();
    await expect(stage1).toContainText("Withdrawn registration (synthetic)", { timeout: 20_000 });
    await stage1.getByRole("button", { name: "Check on OSF Withdrawn registration (synthetic)" }).click();
    await expect(stage1).toContainText("Withdrawn on OSF", { timeout: 20_000 });
    await expect(page.getByTestId("reports-attention")).toContainText("Withdrawn registration (synthetic)");

    // The Stage 2 report follows the Stage 1 report.
    const stage2Title = "Demonstration study Alpha: the synthetic stage 2 report";
    await page.getByRole("button", { name: "New Registered Report" }).click();
    const create = page.getByRole("dialog", { name: "New Registered Report" });
    await create.getByLabel("Title").fill(stage2Title);
    await create.getByLabel("Kind").selectOption("stage2Rr");
    await create.getByLabel("Stage 1 report").selectOption({ label: STAGE_1 });
    await create.getByRole("button", { name: "Create the output" }).click();
    const stage2 = page.getByRole("article", { name: stage2Title });
    await expect(stage2).toContainText("Planned", { timeout: 20_000 });
    await expect(stage2).toContainText(STAGE_1);
    await expect(stage1).toContainText(stage2Title);

    // Its acceptance is planned as a milestone of the task list.
    await stage2.getByRole("button", { name: "Plan a milestone" }).click();
    const milestone = page.getByRole("dialog", { name: "Plan a milestone" });
    await milestone.getByLabel("Milestone").selectOption("acceptance");
    await milestone.getByLabel("Task list").selectOption({ label: "Publication plan (synthetic)" });
    await milestone.getByLabel("Planned date").fill("2027-06-30");
    await milestone.getByRole("button", { name: "Plan the milestone" }).click();
    await expect(stage2.getByRole("region", { name: `Milestones of ${stage2Title}` })).toContainText(
      "planned for 30 June 2027",
      { timeout: 20_000 },
    );

    // Submission, a review round with a decision, and the acceptance, which reaches the milestone.
    const record = async (kind: string, extra?: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>) => {
      await stage2.getByRole("button", { name: "Record an event" }).click();
      const dialog = page.getByRole("dialog", { name: "Record an event" });
      await dialog.getByLabel("Event").selectOption(kind);
      if (extra !== undefined) await extra(dialog);
      await dialog.getByRole("button", { name: "Record the event" }).click();
      await expect(dialog).toBeHidden({ timeout: 20_000 });
    };
    await record("submission");
    await expect(stage2).toContainText("Submitted");
    await record("decision", async (dialog) => {
      await dialog.getByLabel("Outcome").selectOption("minorRevision");
      await dialog.getByLabel("Round").fill("1");
    });
    await expect(stage2.getByTestId("output-events")).toContainText("Decision, round 1: minor revision");
    await record("acceptance");
    await expect(stage2.getByRole("region", { name: `Milestones of ${stage2Title}` })).toContainText("reached on", {
      timeout: 20_000,
    });
    await reviewPage(page, "registered-reports");
  } finally {
    await lead.context.close();
  }
});

test("an analysis run is recorded against a dataset of the registry and its provenance is exported", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const page = lead.page;
  try {
    await openTab(page, "Analysis");
    await expect(page.getByText("No analysis runs yet")).toBeVisible();
    await page.getByRole("button", { name: "Record an analysis run" }).click();
    const dialog = page.getByRole("dialog", { name: "Record an analysis run" });
    await dialog.getByLabel("Title").fill("Main ERP analysis (synthetic)");
    await dialog.getByLabel("Kind").selectOption("analysis");
    await dialog.getByLabel("Pipeline", { exact: true }).fill("synthetic-erp-pipeline");
    await dialog.getByLabel("Pipeline version").fill("1.2.0");
    await dialog.getByLabel("Code repository").fill("https://code.example.org/demo/erp");
    await dialog.getByLabel("Commit").fill("a1b2c3d4e5f6");
    await dialog.getByLabel("Parameters").fill("filter: 0.1-30 Hz");
    await dialog.getByLabel("Status").selectOption("succeeded");
    await dialog.getByLabel("Dataset to add").selectOption(DEMO_DATASET.key);
    await dialog.getByRole("button", { name: "Add the dataset" }).click();
    await expect(dialog.getByRole("button", { name: `Remove ${DEMO_DATASET.key}` })).toBeVisible();
    await dialog.getByLabel("Outputs").fill("Grand average | figure | https://files.example.org/demo/ga.png");
    await reviewPage(page, "analysis-run-dialog");
    await dialog.getByRole("button", { name: "Save the run" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    const panel = page.getByRole("tabpanel");
    await expect(panel).toContainText("Main ERP analysis (synthetic)", { timeout: 20_000 });
    await expect(panel).toContainText(DEMO_DATASET.key);
    await reviewPage(page, "analysis");

    // The provenance names the run, the dataset it used and what it generated.
    const download = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Export provenance (JSON-LD)" }).click();
    const provenanceFile = await download;
    expect(provenanceFile.suggestedFilename()).toBe(`${ALPHA}-main-erp-analysis-synthetic-provenance.jsonld`);
    const provenance = JSON.parse(await readFile(await provenanceFile.path(), "utf8")) as Record<string, unknown>;
    const text = JSON.stringify(provenance);
    // The agent is Ben, the person, never his account, and the dataset says it is demonstration data.
    expect(text).toContain(`urn:eegml:person:${BEN.personId}`);
    expect(text).not.toContain("urn:eegml:account");
    expect(text).toContain('"eegml:dataOrigin":"demo"');
    expect(provenance["@context"]).toBeDefined();
    expect(text).toContain(DEMO_DATASET.key);
    expect(text).toContain("a1b2c3d4e5f6");
    expect(text).toContain("Grand average");

    const bundle = page.waitForEvent("download");
    await panel.getByRole("button", { name: "Export bundle manifest" }).click();
    const manifest = JSON.parse(await readFile(await (await bundle).path(), "utf8")) as {
      format?: string;
      origins?: string[];
    };
    expect(manifest.format).toBe("eegml-reproducibility-bundle/1");
    expect(manifest.origins).toEqual(["demo"]);
    // A run that succeeded without a finishing time recorded has finished, which the table says.
    await expect(panel.getByRole("row").filter({ hasText: "Main ERP analysis (synthetic)" })).toContainText(
      "Not recorded",
    );
  } finally {
    await lead.context.close();
  }
});

test("an incident is reported and given a corrective action, and its record never changes", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const page = lead.page;
  try {
    await openTab(page, "Incidents");
    await expect(page.getByText("No incidents reported")).toBeVisible();
    await page.getByRole("button", { name: "Report an incident" }).click();
    const dialog = page.getByRole("dialog", { name: "Report an incident" });
    await dialog.getByLabel("Laboratory").selectOption({ label: "Demo Attention Laboratory" });
    await dialog.getByLabel("Title").fill("Amplifier dropout (synthetic)");
    await dialog.getByLabel("What happened").fill("Two synthetic sessions lost their reference channel.");
    await dialog.getByLabel("Severity").selectOption("medium");
    await dialog.getByLabel("Date it happened").fill("2026-10-01");
    await reviewPage(page, "incident-dialog");
    await dialog.getByRole("button", { name: "Report the incident" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    const incident = page
      .getByTestId("incidents")
      .getByRole("listitem")
      .filter({ hasText: "Amplifier dropout (synthetic)" });
    await expect(incident).toContainText("Open", { timeout: 20_000 });
    await expect(incident).toContainText("None recorded yet.");

    await incident.getByRole("button", { name: "Add a corrective action" }).click();
    const action = page.getByRole("dialog", { name: "Add a corrective action" });
    await action.getByLabel("Corrective action").fill("Replace the reference cable and rerun the two sessions.");
    await action.getByLabel("Due by").fill("2026-11-30");
    await action.getByRole("button", { name: "Record" }).click();
    await expect(action).toBeHidden({ timeout: 20_000 });
    await expect(
      incident.getByRole("region", { name: "Corrective actions of Amplifier dropout (synthetic)" }),
    ).toContainText("Replace the reference cable", { timeout: 20_000 });

    await incident.getByRole("button", { name: "Change the status" }).click();
    const status = page.getByRole("dialog", { name: "Change the status" });
    await status.getByLabel("New status").selectOption("resolved");
    await status.getByRole("button", { name: "Record" }).click();
    await expect(incident).toContainText("Resolved", { timeout: 20_000 });
    await expect(incident).toContainText("Two synthetic sessions lost their reference channel.");
    await reviewPage(page, "incidents");
  } finally {
    await lead.context.close();
  }
});

test("a lead enters a risk in the register of a replication, rates it, names its owner and closes it", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const page = lead.page;
  try {
    await openTab(page, "Risks");
    await expect(page.getByText("No risks in the register")).toBeVisible();
    await page.getByRole("button", { name: "Add a risk" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a risk" });
    await dialog.getByLabel("Title").fill("Too few EEG caps for the autumn sessions (synthetic)");
    await dialog.getByLabel("Likelihood").selectOption("high");
    await dialog.getByLabel("Impact").selectOption("medium");
    await dialog.getByLabel("Mitigation").fill("Order two synthetic cap sets in July.");
    await dialog.getByLabel("Owner").selectOption({ label: IVY.name });
    await dialog.getByLabel("Next review").fill("2027-01-15");
    await reviewPage(page, "risk-dialog");
    await dialog.getByRole("button", { name: "Add the risk" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    const risk = page
      .getByTestId("risks")
      .getByRole("listitem")
      .filter({ hasText: "Too few EEG caps for the autumn sessions (synthetic)" });
    await expect(risk).toContainText("Likelihood: high", { timeout: 20_000 });
    await expect(risk).toContainText("Impact: medium");
    await expect(risk).toContainText(`Owner: ${IVY.name}`);
    await expect(risk).toContainText("Next review on 15 January 2027");
    await reviewPage(page, "risks");

    // Closing the risk records when; it stays in the register, last.
    await risk
      .getByRole("button", { name: "Change the risk Too few EEG caps for the autumn sessions (synthetic)" })
      .click();
    const change = page.getByRole("dialog", { name: "Change a risk" });
    await expect(change.getByLabel("Mitigation")).toHaveValue("Order two synthetic cap sets in July.");
    await change.getByLabel("Status").selectOption("closed");
    await change.getByRole("button", { name: "Save the risk" }).click();
    await expect(change).toBeHidden({ timeout: 20_000 });
    await expect(risk).toContainText("Closed on", { timeout: 20_000 });
  } finally {
    await lead.context.close();
  }
});
