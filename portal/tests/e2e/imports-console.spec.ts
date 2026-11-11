// The imports console in the browser: the sources and batches, a batch with its log, its changes
// and the confirmation of its rollback, the review queue resolving leads in conflict, and the
// report of the integrity checker. Everything is synthetic: the world of `seed:demo`, a
// replication invented for this test, and invented people on the example.org domain.
import { COLLECTIONS, entityRefId, PROGRAMME_KEY, replicationMembershipId, systemWriteContext } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { checkAndRecordIntegrity } from "../../tools/src/commands/integrity-check";
import { adminAuth, adminDb } from "../support/admin";
import { ADMIN_EMAIL, administratorBrowser, reviewPage } from "./identity-support";
import { signInAsIvy } from "./registry-support";
import { expect, test } from "./support";

const STUDY = "DemoEpsilon2020";

function standard() {
  const now = Timestamp.now();
  return {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "system:e2e",
    updatedBy: "system:e2e",
    archivedAt: null,
    writeContext: systemWriteContext(),
  };
}

/** A replication of its own, whose two sources disagree about who leads it. */
async function leadConflict(): Promise<void> {
  await adminDb.doc(COLLECTIONS.replications.docPath(STUDY)).set({
    ...standard(),
    programmeId: PROGRAMME_KEY,
    studyKey: STUDY,
    shortTitle: "Demonstration study Epsilon (synthetic)",
    citationStatus: "unverified",
    statusKey: null,
    statusHistoryId: null,
    selectionStatus: "selected",
    leadPersonIds: [],
    vocabulary: [],
    custom: {},
    dataOrigin: "demo",
  });
  for (const personId of ["demo-person-hana", "demo-person-hugo"]) {
    await adminDb
      .doc(COLLECTIONS.replicationMemberships.docPath(STUDY, replicationMembershipId(personId, "lead")))
      .set({
        ...standard(),
        replicationId: STUDY,
        personId,
        role: "lead",
        isCurrent: true,
        earlierPeriods: [],
        reviewStatus: "needsReview",
      });
  }
  await adminDb.doc(COLLECTIONS.reconciliationItems.docPath("e2e-epsilon-leads")).set({
    ...standard(),
    kind: "conflictingLead",
    entityRefs: [{ entityType: "replication", entityId: STUDY }],
    field: "leadPersonIds",
    sourceKey: "demo-a",
    candidates: [
      { key: "demo-a/leads:hana", valueSource: "Hana Mock", sourceRecordId: "e2e-source-epsilon-a" },
      { key: "demo-b/leads:hugo", valueSource: "Hugo Mock", sourceRecordId: "e2e-source-epsilon-b" },
    ],
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
    batchId: "e2e-batch",
  });
}

/** Removes what `leadConflict` wrote, so that the browser tests after this one see the world of `seed:demo`. */
async function removeLeadConflict(): Promise<void> {
  const { uid } = await adminAuth.getUserByEmail(ADMIN_EMAIL);
  await Promise.all([
    adminDb.doc(COLLECTIONS.replications.docPath(STUDY)).delete(),
    ...["demo-person-hana", "demo-person-hugo"].map((personId) =>
      adminDb
        .doc(COLLECTIONS.replicationMemberships.docPath(STUDY, replicationMembershipId(personId, "lead")))
        .delete(),
    ),
    adminDb.doc(COLLECTIONS.reconciliationItems.docPath("e2e-epsilon-leads")).delete(),
    adminDb.doc(COLLECTIONS.userRecents.docPath(uid, entityRefId("replication", STUDY))).delete(),
  ]);
}

test("an administrator reads the sources and a batch, and sees what a rollback would change before confirming", async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const admin = await administratorBrowser(browser, baseURL as string);
  try {
    const page = admin.page;
    await page.getByRole("list", { name: "Administration" }).getByRole("link", { name: "Imports" }).click();
    const sources = page.getByRole("table", { name: "Registered sources" });
    await expect(sources).toContainText("Synthetic coordination workbook");
    await expect(sources).toContainText("Imported once");
    await expect(sources).not.toContainText("https://");
    await reviewPage(page, "admin-imports-sources");

    await page.getByRole("tab", { name: "Batches" }).click();
    const batches = page.getByRole("table", { name: "Import batches, latest first" });
    await expect(batches).toContainText("Applied");
    await expect(batches).toContainText("The import tool");
    await expect(batches).toContainText("42 s");
    await reviewPage(page, "admin-imports-batches");

    await batches.getByRole("link").first().click();
    await expect(page.getByTestId("batch-log")).toContainText("waits in the review queue");
    // The contact document of a person is restricted: the change names its fields and withholds the values.
    const contact = page.getByTestId("batch-change").filter({ hasText: "private/contact" });
    await expect(contact).toContainText("Matched, unchanged");
    await expect(page.getByTestId("batch-change").filter({ hasText: "@example.org" })).toHaveCount(0);
    await reviewPage(page, "admin-import-batch");

    await page.getByRole("button", { name: "Roll back this batch" }).click();
    const dialog = page.getByRole("dialog", { name: "Roll back this batch?" });
    await expect(dialog.getByTestId("rollback-plan")).toContainText("Removed: historicalAggregates/");
    await expect(dialog.getByTestId("rollback-plan")).toContainText("3 items of the review queue withdrawn");
    await reviewPage(page, "admin-import-rollback");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    // Nothing changed: the batch is still applied.
    await expect(page.getByText("Applied", { exact: true })).toBeVisible();
  } finally {
    await admin.context.close();
  }
});

test("a member is refused the imports console and the review queue, by the page and by the rules", async ({ page }) => {
  await signInAsIvy(page);
  await expect(page.getByRole("list", { name: "Administration" }).getByRole("link", { name: "Imports" })).toHaveCount(
    0,
  );
  await page.goto("./#/admin/review-queue");
  await expect(page.getByRole("heading", { name: "Review queue" })).toBeVisible();
  await expect(page.getByTestId("review-item")).toHaveCount(0);
  await expect(page.getByText("You do not have access to this page.")).toBeVisible();
});

test("the review queue resolves leads in conflict, and the replication shows its lead", async ({
  browser,
  baseURL,
}) => {
  await leadConflict();
  const admin = await administratorBrowser(browser, baseURL as string);
  try {
    const page = admin.page;
    await page.getByRole("list", { name: "Administration" }).getByRole("link", { name: "Review queue" }).click();
    const kinds = page.getByLabel("Kind of item");
    const leads = await kinds.locator("option", { hasText: "Leads in conflict" }).getAttribute("value");
    await kinds.selectOption(leads ?? "");
    const item = page.getByTestId("review-item").filter({ hasText: STUDY });
    await expect(item).toContainText("Hana Mock");
    await expect(item).toContainText("Source record e2e-source-epsilon-b");
    await reviewPage(page, "admin-review-queue");

    await item.getByLabel("Decision about Hana Mock").selectOption({ label: "Current lead" });
    await item.getByLabel("Decision about Hugo Mock").selectOption({ label: "Wrong, never a lead" });
    await item.getByRole("button", { name: "Record the decision" }).click();
    const confirm = page.getByRole("dialog", { name: "Record this decision about the leads?" });
    await confirm.getByLabel("Note").fill("Synthetic: the second source is out of date.");
    await confirm.getByRole("button", { name: "Record the decision" }).click();
    await expect(item).toHaveCount(0);

    const decided = await adminDb.doc(COLLECTIONS.reconciliationItems.docPath("e2e-epsilon-leads")).get();
    expect(decided.get("status")).toBe("resolved");
    const audit = await adminDb.collection("auditEvents").where("action", "==", "reconciliation.resolved").get();
    expect(audit.docs.some((entry) => entry.get("entityId") === STUDY)).toBe(true);

    await page.goto(`./#/replications/${STUDY}`);
    await expect(page.getByTestId("replication-status")).toBeVisible();
    await expect(page.getByText("Hana Mock").first()).toBeVisible();
    await expect(page.getByText("Hugo Mock")).toHaveCount(0);
  } finally {
    await admin.context.close();
    await removeLeadConflict();
  }
});

test("the latest integrity report shows what the checker found", async ({ browser, baseURL }) => {
  await adminDb.doc(COLLECTIONS.laboratories.docPath("demo-lab-dangling")).set({
    ...standard(),
    slug: "demo-dangling-lab",
    name: "Demo Dangling Laboratory",
    piPersonId: "demo-person-missing",
    status: "active",
    custom: {},
    dataOrigin: "demo",
  });
  try {
    await checkAndRecordIntegrity(adminDb);
    const admin = await administratorBrowser(browser, baseURL as string);
    try {
      const page = admin.page;
      await page.getByRole("list", { name: "Administration" }).getByRole("link", { name: "Integrity" }).click();
      await expect(page.getByTestId("integrity-total")).toBeVisible();
      await page.getByLabel("Check", { exact: true }).selectOption({ label: "References that name no record" });
      const finding = page.getByTestId("integrity-finding").filter({ hasText: "laboratories/demo-lab-dangling" });
      await expect(finding).toContainText("piPersonId");
      await expect(finding).toContainText("demo-person-missing");
      await reviewPage(page, "admin-integrity");
    } finally {
      await admin.context.close();
    }
  } finally {
    await adminDb.doc(COLLECTIONS.laboratories.docPath("demo-lab-dangling")).delete();
  }
});
