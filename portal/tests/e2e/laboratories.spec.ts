// Laboratories, their equipment and their participations in the browser: the list and the record
// page, registration and its review (acceptance scenario 2), an equipment change that every
// linked view shows without a reload (the first half of acceptance scenario 3), and the
// participation that a lead creates and a member of the laboratory works through.
// The data is the synthetic world of `seed:demo`: invented people on the example.org domain.
import { COLLECTIONS } from "@eegml/shared";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, serverTimestamp, updateDoc } from "firebase/firestore";
import { adminDb } from "../support/admin";
import { createTestClient, errorCodeOf, signInWithEmailLinkFromEmulator } from "../support/client";
import { HOST, PORTS } from "../support/emulators";
import { administratorBrowser, reviewPage } from "./identity-support";
import { COGNITION_LAB, coordinatorBrowser, DEV, linkedBrowser, MEMORY_LAB } from "./laboratory-support";
import { ALPHA, IVY, leadBrowser, rowNamed, signInAsIvy } from "./registry-support";
import { expect, test } from "./support";

test("a member finds a laboratory in the list, previews it and reads its page", async ({ page }) => {
  await signInAsIvy(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Laboratories" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Laboratories" })).toBeVisible();
  const table = page.getByTestId("laboratories-table");
  await expect(table).toContainText("Demo Attention Laboratory");
  await expect(table).toContainText("Demonstration data");

  // The search, the filters and the actions never overlap, and no filter is squeezed, from 360
  // pixels wide upwards.
  for (const width of [360, 390, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const boxes = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLElement>(
          'main input[type="search"], main select, main button:not([role="tab"]):not([aria-label])',
        ),
      ]
        .filter((element) => element.closest("table, [data-testid='side-panel']") === null)
        .map((element) => {
          const box = element.getBoundingClientRect();
          return { tag: element.tagName, left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        })
        .filter((box) => box.right > box.left),
    );
    for (const [index, a] of boxes.entries()) {
      if (a.tag !== "BUTTON") expect(a.right - a.left, `a ${a.tag} at ${width}`).toBeGreaterThanOrEqual(120);
      for (const b of boxes.slice(index + 1)) {
        const overlap = a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
        expect(overlap, `${a.tag} and ${b.tag} overlap at ${width}`).toBe(false);
      }
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });

  await page.getByLabel("Country", { exact: true }).selectOption({ label: "Germany" });
  await expect(table.getByRole("row")).toHaveCount(2);
  await expect(table).toContainText("Demo Signal Laboratory");
  expect(page.url()).toContain("country=DE");
  await page.getByRole("button", { name: "Clear the search and filters" }).first().click();
  await page.getByLabel("Replication", { exact: true }).selectOption({ label: "Takes part in DemoGamma2010" });
  await expect(table).not.toContainText("Demo Attention Laboratory");
  await page.getByRole("button", { name: "Clear the search and filters" }).first().click();

  await rowNamed(page, /Demo Cognition Laboratory/).click();
  const preview = page.getByTestId("side-panel");
  await expect(preview).toContainText("Ridgeway Example College");
  await expect(preview).toContainText("DemoGamma2010");
  expect(page.url()).toContain("open=demo-lab-cognition");
  await reviewPage(page, "laboratories-list");

  await preview.getByRole("link", { name: "Open the full page" }).click();
  await expect(page.getByRole("heading", { level: 1, name: COGNITION_LAB.name })).toBeVisible();
  const profile = page.getByTestId("laboratory-profile");
  await expect(profile).toContainText("Ridgeway Example College");
  await expect(profile).toContainText("Netherlands");
  await expect(profile).toContainText("Gus Specimen");
  // Ivy is a member of the laboratory, so she reads its restricted detail, and edits nothing.
  await expect(page.getByTestId("laboratory-detail")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await reviewPage(page, "laboratory-profile");

  await page.getByRole("tab", { name: "Equipment" }).click();
  const configuration = page.getByTestId("equipment-configuration").filter({ hasText: "Booth A" });
  await expect(configuration).toContainText("Current");
  await expect(configuration).toContainText("64");
  await expect(configuration.getByTestId("equipment-history")).toContainText(
    "Earlier versions of this configuration (1)",
  );
  await reviewPage(page, "laboratory-equipment");

  await page.getByRole("tab", { name: "Participations" }).click();
  const gamma = page.getByTestId("participation").filter({ hasText: "DemoGamma2010" });
  await expect(gamma.getByTestId("compatibility")).toContainText("Meets the requirements");
  await expect(gamma).toContainText("9 of 9 items done or not applicable");
  await expect(gamma.getByTestId("onboarding-details")).toContainText("Approved");
  // The targets of the main experiment and of the resting state are kept apart: an unknown stays unknown.
  await expect(gamma).toContainText("Target, main experiment30");
  await expect(gamma).toContainText("Target, resting stateNot recorded");
  const beta = page.getByTestId("participation").filter({ hasText: "DemoBeta2005" });
  await expect(beta.getByTestId("compatibility")).toContainText("Compatibility unknown");
  await expect(beta.getByTestId("compatibility")).toContainText("Cap: the configuration does not say.");
  await reviewPage(page, "laboratory-participations");

  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(page.getByTestId("activity-entry").first()).toBeVisible();
  await reviewPage(page, "laboratory-activity");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Readiness" }).click();
  const matrix = page.getByTestId("readiness-matrix");
  await expect(matrix).toContainText(COGNITION_LAB.name);
  await matrix.getByRole("button", { name: /Demo Cognition Laboratory in DemoGamma2010/ }).click();
  await expect(page.getByTestId("side-panel")).toContainText("9 of 9 items done or not applicable");
  expect(page.url()).toContain("open=DemoGamma2010__demo-lab-cognition");
  await reviewPage(page, "readiness");
});

test("a member registers a laboratory, an administrator approves it, and a second representative is added", async ({
  page,
  browser,
  baseURL,
}) => {
  // Three people in three browsers, each with a review of the page at two sizes.
  test.setTimeout(180_000);
  await signInAsIvy(page);
  await page.goto("./#/labs");
  await page.getByRole("button", { name: "Register a laboratory" }).first().click();
  const form = page.getByRole("dialog", { name: "Register a laboratory" });
  await form.getByLabel("Name of the laboratory").fill("Demo Vision Laboratory");
  await form.getByLabel("Institution", { exact: true }).selectOption({ label: "An institution that is not listed" });
  await form.getByLabel("Name of the institution").fill("Vale Example Institute");
  await form.getByLabel("Country", { exact: true }).selectOption({ label: "United Kingdom" });
  await form.getByLabel("City").fill("Valeton");
  await form.getByLabel("Department").fill("Synthetic psychology");
  await form.getByLabel("Website").fill("not a web address");
  await form.getByRole("button", { name: "Send for review" }).click();
  await expect(form).toContainText("Enter a full web address that starts with https://.");
  await form.getByLabel("Website").fill("https://example.org/vision");
  await form.getByLabel("Your role").selectOption({ label: "Coordinator" });
  await form.getByLabel("Message to the reviewer").fill("I run the synthetic vision laboratory.");
  await reviewPage(page, "laboratory-registration");
  await form.getByRole("button", { name: "Send for review" }).click();
  await expect(page.getByText("Your registration has been sent for review.", { exact: true })).toBeVisible();
  await expect(form).toHaveCount(0);

  const admin = await administratorBrowser(browser, baseURL as string);
  try {
    await admin.page.goto("./#/admin/lab-claims");
    const row = admin.page.getByRole("row").filter({ hasText: "Demo Vision Laboratory" });
    await expect(row).toContainText("New laboratory");
    await expect(row).toContainText("Vale Example Institute, Valeton, United Kingdom (a new institution)");
    await expect(row).toContainText("Ivy Pretend");
    await expect(row).toContainText("I run the synthetic vision laboratory.");
    await row.getByRole("button", { name: "Approve" }).click();
    const decision = admin.page.getByRole("dialog", { name: "Approve this request?" });
    await decision.getByRole("button", { name: "Approve" }).click();
    // The dialog closes once the function has answered; while it is open the list is hidden from the tree.
    await expect(decision).toHaveCount(0);
    await expect(row).toHaveCount(0);
  } finally {
    await admin.context.close();
  }

  // The laboratory, its institution and Ivy's role exist now, and her page follows without a reload.
  await page.goto("./#/labs");
  await rowNamed(page, /Demo Vision Laboratory/)
    .getByRole("link", { name: "Demo Vision Laboratory" })
    .click();
  await expect(page.getByRole("heading", { level: 1, name: "Demo Vision Laboratory" })).toBeVisible();
  const laboratoryPath = new URL(page.url()).hash;
  const profile = page.getByTestId("laboratory-profile");
  await expect(profile).toContainText("Vale Example Institute");
  await expect(profile).toContainText("Synthetic psychology");
  await expect(profile.getByRole("link", { name: IVY.name })).toHaveCount(2);
  // As a coordinator she edits the profile in place.
  await expect(page.getByRole("button", { name: "Edit department" })).toBeVisible();

  // Registering it again is caught before anything is sent.
  await page.goto("./#/labs");
  await page.getByRole("button", { name: "Register a laboratory" }).first().click();
  const again = page.getByRole("dialog", { name: "Register a laboratory" });
  await again.getByLabel("Name of the laboratory").fill("demo vision LABORATORY");
  await again
    .getByLabel("Institution", { exact: true })
    .selectOption({ label: "Vale Example Institute, United Kingdom" });
  await expect(again.getByTestId("duplicate-warning")).toContainText("This laboratory is in the portal already");
  await again.getByRole("button", { name: "Cancel" }).click();

  // Dev asks to represent it from its page, and Ivy, its coordinator now, approves.
  const dev = await linkedBrowser(browser, baseURL as string, DEV.email);
  try {
    await dev.page.goto(`./${laboratoryPath}`);
    await dev.page.getByRole("button", { name: "I represent this laboratory" }).click();
    const request = dev.page.getByRole("dialog", { name: "Represent Demo Vision Laboratory" });
    await request.getByLabel("Message to the reviewer").fill("I run the synthetic vision studies with Ivy.");
    await request.getByRole("button", { name: "Send the request" }).click();
    await expect(dev.page.getByText("Your request has been sent for review.", { exact: true })).toBeVisible();
  } finally {
    await dev.context.close();
  }
  await page.getByRole("list", { name: "Administration" }).getByRole("link", { name: "Laboratory claims" }).click();
  const devRow = page.getByRole("row").filter({ hasText: DEV.name });
  await expect(devRow).toContainText("Demo Vision Laboratory");
  await devRow.getByRole("button", { name: "Approve" }).click();
  const approval = page.getByRole("dialog", { name: "Approve this request?" });
  await approval.getByRole("button", { name: "Approve" }).click();
  await expect(approval).toHaveCount(0);
  await expect(devRow).toHaveCount(0);
  await page.goto(`./${laboratoryPath}`);
  const representatives = page.getByTestId("laboratory-profile");
  await expect(representatives.getByRole("link", { name: DEV.name })).toBeVisible();
  await expect(representatives.getByRole("link", { name: IVY.name })).toHaveCount(2);
});

test("a coordinator edits equipment, and the laboratory and replication views follow without a reload", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  // Ivy watches the replication and the laboratory in two tabs.
  await signInAsIvy(page);
  await page.goto("./#/replications/DemoBeta2005?tab=laboratories");
  const card = page.getByTestId("participation").filter({ hasText: MEMORY_LAB.name });
  await expect(card.getByTestId("compatibility")).toContainText("No current equipment configuration");
  const laboratoryTab = await page.context().newPage();
  await laboratoryTab.goto(`./#/labs/${MEMORY_LAB.id}?tab=participations`);
  const laboratoryCard = laboratoryTab.getByTestId("participation").filter({ hasText: "DemoBeta2005" });
  await expect(laboratoryCard.getByTestId("compatibility")).toContainText("No current equipment configuration");

  const cleo = await coordinatorBrowser(browser, baseURL as string);
  try {
    await cleo.page.goto(`./#/labs/${MEMORY_LAB.id}?tab=equipment`);
    await cleo.page.getByRole("button", { name: "Add a configuration" }).click();
    const add = cleo.page.getByRole("dialog", { name: `Add a configuration to ${MEMORY_LAB.name}` });
    await add.getByLabel("Name of the configuration").fill("Room 1");
    await add.getByLabel("Cap", { exact: true }).fill("Gel cap");
    await add.getByLabel("EEG channels").fill("64");
    await add.getByLabel("Sampling rates in hertz").fill("500, 1000");
    await add.getByRole("button", { name: "Save the configuration" }).click();
    await expect(add).toHaveCount(0);

    await expect(card.getByTestId("compatibility")).toContainText("Meets the requirements");
    await expect(laboratoryCard.getByTestId("compatibility")).toContainText("Meets the requirements");

    await cleo.page.getByRole("button", { name: "Edit the configuration Room 1" }).click();
    const edit = cleo.page.getByRole("dialog", { name: "Edit Room 1" });
    await edit.getByLabel("EEG channels").fill("16");
    await edit.getByRole("button", { name: "Save the configuration" }).click();
    await expect(edit).toHaveCount(0);
    await expect(cleo.page.getByTestId("equipment-history")).toContainText(
      "Earlier versions of this configuration (1)",
    );
    await reviewPage(cleo.page, "laboratory-equipment-coordinator");

    await expect(card.getByTestId("compatibility")).toContainText("Misses a requirement");
    await expect(card.getByTestId("compatibility")).toContainText(
      "EEG channels: needs at least 32 channels; the configuration states 16 channels.",
    );
    await expect(laboratoryCard.getByTestId("compatibility")).toContainText("Misses a requirement");

    const audit = await adminDb
      .collection(COLLECTIONS.auditEvents.collectionPath())
      .where("action", "==", "equipment.saved")
      .get();
    const entries = audit.docs.filter((entry) => String(entry.get("entityId")).startsWith(`${MEMORY_LAB.id}__`));
    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.get("actorUid") === cleo.uid)).toBe(true);
  } finally {
    await cleo.context.close();
    await laboratoryTab.close();
  }
});

test("a lead adds a laboratory to a replication and a member of that laboratory works through its checklist", async ({
  page,
  browser,
  baseURL,
}) => {
  test.setTimeout(150_000);
  const lead = await leadBrowser(browser, baseURL as string);
  const participationId = `${ALPHA}__${COGNITION_LAB.id}`;
  try {
    await lead.page.goto(`./#/replications/${ALPHA}?tab=laboratories`);
    await lead.page.getByRole("button", { name: "Add a laboratory" }).click();
    const dialog = lead.page.getByRole("dialog", { name: `Add a laboratory to ${ALPHA}` });
    await dialog.getByLabel("Laboratory", { exact: true }).selectOption({ label: COGNITION_LAB.name });
    await dialog.getByLabel("Target, main experiment").fill("24");
    await dialog.getByLabel("Target, resting state").fill("20");
    await dialog.getByLabel("Reason").fill("Synthetic: the laboratory answered the call.");
    await reviewPage(lead.page, "participation-create");
    await dialog.getByRole("button", { name: "Invite the laboratory" }).click();
    await expect(dialog).toHaveCount(0);
    const created = lead.page.getByTestId("participation").filter({ hasText: COGNITION_LAB.name });
    await expect(created.getByTestId("participation-status")).toHaveText("Invited");
    await expect(created).toContainText("0 of 9 items done or not applicable");
    await reviewPage(lead.page, "replication-laboratories-lead");
  } finally {
    await lead.context.close();
  }

  // Ivy is a member of the laboratory: she works on its items, and readiness approval is not hers.
  await signInAsIvy(page);
  await page.goto(`./#/replications/${ALPHA}?tab=laboratories`);
  const card = page.getByTestId("participation").filter({ hasText: COGNITION_LAB.name });
  await card
    .getByLabel(`Status of verified contacts for ${COGNITION_LAB.name} in ${ALPHA}`)
    .selectOption({ label: "Done" });
  await expect(card.getByTestId("checklist-progress")).toHaveText("1 of 9 items done or not applicable");
  await expect(card.getByLabel(`Status of readiness approval for ${COGNITION_LAB.name} in ${ALPHA}`)).toHaveCount(0);
  // The page shows the change at once from its local copy; the server has it once the write is confirmed.
  await expect
    .poll(async () =>
      (await adminDb.doc(COLLECTIONS.participationChecklist.docPath(participationId, "verifiedContacts")).get()).get(
        "status",
      ),
    )
    .toBe("done");

  // A member of another laboratory reads the participation and not its checklist, and the rules refuse a write.
  const dev = await linkedBrowser(browser, baseURL as string, DEV.email);
  try {
    await dev.page.goto(`./#/replications/${ALPHA}?tab=laboratories`);
    const seen = dev.page.getByTestId("participation").filter({ hasText: COGNITION_LAB.name });
    await expect(seen).toContainText("The checklist and the onboarding details are visible to the laboratory");
    await expect(seen.getByRole("combobox")).toHaveCount(0);
  } finally {
    await dev.context.close();
  }
  for (const [email, itemKey] of [
    [DEV.email, "pilot"],
    [IVY.email, "readinessApproval"],
  ] as const) {
    const client = createTestClient();
    try {
      const user = await signInWithEmailLinkFromEmulator(client, email);
      const db = getFirestore(client.app);
      connectFirestoreEmulator(db, HOST, PORTS.firestore);
      const reference = doc(db, COLLECTIONS.participationChecklist.docPath(participationId, itemKey));
      expect(
        await errorCodeOf(
          updateDoc(reference, {
            status: "done",
            completedBy: user.uid,
            completedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            updatedBy: user.uid,
            writeContext: { origin: "user", depth: 0, correlationId: null, causationId: null, auditEventId: null },
          }),
        ),
        `${email} completes ${itemKey}`,
      ).toBe("permission-denied");
      if (email === DEV.email) expect(await errorCodeOf(getDoc(reference))).toBe("permission-denied");
    } finally {
      await client.close();
    }
  }
});
