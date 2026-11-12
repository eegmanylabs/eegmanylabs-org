// The Google Workspace integration in the browser, against the synthetic world of `seed:demo` and
// the fake of Google that the emulator's functions use (never Google itself): acceptance scenario
// AS-10, in which an administrator approves live writes for the laboratory directory, an edit in
// the sheet reaches the laboratory, and a conflicting edit on both sides is resolved on the
// conflicts screen with an audit trail; the synchronisation half of AS-3, in which a changed
// equipment configuration reaches the equipment register; acceptance scenario AS-9, in which a
// generated Google Doc keeps the text people wrote around its managed sections and a hand edit of
// the designated field is taken into the record; linking, browsing and previewing a Drive folder;
// and the accessibility of each new page. Everything here is invented, on the example.org domain.
import { COLLECTIONS } from "@eegml/shared";
import type { Page } from "@playwright/test";
import { FAKE_ACCOUNT, FAKE_FILES, HUMAN_TEXT } from "../../functions/src/integrations/google/fake/fixtures";
import { DIRECTORY_MAPPING, EQUIPMENT_MAPPING, workspaceFake } from "../functions/integrations-world";
import { adminAuth, adminDb } from "../support/admin";
import { ADMIN_EMAIL, administratorBrowser, reviewPage } from "./identity-support";
import { leadBrowser } from "./registry-support";
import { expect, seriousFindings, test } from "./support";

/** The columns of the laboratory directory and of the equipment register in the fake. */
const CITY = 2;
const WEBSITE = 3;
const CHANNELS = 3;
const ATTENTION_ROW = "demo-attention-lab:demo-equipment-attention-1";

const UNSETTLED = new Set(["queued", "running", "retrying"]);

/** Waits until a mapping has been run at least the given number of times and no run of it waits or runs. */
async function settledRuns(mappingId: string, atLeast = 1): Promise<void> {
  await expect
    .poll(
      async () => {
        const runs = await adminDb
          .collection(COLLECTIONS.syncRuns.collectionPath())
          .where("mappingId", "==", mappingId)
          .get();
        return runs.size >= atLeast && runs.docs.every((run) => !UNSETTLED.has(String(run.get("status"))));
      },
      { timeout: 30_000, message: `the runs of ${mappingId}` },
    )
    .toBe(true);
}

/** Checks a page at the narrowest width the portal supports: no serious axe finding and no sideways scroll. */
async function narrowCheck(page: Page, name: string): Promise<void> {
  const original = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 780 });
  expect(await seriousFindings(page), `${name} at 360px`).toEqual([]);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
      message: `${name} scrolls sideways at 360px`,
    })
    .toBeLessThanOrEqual(0);
  if (original !== null) await page.setViewportSize(original);
}

async function laboratoryField(id: string, field: string): Promise<unknown> {
  return (await adminDb.doc(COLLECTIONS.laboratories.docPath(id)).get()).get(field);
}

async function auditEntries(action: string) {
  return (await adminDb.collection(COLLECTIONS.auditEvents.collectionPath()).where("action", "==", action).get()).docs;
}

test("AS-10: an administrator approves live writes, a sheet edit reaches the laboratory, and a conflict is resolved with an audit trail", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const admin = await administratorBrowser(browser, baseURL as string);
  const page = admin.page;
  const fake = workspaceFake();
  const directory = FAKE_FILES.laboratoryDirectory;
  try {
    // The fake is connected, and the page says it is a synthetic fake.
    await page.goto("./#/admin/integrations");
    await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("fake-notice")).toBeVisible();
    await expect(page.getByTestId("integration-health")).toBeVisible();
    await reviewPage(page, "integrations-overview");
    await narrowCheck(page, "integrations-overview");

    // The directory starts as a dry run. The administrator approves live writes and runs it.
    await page.getByRole("tab", { name: "Mappings" }).click();
    const row = page.getByTestId("mapping-row").filter({ hasText: "Laboratory directory" });
    await expect(row).toContainText("Dry run");
    await row.getByRole("button", { name: "Approve live writes for Laboratory directory" }).click();
    const approval = page.getByRole("dialog", { name: "Approve live writes to this sheet?" });
    await approval.getByRole("button", { name: "Approve live writes" }).click();
    await expect(approval).toBeHidden({ timeout: 20_000 });
    await expect(row).toContainText("Live");
    expect((await adminDb.doc(COLLECTIONS.syncMappings.docPath(DIRECTORY_MAPPING)).get()).get("approvedAt")).not.toBe(
      null,
    );
    await row.getByRole("button", { name: "Run now Laboratory directory" }).click();
    await settledRuns(DIRECTORY_MAPPING);
    await reviewPage(page, "integrations-mappings");
    await narrowCheck(page, "integrations-mappings");
    await page.getByRole("tab", { name: "Jobs" }).click();
    await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
    await page.getByLabel("Show").selectOption("all");
    // The details open from the keyboard, and focus returns to the button that opened them.
    const details = page
      .getByTestId("run-row")
      .first()
      .getByRole("button", { name: /^Details/ });
    await details.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("run-details")).toBeVisible();
    await reviewPage(page, "integrations-run");
    await page.keyboard.press("Escape");
    await expect(details).toBeFocused();
    await page.getByRole("tab", { name: "Mappings" }).click();

    // Someone changes a city in the sheet; the next run takes it into the laboratory.
    fake.editCellByKey(directory, 0, 0, "demo-signal-lab", CITY, "Harbour City");
    await row.getByRole("button", { name: "Run now Laboratory directory" }).click();
    await expect.poll(() => laboratoryField("demo-lab-signal", "city"), { timeout: 30_000 }).toBe("Harbour City");
    await page.goto("./#/labs/demo-lab-signal");
    await expect(page.getByRole("main")).toContainText("Harbour City", { timeout: 20_000 });

    // The website changes on both sides before a run: the change in the portal starts a run,
    // which finds the conflict and writes neither side.
    fake.editCellByKey(directory, 0, 0, "demo-attention-lab", WEBSITE, "https://sheet-side.example.org/");
    await adminDb
      .doc(COLLECTIONS.laboratories.docPath("demo-lab-attention"))
      .update({ website: "https://portal-side.example.org/" });
    await expect
      .poll(
        async () =>
          (
            await adminDb
              .collection(COLLECTIONS.syncConflicts.collectionPath())
              .where("mappingId", "==", DIRECTORY_MAPPING)
              .get()
          ).docs.filter((conflict) => conflict.get("status") === "open").length,
        { timeout: 30_000 },
      )
      .toBe(1);

    // The conflicts screen shows the three values side by side, and the administrator keeps the sheet's.
    await page.goto("./#/admin/integrations/conflicts");
    const card = page.getByRole("article", { name: "Website of Demo Attention Laboratory" });
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card).toContainText("https://portal-side.example.org/");
    await expect(card).toContainText("https://sheet-side.example.org/");
    await reviewPage(page, "integrations-conflicts");
    await narrowCheck(page, "integrations-conflicts");
    await card.getByRole("button", { name: "Keep the sheet value" }).click();
    const confirm = page.getByRole("dialog", { name: "Keep the sheet value?" });
    await confirm.getByLabel("Note").fill("The sheet is current.");
    await confirm.getByRole("button", { name: "Resolve the conflict" }).click();
    await expect(card).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByTestId("resolved-conflict").first()).toContainText("Website of Demo Attention Laboratory");
    await expect
      .poll(() => laboratoryField("demo-lab-attention", "website"), { timeout: 20_000 })
      .toBe("https://sheet-side.example.org/");
    const adminUid = (await adminAuth.getUserByEmail(ADMIN_EMAIL)).uid;
    const resolved = await auditEntries("syncConflict.resolved");
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.get("actorUid")).toBe(adminUid);
    expect(fake.rowValues(directory, 0, fake.rowIndexOfKey(directory, 0, 0, "demo-attention-lab"))[WEBSITE]?.v).toBe(
      "https://sheet-side.example.org/",
    );
  } finally {
    await admin.context.close();
  }
});

test("AS-3: a changed equipment configuration reaches the equipment register", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const admin = await administratorBrowser(browser, baseURL as string);
  const page = admin.page;
  const fake = workspaceFake();
  const register = FAKE_FILES.equipmentRegister;
  try {
    // A first run links the register to the configurations, so both sides agree on a base.
    await page.goto("./#/admin/integrations?tab=mappings");
    const row = page.getByTestId("mapping-row").filter({ hasText: "Equipment register" });
    await row.getByRole("button", { name: "Run now Equipment register" }).click({ timeout: 20_000 });
    await settledRuns(EQUIPMENT_MAPPING);

    await page.goto("./#/labs/demo-lab-attention?tab=equipment");
    await page.getByRole("button", { name: "Edit the configuration Main recording room" }).click({ timeout: 20_000 });
    const edit = page.getByRole("dialog", { name: "Edit Main recording room" });
    await edit.getByLabel("EEG channels").fill("96");
    await edit.getByRole("button", { name: "Save the configuration" }).click();
    await expect(edit).toHaveCount(0, { timeout: 20_000 });

    // The change of the record starts a run of its own, which writes the register.
    await expect
      .poll(() => fake.rowValues(register, 0, fake.rowIndexOfKey(register, 0, 0, ATTENTION_ROW))[CHANNELS]?.v, {
        timeout: 30_000,
      })
      .toBe(96);
    await expect.poll(async () => (await auditEntries("sync.sheetUpdated")).length, { timeout: 20_000 }).toBe(1);
    // The formula and the note of the laboratory are left alone.
    const values = fake.rowValues(register, 0, fake.rowIndexOfKey(register, 0, 0, ATTENTION_ROW));
    expect(values[6]?.f).toBe("=D3/3");
    expect(values[7]?.v).toBe("Booked on Tuesdays.");
  } finally {
    await admin.context.close();
  }
});

test("AS-9: a generated document keeps the text people wrote, and a hand edit of the designated field is taken into the record", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const admin = await administratorBrowser(browser, baseURL as string);
  const page = admin.page;
  const fake = workspaceFake();
  // The record is named after its template until the document exists, then after the document.
  const generatedCard = () => page.getByTestId("generated-document").filter({ hasText: "Demo Signal Laboratory" });
  try {
    await page.goto("./#/labs/demo-lab-signal?tab=documents");
    await page.getByRole("button", { name: "Generate laboratory progress" }).click({ timeout: 20_000 });
    const card = generatedCard();
    await expect(card).toContainText("Up to date", { timeout: 30_000 });
    await expect(card.getByRole("list", { name: "Managed sections" })).toContainText("Profile: up to date");
    await reviewPage(page, "laboratory-documents");

    const stored = (
      await adminDb
        .collection(COLLECTIONS.generatedDocuments.collectionPath())
        .where("entityId", "==", "demo-lab-signal")
        .get()
    ).docs[0];
    const documentId = String(stored?.get("externalDocumentId"));
    const text = fake.documentText(documentId);
    expect(text).toContain(HUMAN_TEXT);
    expect(text).toContain("DemoAlpha2001 | Onboarding");
    expect(text).toContain("Source: ");

    // Someone writes the description in the document, inside the managed profile section.
    fake.replaceInDocument(documentId, "No description is recorded.", "Written in the document by the laboratory.");
    await card.getByRole("button", { name: /^Update now/ }).click();
    await expect(card).toContainText("A section was edited by hand", { timeout: 30_000 });
    // The portal overwrote neither the hand edit nor the text around the sections.
    expect(fake.documentText(documentId)).toContain("Written in the document by the laboratory.");
    expect(fake.documentText(documentId)).toContain(HUMAN_TEXT);

    // An administrator takes the edit into the laboratory's description.
    await page.goto("./#/admin/integrations/conflicts");
    const conflict = page.getByRole("article", { name: /^Profile section of Demo Signal Laboratory progress/ });
    await expect(conflict).toBeVisible({ timeout: 20_000 });
    await conflict.getByRole("button", { name: "Take the document's text into the record" }).click();
    await page
      .getByRole("dialog", { name: "Take the document's text into the record?" })
      .getByRole("button", { name: "Resolve the conflict" })
      .click();
    await expect(conflict).toHaveCount(0, { timeout: 20_000 });
    await expect
      .poll(() => laboratoryField("demo-lab-signal", "description"), { timeout: 20_000 })
      .toBe("Written in the document by the laboratory.");
    expect(await auditEntries("generatedDocument.sectionTaken")).toHaveLength(1);
    await page.goto("./#/labs/demo-lab-signal?tab=documents");
    await expect(generatedCard()).toContainText("Up to date", { timeout: 30_000 });
    expect(fake.documentText(documentId)).toContain(HUMAN_TEXT);
  } finally {
    await admin.context.close();
  }
});

test("a Drive folder is linked to a replication and browsed without its content, and an unshared file asks to be shared", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const admin = await administratorBrowser(browser, baseURL as string);
  const page = admin.page;
  try {
    await page.goto("./#/replications/DemoAlpha2001?tab=documents");
    await page.getByRole("button", { name: "Link a Drive file or folder" }).click({ timeout: 20_000 });
    let dialog = page.getByRole("dialog", { name: "Link a Google Drive file or folder" });
    await dialog
      .getByLabel("Address in Google Drive")
      .fill(`https://drive.google.com/drive/folders/${FAKE_FILES.alphaFolder}`);
    await dialog.getByRole("button", { name: "Link the item" }).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
    const link = page.getByTestId("document-link").filter({ hasText: "DemoAlpha2001 team folder (synthetic)" });
    await expect(link).toContainText("Shared with the portal", { timeout: 20_000 });
    await link.getByRole("button", { name: "Browse DemoAlpha2001 team folder (synthetic)" }).click();
    const browserDialog = page.getByRole("dialog", { name: "DemoAlpha2001 team folder (synthetic)" });
    await expect(browserDialog.getByTestId("drive-items")).toContainText("Recruitment tracker (synthetic)", {
      timeout: 20_000,
    });
    await reviewPage(page, "drive-browser");
    await browserDialog.getByRole("button", { name: /^Recruitment tracker \(synthetic\)/ }).click();
    // The portal shows what Drive says about the file, never its content.
    await expect(browserDialog.getByTestId("drive-preview")).toContainText("never shows the content of a file", {
      timeout: 20_000,
    });
    await expect(browserDialog.getByTestId("drive-preview")).not.toContainText("Demo Memory Laboratory");
    await browserDialog.getByRole("button", { name: "Back to the folder" }).click();
    await expect(browserDialog.getByTestId("drive-items")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(browserDialog).toBeHidden();
    // Focus returns to the button that opened the folder.
    await expect(link.getByRole("button", { name: "Browse DemoAlpha2001 team folder (synthetic)" })).toBeFocused();

    // A file the portal's account cannot open is kept, with the address to share it with.
    await page.getByRole("button", { name: "Link a Drive file or folder" }).click();
    dialog = page.getByRole("dialog", { name: "Link a Google Drive file or folder" });
    await dialog
      .getByLabel("Address in Google Drive")
      .fill(`https://docs.google.com/document/d/${FAKE_FILES.privateProtocol}/edit`);
    await dialog.getByRole("button", { name: "Link the item" }).click();
    await expect(dialog.getByTestId("share-step")).toContainText(FAKE_ACCOUNT, { timeout: 20_000 });
    await dialog.getByRole("button", { name: "Done" }).click();
    await reviewPage(page, "replication-documents");
  } finally {
    await admin.context.close();
  }
});

test("a lead, who reads no template, generates the replication's progress document from its kind", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const page = lead.page;
  try {
    await page.goto("./#/replications/DemoAlpha2001?tab=documents");
    const generate = page.getByRole("button", { name: "Generate replication progress" });
    await expect(generate).toBeVisible({ timeout: 20_000 });
    await generate.click();
    await expect(page.getByTestId("generated-document").filter({ hasText: "Replication progress" })).toBeVisible({
      timeout: 30_000,
    });
    // The recruitment document is for the replication's team, never for every member.
    await page.getByRole("button", { name: "Generate recruitment" }).click();
    await expect
      .poll(
        async () =>
          (
            await adminDb
              .collection(COLLECTIONS.generatedDocuments.collectionPath())
              .where("templateKind", "==", "recruitment")
              .get()
          ).docs.map((document) => document.get("scopeKeys")),
        { timeout: 30_000 },
      )
      .toEqual([["rep:DemoAlpha2001", "programme"]]);
  } finally {
    await lead.context.close();
  }
});
