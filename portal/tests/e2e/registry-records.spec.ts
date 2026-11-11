// The record pages of the registry in the browser, against the synthetic world of `seed:demo`:
// the replication page with each of its tabs, editing in place by a lead and its refusal for
// another member, the change of status through setReplicationStatus, and the member page as the
// person, as an unrelated member and as an administrator. Everyone here is invented, and every
// address uses the example.org domain.
import { getPersonDemographicsContract, setReplicationStatusContract, userWriteContext } from "@eegml/shared";
import { connectFirestoreEmulator, doc, getDoc, getFirestore, serverTimestamp, updateDoc } from "firebase/firestore";
import { adminDb } from "../support/admin";
import { createTestClient, errorCodeOf, signInWithEmailLinkFromEmulator } from "../support/client";
import { HOST, PORTS } from "../support/emulators";
import { administratorBrowser, reviewPage } from "./identity-support";
import { ALPHA, BEN, IVY, leadBrowser, signInAsIvy } from "./registry-support";
import { expect, test } from "./support";

const TABS = [
  "Overview",
  "Leadership",
  "Laboratories",
  "Hypotheses",
  "Publications",
  "Contributors",
  "Documents",
  "Activity",
];

test("the replication page shows each section that has content, with every value labelled for what it is", async ({
  page,
}) => {
  await signInAsIvy(page);
  await page.goto(`./#/replications/${ALPHA}`);
  await expect(page.getByRole("heading", { level: 1, name: ALPHA })).toBeVisible();
  await expect(page).toHaveTitle(new RegExp(`^${ALPHA} \\|`));
  const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
  await expect(breadcrumb.getByRole("link", { name: "Replications" })).toBeVisible();
  await expect(breadcrumb).toContainText(ALPHA);
  await expect(page.getByText("Demonstration data").first()).toBeVisible();
  await expect(page.getByTestId("replication-status")).toContainText("Collecting");
  await expect(page.getByRole("tab")).toHaveText(TABS);
  // A member who does not lead the replication reads it and cannot edit it.
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change status" })).toHaveCount(0);

  const panel = page.getByRole("tabpanel");
  await expect(panel).toContainText("Citation verified");
  await expect(panel.getByRole("link", { name: "10.5555/demo.alpha" })).toHaveAttribute(
    "href",
    "https://doi.org/10.5555/demo.alpha",
  );
  const extraction = page.getByTestId("extraction-fields");
  await expect(extraction).toContainText("24 (12 per group)");
  await expect(extraction).toContainText("Demonstration data");
  await expect(panel).toContainText("BIDS name");
  await expect(panel).toContainText("demoalpha");
  await expect(page.getByRole("region", { name: "Signing up" })).toContainText("Open");
  await reviewPage(page, "replication-overview");

  await page.getByRole("tab", { name: "Laboratories" }).click();
  await expect(panel).toContainText("Demo Attention Laboratory");
  const historical = page.getByTestId("historical-figures");
  // The figures of the demonstration world are labelled by their own origin, never as the programme's records.
  await expect(historical).toContainText("Demonstration data");
  await expect(historical).not.toContainText("Imported historical");
  await expect(historical).toContainText("No as-of date in the source");
  await expect(historical.getByTestId("modalities")).toContainText("340");
  await expect(historical.getByTestId("modalities")).toContainText("120");
  await expect(historical).toContainText("never added together");
  await expect(historical).not.toContainText("460");
  await reviewPage(page, "replication-laboratories");

  await page.getByRole("tab", { name: "Hypotheses" }).click();
  const first = page.getByTestId("hypothesis").first();
  await expect(first).toContainText("sig");
  await expect(first).toContainText("Unverified source value");
  await expect(first).toContainText("Not scientifically reviewed");
  // The historical "replicated" label is restricted to the team of the replication and the programme.
  await expect(first).toContainText("Shown to the team of the replication and to the programme only");
  await expect(first).not.toContainText("partially");

  await page.getByRole("tab", { name: "Publications" }).click();
  await expect(panel).toContainText("In-principle acceptance");
  await expect(panel).toContainText("Journal of Examples");
  await expect(panel).toContainText("2024");
  await page.getByRole("tab", { name: "Contributors" }).click();
  await expect(panel).toContainText(
    "Conceptualization, Methodology, Writing – original draft (unverified source value: x)",
  );
  await expect(panel).not.toContainText("@example.org");
  await page.getByRole("tab", { name: "Documents" }).click();
  await expect(panel).toContainText("Analysis plan (synthetic)");
  // A link restricted to the team is not served to a member outside it.
  await expect(panel).not.toContainText("Team folder (synthetic)");
  await page.getByRole("tab", { name: "Activity" }).click();
  await expect(panel).toContainText("Planning to Collecting");
  await expect(page).toHaveURL(/tab=activity/);
  await reviewPage(page, "replication-activity");

  // A replication with nothing but its overview shows nothing else, and says what is unknown.
  await page.goto("./#/replications/DemoDelta2015");
  await expect(page.getByRole("tab")).toHaveText(["Overview"]);
  await expect(page.getByTestId("replication-status")).toContainText("Not recorded");
  await expect(page.getByText("Not on the public website")).toBeVisible();
  await expect(page.getByRole("tabpanel")).toContainText("Citation not found");

  // Where the sources disagree on the lead, the team of the replication is told so plainly.
  await page.goto("./#/replications/DemoGamma2010?tab=leadership");
  await expect(page.getByTestId("lead-conflict")).toContainText("has not confirmed");
  await expect(page.getByRole("tabpanel")).toContainText("Needs review");
  await expect(page.getByRole("link", { name: "Open the memberships to review" })).toHaveCount(0);
  await reviewPage(page, "replication-leadership");
});

test("a lead edits the replication in place and changes its status; the rules and the function refuse another member", async ({
  page,
  browser,
  baseURL,
}) => {
  const lead = await leadBrowser(browser, baseURL as string);
  try {
    const leadPage = lead.page;
    await leadPage.goto(`./#/replications/${ALPHA}`);
    await expect(leadPage.getByRole("heading", { level: 1, name: ALPHA })).toBeVisible();

    // An edit shows at once and is stored.
    await leadPage.getByRole("button", { name: "Edit short title" }).click();
    await leadPage.getByLabel("New value of short title").fill("Demonstration study Alpha, edited by its lead");
    await leadPage.getByRole("button", { name: "Save" }).click();
    await expect(leadPage.getByRole("tabpanel")).toContainText("Demonstration study Alpha, edited by its lead");
    await expect
      .poll(async () => (await adminDb.doc(`replications/${ALPHA}`).get()).get("shortTitle"))
      .toBe("Demonstration study Alpha, edited by its lead");

    // A value that does not fit the shared schema is refused before anything is sent.
    await leadPage.getByRole("button", { name: "Edit year" }).click();
    await leadPage.getByLabel("New value of year").fill("1066");
    await leadPage.getByRole("button", { name: "Save" }).click();
    await expect(leadPage.getByText("Enter a year from 1800 to 2200.")).toBeVisible();
    await leadPage.getByRole("button", { name: "Cancel" }).click();
    await reviewPage(leadPage, "replication-lead");

    // A change to a citation that was checked marks it as unverified, so no badge vouches for a
    // citation nobody checked. The citation is put back afterwards for the tests that follow.
    const stored = (await adminDb.doc(`replications/${ALPHA}`).get()).data() ?? {};
    try {
      await expect(leadPage.getByTestId("citation-edit-note")).toBeVisible();
      await leadPage.getByRole("button", { name: "Edit authors" }).click();
      await leadPage.getByLabel("New value of authors").fill("Example, A. and Sample, B. (edited by the lead)");
      await leadPage.getByRole("button", { name: "Save" }).click();
      await expect(leadPage.getByRole("tabpanel")).toContainText("Citation unverified");
      await expect(leadPage.getByRole("tabpanel")).not.toContainText("Citation verified");
      await expect
        .poll(async () => (await adminDb.doc(`replications/${ALPHA}`).get()).get("citationStatus"))
        .toBe("unverified");
    } finally {
      await adminDb.doc(`replications/${ALPHA}`).update({
        originalAuthors: stored.originalAuthors,
        citationStatus: stored.citationStatus,
      });
    }

    // The status changes through the function, with a reason, and the change is in the activity.
    await leadPage.getByRole("button", { name: "Change status" }).click();
    const dialog = leadPage.getByRole("dialog", { name: `Change the status of ${ALPHA}` });
    await dialog.getByRole("button", { name: "Change status" }).click();
    await expect(dialog.getByText("Choose the new status.")).toBeVisible();
    await expect(dialog.getByText("Enter a reason for the change, up to 2,000 characters.")).toBeVisible();
    await dialog.getByLabel("New status").selectOption({ label: "Analysing" });
    await dialog.getByLabel("Reason").fill("Synthetic: collection has ended in every demonstration laboratory.");
    await reviewPage(leadPage, "replication-status-dialog");
    await dialog.getByRole("button", { name: "Change status" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(leadPage.getByTestId("replication-status")).toContainText("Analysing");
    await leadPage.getByRole("tab", { name: "Activity" }).click();
    await expect(leadPage.getByTestId("status-entry").first()).toContainText("Collecting to Analysing");
    await expect(leadPage.getByTestId("status-entry").first()).toContainText("collection has ended");
    const entries = await adminDb
      .collection("statusHistory")
      .where("entityId", "==", ALPHA)
      .where("toStatusKey", "==", "analysing")
      .get();
    expect(entries.docs.map((entry) => entry.get("changedBy"))).toEqual([lead.uid]);
    const audit = await adminDb.collection("auditEvents").where("action", "==", "replication.statusChanged").get();
    expect(audit.docs.some((entry) => entry.get("actorUid") === lead.uid && entry.get("entityId") === ALPHA)).toBe(
      true,
    );

    // The open form of an account whose right has gone is refused by the rules, says so, and undoes the edit.
    await leadPage.getByRole("tab", { name: "Overview" }).click();
    await leadPage.getByRole("button", { name: "Edit theme" }).click();
    await leadPage.getByLabel("New value of theme").fill("A theme the rules refuse");
    // The right is withdrawn in the access document, which is what the rules read, as the access
    // trigger would write it once the role is revoked. Writing it here keeps the test independent
    // of how long the trigger queue of the emulator is at this point of the run.
    const { uid } = lead;
    const accessReference = adminDb.doc(`access/${uid}`);
    const granted = (await accessReference.get()).data();
    if (granted === undefined) throw new Error("The lead has no access document.");
    const withoutAlpha = (keys: unknown) => (keys as string[]).filter((key) => key !== ALPHA && key !== `rep:${ALPHA}`);
    await accessReference.update({
      leadReplicationIds: withoutAlpha(granted.leadReplicationIds),
      manageScopeKeys: withoutAlpha(granted.manageScopeKeys),
      contactReplicationIds: withoutAlpha(granted.contactReplicationIds),
      capabilities: Object.fromEntries(
        Object.entries(granted.capabilities as Record<string, string[]>)
          .map(([field, keys]) => [field, withoutAlpha(keys)] as const)
          .filter(([, keys]) => keys.length > 0),
      ),
    });
    await expect(leadPage.getByRole("button", { name: "Edit short title" })).toHaveCount(0);
    await leadPage.getByRole("button", { name: "Save" }).click();
    await expect(leadPage.getByRole("alert")).toContainText("The change was refused");
    await expect(leadPage.getByRole("tabpanel")).not.toContainText("A theme the rules refuse");
    expect((await adminDb.doc(`replications/${ALPHA}`).get()).get("theme")).toBe("Attention");
    await accessReference.set(granted);
  } finally {
    await lead.context.close();
  }

  // Another member sees no control, and the rules and the function refuse the same changes.
  await signInAsIvy(page);
  await page.goto(`./#/replications/${ALPHA}`);
  await expect(page.getByRole("heading", { level: 1, name: ALPHA })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  const client = createTestClient();
  try {
    const user = await signInWithEmailLinkFromEmulator(client, IVY.email);
    const db = getFirestore(client.app);
    connectFirestoreEmulator(db, HOST, PORTS.firestore);
    const edit = updateDoc(doc(db, `replications/${ALPHA}`), {
      shortTitle: "Edited by a member who does not lead it",
      updatedAt: serverTimestamp(),
      updatedBy: user.uid,
      writeContext: userWriteContext(),
    });
    expect(await errorCodeOf(edit)).toBe("permission-denied");
    expect(
      await errorCodeOf(
        client.call(setReplicationStatusContract, {
          replicationId: ALPHA,
          fromStatusKey: "analysing",
          toStatusKey: "writing",
          reason: "An attempt by a member.",
        }),
      ),
    ).toBe("functions/permission-denied");
  } finally {
    await client.close();
  }
});

test("the member page shows the person their own contact and demographic details and lets them edit what they may", async ({
  page,
}) => {
  await signInAsIvy(page);
  await page.goto(`./#/members/${IVY.personId}`);
  await expect(page.getByRole("heading", { level: 1, name: IVY.name })).toBeVisible();
  await expect(page.getByText("Your profile", { exact: true })).toBeVisible();
  await expect(page.getByTestId("contact-section")).toContainText(IVY.email);
  const demographics = page.getByTestId("demographics-section");
  await expect(demographics).not.toContainText("synthetic gender term B");
  await demographics.getByRole("button", { name: "Show demographic details" }).click();
  await expect(demographics).toContainText("synthetic gender term B");

  // The person edits a profile address in place.
  await page.getByRole("button", { name: "Edit laboratory website" }).click();
  await page.getByLabel("New value of laboratory website").fill("https://example.org/labs/ivy");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("link", { name: "https://example.org/labs/ivy" })).toBeVisible();
  await expect
    .poll(async () => (await adminDb.doc(`persons/${IVY.personId}`).get()).get("labUrl"))
    .toBe("https://example.org/labs/ivy");
  await expect(page.getByRole("button", { name: "Add ORCID iD" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Report a wrong detail" })).toBeVisible();
  // Only the profile addresses are edited here: the name is corrected through a request.
  await expect(page.getByRole("button", { name: "Edit family name" })).toHaveCount(0);
  await reviewPage(page, "member-self");
});

test("an unrelated member sees the directory fields of a person and nothing restricted, without an error", async ({
  page,
}) => {
  await signInAsIvy(page);
  await page.goto(`./#/members/${BEN.personId}`);
  await expect(page.getByRole("heading", { level: 1, name: BEN.name })).toBeVisible();
  const replications = page.getByRole("region", { name: "Replications", exact: true });
  await expect(replications.getByRole("link", { name: ALPHA })).toBeVisible();
  await expect(replications).toContainText("Lead");
  await expect(page.getByRole("region", { name: "Laboratories", exact: true })).toContainText(
    "Demo Attention Laboratory",
  );
  await expect(page.getByTestId("contact-section")).toHaveCount(0);
  await expect(page.getByTestId("demographics-section")).toHaveCount(0);
  await expect(page.getByTestId("link-state")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await expect(page.getByText(BEN.email)).toHaveCount(0);
  await reviewPage(page, "member-other");

  // The rules and the function refuse what the page does not ask for.
  const client = createTestClient();
  try {
    await signInWithEmailLinkFromEmulator(client, IVY.email);
    const db = getFirestore(client.app);
    connectFirestoreEmulator(db, HOST, PORTS.firestore);
    expect(await errorCodeOf(getDoc(doc(db, `persons/${BEN.personId}/private/contact`)))).toBe("permission-denied");
    expect(await errorCodeOf(getDoc(doc(db, `persons/${BEN.personId}/special/demographics`)))).toBe(
      "permission-denied",
    );
    expect(await errorCodeOf(client.call(getPersonDemographicsContract, { personId: BEN.personId }))).toBe(
      "functions/permission-denied",
    );
  } finally {
    await client.close();
  }
});

test("an administrator sees the contact details and the link state, and needs a named grant for demographic details", async ({
  browser,
  baseURL,
}) => {
  const admin = await administratorBrowser(browser, baseURL as string);
  try {
    await admin.page.goto(`./#/members/${BEN.personId}`);
    await expect(admin.page.getByRole("heading", { level: 1, name: BEN.name })).toBeVisible();
    await expect(admin.page.getByTestId("contact-section")).toContainText(BEN.email);
    await expect(admin.page.getByTestId("link-state")).toContainText(/Claimed by an account|No account has claimed/);
    const demographics = admin.page.getByTestId("demographics-section");
    await demographics.getByRole("button", { name: "Show demographic details" }).click();
    await expect(demographics).toContainText("Your account holds no named grant");
    await expect(demographics).not.toContainText("synthetic gender term A");
    await reviewPage(admin.page, "member-admin");
  } finally {
    await admin.context.close();
  }
});
