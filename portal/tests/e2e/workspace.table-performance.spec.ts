// The table of a database with 5,000 rows in the browser (D-011): it renders only the rows in
// view and scrolls without a long task above 200 milliseconds. Writing and removing the rows
// queues ten thousand runs of the audit trigger, which would hold up the triggers that the specs
// after it wait for, so this file is named to run last: Playwright runs files in the order of
// their paths. The rows are synthetic, and the reader is an invented member on example.org.
import { COLLECTIONS, systemWriteContext } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../support/admin";
import { signInAsIvy } from "./registry-support";
import { expect, test } from "./support";

test("a table of 5,000 rows scrolls without long tasks above 200 milliseconds", async ({ page }) => {
  test.setTimeout(300_000);
  // A database beneath a page of the workspace, which every member reads, with 5,000 rows
  // written as trusted code would write them.
  const pageId = "e2e-large-database-page";
  const databaseId = "e2e-large-database";
  try {
    const now = Timestamp.now();
    const standard = {
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: "system:e2e",
      updatedBy: "system:e2e",
      archivedAt: null,
      writeContext: systemWriteContext(),
    };
    const audience = { scopeKeys: ["members"], levelKeys: { comment: ["members"], edit: [], full: [] } };
    await adminDb.doc(COLLECTIONS.pages.docPath(pageId)).set({
      ...standard,
      parentPageId: null,
      ancestorPageIds: [],
      kind: "custom",
      title: "Synthetic large database",
      order: "z",
      isTemplate: false,
      accessMode: "inherit",
      replicationId: null,
      laboratoryId: null,
      ...audience,
      contentHead: null,
      mentionUids: [],
      tagIds: [],
      lastEditedBy: null,
    });
    await adminDb.doc(COLLECTIONS.databases.docPath(databaseId)).set({
      ...standard,
      name: "Synthetic recordings",
      parentPageId: pageId,
      isTemplate: false,
      properties: {
        sessions: { key: "sessions", name: "Sessions", type: "number", config: {}, order: "i", archivedAt: null },
        share: {
          key: "share",
          name: "Share",
          type: "formula",
          config: { formula: { expression: 'round(prop("Sessions") / 50 * 100)' } },
          order: "j",
          archivedAt: null,
        },
      },
      ...audience,
    });
    for (let start = 0; start < 5_000; start += 500) {
      const batch = adminDb.batch();
      for (let index = start; index < start + 500; index += 1) {
        const rowId = `row${String(index).padStart(5, "0")}`;
        batch.set(adminDb.doc(COLLECTIONS.databaseRows.docPath(databaseId, rowId)), {
          ...standard,
          databaseId,
          title: `Synthetic recording ${index}`,
          values: { sessions: index % 50 },
          order: `a${String(index).padStart(5, "0")}z`,
          pageId: null,
          tagIds: [],
        });
      }
      await batch.commit();
    }
    await signInAsIvy(page);
    await page.goto(`./#/databases/${databaseId}`);
    await expect(page.getByText("5000 records")).toBeVisible({ timeout: 60_000 });
    const table = page.getByTestId("view-table");
    expect(await table.getByRole("row").count()).toBeLessThan(80);
    await expect(table.getByRole("table")).toHaveAttribute("aria-rowcount", "5001");

    await page.evaluate(() => {
      const observed: number[] = [];
      (window as unknown as { __longTasks: number[] }).__longTasks = observed;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) observed.push(entry.duration);
      }).observe({ type: "longtask" });
    });
    const box = await table.boundingBox();
    if (box === null) throw new Error("The table has no box.");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    for (let step = 0; step < 60; step += 1) {
      await page.mouse.wheel(0, 3_000);
      await page.waitForTimeout(16);
    }
    await expect(table).toContainText("Synthetic recording 4999");
    await table.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.waitForTimeout(300);
    const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
    expect(Math.max(0, ...longTasks), `long tasks: ${longTasks.join(", ")}`).toBeLessThanOrEqual(200);
  } finally {
    const rows = await adminDb.collection(COLLECTIONS.databaseRows.collectionPath(databaseId)).listDocuments();
    for (let start = 0; start < rows.length; start += 400) {
      const batch = adminDb.batch();
      for (const row of rows.slice(start, start + 400)) batch.delete(row);
      await batch.commit();
    }
    await adminDb.doc(COLLECTIONS.databases.docPath(databaseId)).delete();
    await adminDb.doc(COLLECTIONS.pages.docPath(pageId)).delete();
  }
});
