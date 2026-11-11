// Recruitment in the browser (D-009, D-019), against the synthetic world of `seed:demo`:
// acceptance scenario AS-4, in which a coordinator reports main-experiment and resting-state
// counts apart, the programme and replication dashboards update without counting a participant
// twice, and verified and reported values are both kept; acceptance scenario AS-5, in which a
// forecast recalculates from changed assumptions and recruitment at the end of a previous month
// is shown as it stood; the inline table of a lead; and the accessibility of each new page.
// Everyone here is invented, and every address uses the example.org domain.
import type { Page } from "@playwright/test";
import { administratorBrowser } from "./identity-support";
import { approveRole, CLEO, COGNITION_LAB, coordinatorBrowser, linkedBrowser, MEMORY_LAB } from "./laboratory-support";
import { expect, seriousFindings, test } from "./support";

/** The participation that the coordinator of the memory laboratory reports for, which has no reports in the world. */
const BETA_MEMORY = "DemoBeta2005__demo-lab-memory";
/** The participation whose recruitment has a history in the world, with a correction and a verification. */
const BETA_COGNITION = "DemoBeta2005__demo-lab-cognition";

/** The value a cell states, read from its data attribute, or null where it says the value is unknown. */
async function cellValue(page: Page, testId: string): Promise<string | null> {
  const cell = page.getByTestId(testId);
  await expect(cell).toBeVisible();
  return cell
    .locator("[data-value]")
    .first()
    .getAttribute("data-value", { timeout: 1_000 })
    .catch(() => null);
}

test("AS-4: a coordinator reports main experiment and resting state apart, the dashboards add nothing twice, and verified and reported values are both kept", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  // Cleo coordinates the memory laboratory, which takes part in DemoBeta2005 beside the cognition
  // laboratory, whose reports are in the world: main experiment 26 (25 verified), resting state 20
  // and 28 unique participants.
  const cleo = await coordinatorBrowser(browser, baseURL as string);
  const page = cleo.page;

  // The coordinator files one report with the three modalities in columns of their own.
  await page.goto(`./#/recruitment/participations/${BETA_MEMORY}`);
  await expect(
    page.getByRole("heading", { level: 1, name: `Recruitment: DemoBeta2005 at ${MEMORY_LAB.name}` }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("reported-main-tested")).toContainText("Unknown");
  await page.getByRole("button", { name: "File a report" }).click();
  const form = page.getByRole("dialog", { name: /File a report/ });
  await expect(form.getByRole("columnheader", { name: "Main experiment" })).toBeVisible();
  await expect(form.getByRole("columnheader", { name: "Resting state" })).toBeVisible();
  await expect(form.getByRole("columnheader", { name: "Unique participants" })).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);
  await form.getByTestId("count-main-tested").fill("7");
  await form.getByTestId("count-rest-tested").fill("5");
  await form.getByTestId("count-participants-tested").fill("9");
  await form.getByRole("button", { name: "File report" }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => cellValue(page, "reported-main-tested"), { timeout: 20_000 }).toBe("7");
  expect(await cellValue(page, "reported-rest-tested")).toBe("5");
  expect(await cellValue(page, "reported-participants-tested")).toBe("9");
  // A category the report did not state stays unknown, never zero.
  await expect(page.getByTestId("reported-main-usable")).toContainText("Unknown");
  await expect(page.getByTestId("verified-participants-tested")).toContainText("Unknown");

  // The laboratory: the rollup states 9 unique participants, never 7 + 5.
  await page.goto("./#/recruitment?modality=participants&category=tested&by=laboratory");
  await expect(page.getByTestId(`rollup-${MEMORY_LAB.id}`).locator("[data-value]")).toHaveAttribute("data-value", "9", {
    timeout: 20_000,
  });
  await page.getByLabel("Modality").selectOption({ label: "Main experiment" });
  await expect(page.getByTestId(`rollup-${MEMORY_LAB.id}`).locator("[data-value]")).toHaveAttribute("data-value", "7");
  await page.getByLabel("Modality").selectOption({ label: "Resting state" });
  await expect(page.getByTestId(`rollup-${MEMORY_LAB.id}`).locator("[data-value]")).toHaveAttribute("data-value", "5");
  expect(await seriousFindings(page)).toEqual([]);

  // The programme: the latest totals of the replication add the laboratories of each modality
  // apart, 28 + 9 unique participants and 26 + 7 in the main experiment, never main + rest.
  await page.goto("./#/recruitment?modality=participants&category=tested&by=replication");
  await expect(page.getByTestId("latest-reported-DemoBeta2005").locator("[data-value]")).toHaveAttribute(
    "data-value",
    "37",
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("rollup-DemoBeta2005").locator("[data-value]")).toHaveAttribute("data-value", "37");
  await page.getByLabel("Modality").selectOption({ label: "Main experiment" });
  await expect(page.getByTestId("latest-reported-DemoBeta2005").locator("[data-value]")).toHaveAttribute(
    "data-value",
    "33",
  );
  // The effective figure prefers the verified 25 of the cognition laboratory: 25 + 7.
  await expect(page.getByTestId("rollup-DemoBeta2005").locator("[data-value]")).toHaveAttribute("data-value", "32");

  // The dashboard of the replication shows each modality as a figure of its own.
  await page.goto("./#/replications/DemoBeta2005?tab=dashboard");
  await expect(
    page.getByRole("region", { name: "Tested, unique participants" }).getByTestId("kpi-value"),
  ).toContainText("37", { timeout: 30_000 });
  await expect(page.getByRole("region", { name: "Tested, main experiment" }).getByTestId("kpi-value")).toContainText(
    "32",
  );
  await expect(page.getByRole("region", { name: "Tested, resting state" }).getByTestId("kpi-value")).toContainText(
    "25",
  );

  // An administrator verifies the report: the verification is a new report beside the lab's.
  const admin = await administratorBrowser(browser, baseURL as string);
  await admin.page.goto(`./#/recruitment/participations/${BETA_MEMORY}`);
  const history = admin.page.getByTestId("report-history");
  await history.getByRole("button", { name: "Verify" }).click();
  const verification = admin.page.getByRole("dialog", { name: /Verify a report/ });
  // The cells start empty, with the lab's value beside each, so nothing is verified unchecked.
  await expect(verification.getByTestId("count-participants-tested")).toHaveValue("");
  await expect(verification.getByTestId("lab-participants-tested")).toContainText("Lab: 9");
  await verification.getByTestId("count-participants-tested").fill("8");
  await verification.getByRole("button", { name: "File verification" }).click();
  await expect(verification).toBeHidden({ timeout: 20_000 });
  await expect.poll(() => cellValue(admin.page, "verified-participants-tested"), { timeout: 20_000 }).toBe("8");
  expect(await cellValue(admin.page, "reported-participants-tested")).toBe("9");
  await expect(history.locator("li")).toHaveCount(2);

  // The coordinator sees both, and the totals keep the two bases apart.
  await page.goto(`./#/recruitment/participations/${BETA_MEMORY}`);
  await expect.poll(() => cellValue(page, "verified-participants-tested"), { timeout: 20_000 }).toBe("8");
  expect(await cellValue(page, "reported-participants-tested")).toBe("9");
  await page.goto("./#/recruitment?modality=participants&category=tested");
  await expect(page.getByTestId("latest-verified-DemoBeta2005").locator("[data-value]")).toHaveAttribute(
    "data-value",
    "8",
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("latest-reported-DemoBeta2005").locator("[data-value]")).toHaveAttribute(
    "data-value",
    "37",
  );
  await admin.context.close();
  await cleo.context.close();
});

test("AS-5: a forecast recalculates from changed assumptions, and recruitment at the end of a previous month is shown as it stood", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const cleo = await linkedBrowser(browser, baseURL as string, CLEO.email);
  await approveRole(CLEO.email, "replication_lead", "replication", "DemoBeta2005");
  const page = cleo.page;

  // The state at past dates: a September report was corrected, and the correction holds.
  await page.goto(`./#/recruitment/participations/${BETA_COGNITION}?asOf=2026-08-31`);
  await expect(page.getByTestId("as-of-heading")).toHaveText("Values as of 31 August 2026", { timeout: 20_000 });
  await expect.poll(() => cellValue(page, "reported-main-tested"), { timeout: 20_000 }).toBe("14");
  expect(await cellValue(page, "reported-rest-tested")).toBe("11");
  expect(await cellValue(page, "reported-participants-tested")).toBe("16");
  await page.getByTestId("participation-as-of").fill("2026-09-30");
  await expect(page.getByTestId("as-of-heading")).toHaveText("Values as of 30 September 2026");
  await expect.poll(() => cellValue(page, "reported-main-tested")).toBe("19");
  await expect(page.getByTestId("verified-main-tested")).toContainText("Unknown");
  await page.getByRole("button", { name: "End of last month" }).click();
  await expect.poll(() => cellValue(page, "reported-main-tested")).toBe("26");
  expect(await cellValue(page, "verified-main-tested")).toBe("25");
  await expect(page.locator('[data-standing="corrected"]')).toHaveCount(1);
  expect(await seriousFindings(page)).toEqual([]);

  // The programme page reconstructs the same date for its rollups.
  await page.goto("./#/recruitment?asOf=2026-08-31&modality=main&category=tested&by=laboratory");
  await expect(page.getByTestId("as-of-heading")).toHaveText("As of 31 August 2026", { timeout: 20_000 });
  await expect(page.getByTestId(`rollup-${COGNITION_LAB.id}`).locator("[data-value]")).toHaveAttribute(
    "data-value",
    "14",
  );

  // The forecast shows its assumptions beside its result and recalculates when one changes.
  await page.goto("./#/recruitment/forecast/DemoBeta2005");
  const assumptions = page.getByTestId("forecast-assumptions");
  await expect(assumptions).toBeVisible({ timeout: 20_000 });
  await assumptions.getByLabel("Reports up to").fill("2026-11-11");
  await expect(page.getByTestId("forecast-target")).toContainText("Unknown");
  await expect(page.getByTestId("completion-central")).toContainText("Not within five years");
  await page.getByTestId("assumption-target").fill("60");
  await expect(page.getByTestId("forecast-target")).toContainText("60");
  await expect(page.getByTestId("completion-central")).not.toContainText("Not within five years");
  const before = await page.getByTestId("completion-central").textContent();
  const aimBefore = await page.getByTestId("forecast-aim").textContent();
  await page.getByTestId("assumption-exclusion").fill("30");
  await expect(page.getByTestId("forecast-aim")).not.toHaveText(aimBefore ?? "");
  await expect(page.getByTestId("completion-central")).not.toHaveText(before ?? "");
  await expect(page.getByTestId("forecast-result").getByText("Projected", { exact: true })).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);
  await assumptions.getByRole("button", { name: "Store this forecast" }).click();
  await expect(page.getByTestId("stored-forecasts").locator("li")).toHaveCount(1, { timeout: 20_000 });
  await expect(page.getByTestId("stored-forecasts")).toContainText("Projected");
  await cleo.context.close();
});

test("a lead files one report for each changed row of the inline table", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const cleo = await linkedBrowser(browser, baseURL as string, CLEO.email);
  await approveRole(CLEO.email, "replication_lead", "replication", "DemoBeta2005");
  const page = cleo.page;
  await page.goto("./#/replications/DemoBeta2005?tab=recruitment");
  const table = page.getByTestId("inline-table");
  await expect(table).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("file-changed-rows")).toBeDisabled();
  await table.getByTestId("inline-input-demo-lab-memory-main").fill("3");
  await table.getByTestId("inline-input-demo-lab-memory-participants").fill("10");
  await table.getByTestId("inline-input-demo-lab-cognition-rest").fill("21");
  // A cell that holds no whole number is marked, and its row is not counted until it is put right.
  await table.getByTestId("inline-input-demo-lab-cognition-main").fill("abc");
  await expect(table.getByTestId("inline-input-demo-lab-cognition-main")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByTestId("file-changed-rows")).toHaveText("File 1 report");
  await table.getByTestId("inline-input-demo-lab-cognition-main").fill("");
  await expect(page.getByTestId("file-changed-rows")).toHaveText("File 2 reports");
  await page.getByTestId("file-changed-rows").click();
  await expect(page.getByTestId("file-changed-rows")).toHaveText("No changes to file", { timeout: 20_000 });
  await expect(table.getByTestId("inline-reported-demo-lab-memory-main").locator("[data-value]")).toHaveAttribute(
    "data-value",
    "3",
    { timeout: 20_000 },
  );
  await expect(
    table.getByTestId("inline-reported-demo-lab-memory-participants").locator("[data-value]"),
  ).toHaveAttribute("data-value", "10");
  await expect(table.getByTestId("inline-verified-demo-lab-cognition-rest")).toContainText("Unknown");
  await expect(table.getByTestId("inline-reported-demo-lab-cognition-rest").locator("[data-value]")).toHaveAttribute(
    "data-value",
    "21",
  );
  expect(await seriousFindings(page)).toEqual([]);
  await cleo.context.close();
});

test("the count categories say who is counted, and pass axe", async ({ browser, baseURL }) => {
  const cleo = await linkedBrowser(browser, baseURL as string, CLEO.email);
  const page = cleo.page;
  await page.goto("./#/recruitment/categories?replication=DemoAlpha2001");
  await expect(page.getByRole("heading", { level: 1, name: "Count categories" })).toBeVisible();
  await expect(page.getByText(/Participants whose validated recordings passed quality control/)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByText("Eyes closed, complete")).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);
  await cleo.context.close();
});

test("the pages of recruitment fit a screen 360 pixels wide without scrolling sideways", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const cleo = await linkedBrowser(browser, baseURL as string, CLEO.email);
  await approveRole(CLEO.email, "replication_lead", "replication", "DemoBeta2005");
  const page = cleo.page;
  await page.setViewportSize({ width: 360, height: 800 });
  for (const [address, ready] of [
    ["./#/recruitment", "as-of-heading"],
    [`./#/recruitment/participations/${BETA_COGNITION}`, "values-table"],
    ["./#/recruitment/forecast/DemoBeta2005", "forecast-assumptions"],
    ["./#/replications/DemoBeta2005?tab=recruitment", "inline-table"],
  ] as const) {
    await page.goto(address);
    await expect(page.getByTestId(ready)).toBeVisible({ timeout: 20_000 });
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, address).toBeLessThanOrEqual(0);
  }
  await cleo.context.close();
});
