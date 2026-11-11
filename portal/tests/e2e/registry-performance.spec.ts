// The members directory with more than a thousand synthetic people, more than one query may
// read: it loads them all, counts them, finds the last of them, keeps every keystroke of a fast
// search, and scrolls without a long task of more than 200 milliseconds. A laboratory page
// reads only the people it names, and never the whole directory. The people are invented for this test, on
// no real domain, and are removed afterwards. The data is synthetic.
import { COLLECTIONS, systemWriteContext } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "../support/admin";
import { signInAsIvy } from "./registry-support";
import { expect, liveWatchedKeys, test } from "./support";

/** With the twelve people of the demonstration world, the directory holds 1,002 people. */
const SYNTHETIC = 989;
const COUNTRIES = ["GB", "DE", "NL", "FR", "IT", "ES", "PL", "SE", "US", "CA"];
/** The person whose identifier sorts last, beyond the first thousand that one query reads. */
const BEYOND = "zz-beyond-limit-1";
const ids = [
  ...Array.from({ length: SYNTHETIC }, (_, index) => `synthetic-load-${String(index).padStart(4, "0")}`),
  BEYOND,
];

test.beforeAll(async () => {
  const now = Timestamp.now();
  for (let start = 0; start < ids.length; start += 400) {
    const batch = adminDb.batch();
    for (const [offset, id] of ids.slice(start, start + 400).entries()) {
      const index = start + offset;
      batch.set(adminDb.doc(COLLECTIONS.persons.docPath(id)), {
        schemaVersion: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: "system:e2e",
        updatedBy: "system:e2e",
        archivedAt: null,
        writeContext: systemWriteContext(),
        slug: id,
        givenName: id === BEYOND ? "Zoe" : `Synthetic${index}`,
        familyName: id === BEYOND ? "Beyondlimit" : `Person${String(index).padStart(4, "0")}`,
        displayName: id === BEYOND ? "Zoe Beyondlimit" : `Synthetic Person ${index}`,
        affiliationSummary: `Example Institute ${index % 41}`,
        countryCode: COUNTRIES[index % COUNTRIES.length],
        laboratoryIds: [],
        replicationIds: index % 7 === 0 ? ["DemoAlpha2001"] : [],
        isCoreTeam: false,
        publicListing: "none",
        coreRoles: [],
        userId: null,
        claimedAt: null,
        custom: {},
        dataOrigin: "demo",
      });
    }
    await batch.commit();
  }
});

test.afterAll(async () => {
  for (let start = 0; start < ids.length; start += 400) {
    const batch = adminDb.batch();
    for (const id of ids.slice(start, start + 400)) batch.delete(adminDb.doc(COLLECTIONS.persons.docPath(id)));
    await batch.commit();
  }
});

test("the members table with more than a thousand rows scrolls without long tasks above 200 milliseconds", async ({
  page,
}) => {
  await signInAsIvy(page);
  await page.goto("./#/members");
  await expect(page.getByTestId("result-count")).toContainText("Showing 1,002 of 1,002 members", { timeout: 30_000 });
  const table = page.getByTestId("members-table");
  // Only the rows in view are in the document.
  expect(await table.getByRole("row").count()).toBeLessThan(60);
  await expect(table.getByRole("table")).toHaveAttribute("aria-rowcount", "1003");

  await page.evaluate(() => {
    const observed: number[] = [];
    (window as unknown as { __longTasks: number[] }).__longTasks = observed;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) observed.push(entry.duration);
    }).observe({ type: "longtask" });
  });
  // Scroll the whole table in steps, as a wheel would, and back to the top in one jump.
  const box = await table.boundingBox();
  if (box === null) throw new Error("The table has no box.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < 40; step += 1) {
    await page.mouse.wheel(0, 1_000);
    await page.waitForTimeout(16);
  }
  await expect(table.getByRole("row", { name: /^Synthetic Person/ }).last()).toBeVisible();
  await table.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.waitForTimeout(300);
  const longTasks = await page.evaluate(() => (window as unknown as { __longTasks: number[] }).__longTasks);
  expect(Math.max(0, ...longTasks), `long tasks: ${longTasks.join(", ")}`).toBeLessThanOrEqual(200);

  // Filtering the rows answers at once.
  await page.getByLabel("Search members").fill("Example Institute 7");
  await expect(page.getByTestId("result-count")).toContainText(/Showing \d+ of 1,002 members/);

  // The person beyond the first thousand is found, and the home page counts everyone.
  await page.getByLabel("Search members").fill("Beyondlimit");
  await expect(page.getByTestId("result-count")).toContainText("Showing 1 of 1,002 members");
  await expect(table.getByRole("row", { name: /Zoe Beyondlimit/ })).toBeVisible();

  // Typing without a pause between keys loses no character.
  const search = page.getByLabel("Search members");
  await search.fill("");
  await search.pressSequentially("Synthetic Person 12", { delay: 0 });
  await expect(search).toHaveValue("Synthetic Person 12");
  await expect(page.getByTestId("result-count")).toContainText(/Showing \d+ of 1,002 members/);
});

test("a laboratory page reads the people it names and not the whole directory", async ({ page }) => {
  await signInAsIvy(page);
  // A fresh load of the record page, so that nothing another page read is still watched.
  await page.goto("./#/labs/demo-lab-memory");
  await page.reload();
  const profile = page.getByTestId("laboratory-profile");
  await expect(profile.getByRole("link", { name: "Cleo Placeholder" }).first()).toBeVisible({ timeout: 30_000 });
  const keys = await liveWatchedKeys(page);
  expect(keys.some((key) => key.includes('"persons"') && key.startsWith("pages:"))).toBe(false);
  expect(keys.some((key) => key.startsWith("docs:persons:"))).toBe(true);
});
