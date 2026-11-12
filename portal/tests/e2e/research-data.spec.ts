// The dataset registry in the browser, against the synthetic world of `seed:demo` and the fake of
// the storage servers that the emulator's functions use (never a real server): acceptance
// scenario AS-8, in which an authorised researcher registers an EEG dataset held on a Munich
// server and sees its metadata, its path, its BIDS and its QC status with no central transfer
// and no dependence on ElectroTag; the outage of that server and its recovery, which leave the
// registry usable from the last listing (part of acceptance scenario 15); and the accessibility
// of each new page at every width the portal supports. Everything here is invented, on the
// example.org domain.
import { COLLECTIONS } from "@eegml/shared";
import type { Page } from "@playwright/test";
import { emulatorStorageFake } from "../../functions/src/integrations/storage/fake";
import { FAKE_SERVERS } from "../../functions/src/integrations/storage/fixtures";
import { DEMO_DATASET } from "../../tools/src/fixtures/demo-world";
import { adminDb } from "../support/admin";
import { reviewPage } from "./identity-support";
import { ALPHA, leadBrowser } from "./registry-support";
import { expect, test } from "./support";

const NEW_KEY = "DemoAlpha2001-demo-signal-lab-main";
const MUNICH_PATH = "DemoAlpha2001/signal-main";

/** A bids-validator report of the 1.x series, written by hand for this test, about invented participants. */
const SYNTHETIC_REPORT = JSON.stringify({
  issues: {
    errors: [
      {
        key: "EEG_SAMPLING_FREQUENCY_MISSING",
        reason: "Synthetic: SamplingFrequency is required.",
        files: [{ file: { relativePath: "/sub-01/eeg/sub-01_task-flanker_eeg.json" } }],
      },
    ],
    warnings: [],
  },
  summary: { subjects: ["01", "02"], sessions: [], tasks: ["flanker"], modalities: ["EEG"], totalFiles: 9, size: 1 },
});

async function showTab(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
}

test("AS-8: a researcher registers a dataset held on a Munich server, with its metadata, path, BIDS and QC status, no central transfer and no ElectroTag", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const page = lead.page;
  const fake = emulatorStorageFake();
  try {
    // The registry lists the dataset of the world, with the pipeline of the programme.
    await page.goto("./#/datasets");
    await expect(page.getByRole("heading", { level: 1, name: "Datasets" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("dataset-pipeline")).toBeVisible();
    await expect(page.getByTestId("datasets-table")).toContainText(DEMO_DATASET.key);
    await reviewPage(page, "datasets");

    // The lead registers a dataset of the signal laboratory on the Munich server.
    await page.getByRole("button", { name: "Register a dataset" }).click();
    const dialog = page.getByRole("dialog", { name: "Register a dataset" });
    await dialog.getByLabel("Replication").selectOption(ALPHA);
    await dialog.getByLabel("Laboratory").selectOption({ label: "Demo Signal Laboratory" });
    await dialog.getByLabel("Title").fill("Flanker task, main experiment, Munich (synthetic)");
    await dialog.getByLabel("Metadata").fill("Amplifier: Synthetic amplifier\nSampling rate: 1000");
    await dialog.getByLabel("Storage server").selectOption({ label: "Synthetic Munich EEG server (FTPS)" });
    await dialog.getByLabel("Path on the server").fill(MUNICH_PATH);
    await reviewPage(page, "datasets-register");
    await dialog.getByRole("button", { name: "Register the dataset" }).click();
    await expect(page.getByRole("heading", { level: 1, name: NEW_KEY })).toBeVisible({ timeout: 20_000 });

    // The overview shows the metadata, the first state and the statuses, and no path.
    await expect(page.getByRole("main")).toContainText("Received");
    await expect(page.getByRole("main")).toContainText("Synthetic amplifier");
    await expect(page.getByRole("main")).not.toContainText(MUNICH_PATH);
    await reviewPage(page, "dataset-overview");

    // The copy on the Munich server is scanned: the files are listed there, and nothing is moved.
    await showTab(page, "Storage");
    const copies = page.getByTestId("storage-refs");
    await expect(copies).toContainText("Synthetic Munich EEG server");
    await expect(copies).toContainText("Not yet checked");
    await copies.getByRole("button", { name: "Scan now" }).click();
    await expect(page.getByTestId("scan-result")).toContainText("9 present", { timeout: 30_000 });
    await expect(copies).toContainText("Available");
    // No viewer is offered: the copy declares none, and nothing depends on one.
    await expect(page.getByRole("button", { name: /ElectroTag/ })).toHaveCount(0);
    await reviewPage(page, "dataset-storage");

    // The path is shown to the lead on request, and the request is recorded.
    await copies.getByRole("button", { name: "Show the location" }).click();
    const location = page.getByRole("dialog", { name: "Where this copy is held" });
    await expect(location.getByTestId("storage-location")).toContainText(MUNICH_PATH, { timeout: 20_000 });
    await expect(location).toContainText(FAKE_SERVERS.munich);
    await location.getByRole("button", { name: "Close" }).click();
    const reads = await adminDb.collection(COLLECTIONS.datasetAccessEvents.collectionPath(NEW_KEY)).get();
    expect(reads.docs.map((read) => read.get("action")).sort()).toEqual(["viewConnection", "viewLocation"]);

    // The files of the listing, with what each is.
    await showTab(page, "Files");
    await expect(page.getByTestId("manifest-files")).toContainText("sub-01_task-flanker_eeg.eeg");
    await reviewPage(page, "dataset-files");

    // A bids-validator report run next to the data is imported.
    await showTab(page, "BIDS");
    await page.getByRole("button", { name: "Import a validation report" }).click();
    const report = page.getByRole("dialog", { name: "Import a validation report" });
    await report.getByLabel("Or paste the report").fill(SYNTHETIC_REPORT);
    await report.getByLabel("Version of the validator").fill("1.14.0");
    await report.getByRole("button", { name: "Import the report" }).click();
    await expect(report).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole("main")).toContainText("1 errors, 0 warnings");
    await expect(page.getByTestId("bids-issues")).toContainText("EEG_SAMPLING_FREQUENCY_MISSING");
    await reviewPage(page, "dataset-bids");

    // Arrival opened the quality-control task, and the lead records an assessment.
    await showTab(page, "Quality control");
    await page.getByRole("button", { name: "Record a quality assessment" }).click();
    const quality = page.getByRole("dialog", { name: "Record a quality assessment" });
    await quality.getByLabel("Pipeline", { exact: true }).fill("Synthetic pipeline");
    await quality.getByLabel("Pipeline version").fill("2026.1");
    await quality.getByLabel("Parameters").fill("High pass: 0.1");
    await quality.getByRole("button", { name: "Record the assessment" }).click();
    await expect(quality).toBeHidden({ timeout: 20_000 });
    await expect(page.getByTestId("qc-assessments")).toContainText("Synthetic pipeline");
    await expect(page.getByRole("main")).toContainText("QC passed");
    await reviewPage(page, "dataset-quality");

    // The workflow moves the dataset on, with its history.
    await showTab(page, "Overview");
    await page.getByRole("button", { name: "Change the state" }).click();
    const state = page.getByRole("dialog", { name: "Change the state" });
    await state.getByLabel("New state").selectOption({ label: "Integrity checked" });
    await state.getByLabel("Reason").fill("All files listed with their checksums.");
    await state.getByRole("button", { name: "Change the state" }).click();
    await expect(state).toBeHidden({ timeout: 20_000 });
    await showTab(page, "History");
    await expect(page.getByTestId("dataset-history")).toContainText("Received to Integrity checked");

    // The record holds no participant identity and no path, and nothing was transferred.
    const stored = (await adminDb.doc(COLLECTIONS.datasets.docPath(NEW_KEY)).get()).data();
    expect(JSON.stringify(stored)).not.toContain(MUNICH_PATH);
    expect(stored).toMatchObject({ bidsStatus: "invalid", qcStatus: "passed", availability: "available" });
    expect((await adminDb.collection(COLLECTIONS.datasetTransfers.collectionPath(NEW_KEY)).get()).size).toBe(0);
    const task = await adminDb
      .collection(COLLECTIONS.tasks.collectionPath())
      .where("title", "==", `Quality control of ${NEW_KEY}`)
      .get();
    expect(task.size).toBe(1);

    // The replication lists the dataset in its tab of datasets.
    await page.goto(`./#/replications/${ALPHA}?tab=datasets`);
    await expect(page.getByTestId("datasets-table")).toContainText(NEW_KEY, { timeout: 20_000 });
    await reviewPage(page, "replication-datasets");
  } finally {
    fake.setMode(FAKE_SERVERS.munich, "up");
    await lead.context.close();
  }
});

test("a server outage leaves the registry usable from the last listing, and the copy recovers when the server answers again", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const page = lead.page;
  const fake = emulatorStorageFake();
  try {
    await page.goto(`./#/datasets/${DEMO_DATASET.key}?tab=storage`);
    const copies = page.getByTestId("storage-refs");
    await expect(copies).toContainText("Synthetic Bremen EEG server", { timeout: 20_000 });
    await copies.getByRole("button", { name: "Scan now" }).click();
    await expect(page.getByTestId("scan-result")).toContainText("12 present", { timeout: 30_000 });

    // The Bremen server goes down. The scan says so, the copy is unavailable, and the last
    // listing and the time the copy was last seen stay.
    fake.setMode(FAKE_SERVERS.bremen, "down");
    await copies.getByRole("button", { name: "Scan now" }).click();
    await expect(page.getByTestId("scan-result")).toContainText("The server did not answer", { timeout: 30_000 });
    await expect(copies).toContainText("Unavailable");
    await expect(copies).toContainText("Server did not answer");
    await expect(copies).not.toContainText("Never");
    await showTab(page, "Files");
    await expect(page.getByTestId("manifest-files")).toContainText("sub-03_task-flanker_eeg.eeg");
    await expect(page.getByTestId("manifest-files")).not.toContainText("Missing");
    await reviewPage(page, "dataset-outage");

    // The storage servers page shows the server as unreachable, with the time it was last seen.
    await page.goto("./#/datasets/servers");
    await expect(page.getByTestId("storage-servers")).toContainText("Unreachable", { timeout: 20_000 });
    await reviewPage(page, "storage-servers");

    // The server answers again, and the next scan restores the copy and the server.
    fake.setMode(FAKE_SERVERS.bremen, "up");
    await page.goto(`./#/datasets/${DEMO_DATASET.key}?tab=storage`);
    await page.getByTestId("storage-refs").getByRole("button", { name: "Scan now" }).click();
    await expect(page.getByTestId("scan-result")).toContainText("12 present", { timeout: 30_000 });
    await expect(page.getByTestId("storage-refs")).toContainText("Available");
    await expect
      .poll(async () => (await adminDb.doc(COLLECTIONS.storageEndpoints.docPath("bremen-sftp")).get()).get("status"))
      .toBe("active");
  } finally {
    fake.setMode(FAKE_SERVERS.bremen, "up");
    await lead.context.close();
  }
});
