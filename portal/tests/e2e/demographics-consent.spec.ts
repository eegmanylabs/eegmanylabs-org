// Consent to holding gender and ethnicity on the account page, in the browser, against the
// synthetic world of `seed:demo`: a member reviews the consent recorded for them, confirms the
// recorded terms and enters their own words, withdraws (which deletes the values at once), and
// gives consent again by keyboard. The page is checked with axe at 360 and 1440 pixels in each
// state. Ivy and her terms are invented, and her address uses the example.org domain.
import { COLLECTIONS, CURRENT_DEMOGRAPHICS_CONSENT, DEMOGRAPHICS_CONSENT_DECISION } from "@eegml/shared";
import type { Page } from "@playwright/test";
import { Timestamp } from "firebase-admin/firestore";
import { DEMO_ACCOUNTS } from "../../tools/src/fixtures/demo-accounts";
import { DEMO_PERSONS } from "../../tools/src/fixtures/demo-world";
import { adminDb } from "../support/admin";
import { IVY, signInAsIvy } from "./registry-support";
import { expect, seriousFindings, test } from "./support";

const VIEWPORTS = [
  { label: "360", width: 360, height: 780 },
  { label: "1440", width: 1440, height: 900 },
] as const;

/** Axe and the absence of sideways scrolling at the two widths the programme asks for. */
async function reviewAtBothWidths(page: Page, name: string): Promise<void> {
  const original = page.viewportSize();
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    expect(await seriousFindings(page), `${name} at ${viewport.label}`).toEqual([]);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
        message: `${name} scrolls sideways at ${viewport.label}`,
      })
      .toBeLessThanOrEqual(0);
  }
  if (original !== null) await page.setViewportSize(original);
}

const consentPath = COLLECTIONS.personDemographicsConsent.docPath(IVY.personId);
const valuesPath = COLLECTIONS.personDemographics.docPath(IVY.personId);

/** Puts back what `seed:demo` holds for Ivy, so that the suites after this one meet the world they expect. */
async function restoreSeededState(): Promise<void> {
  const seeded = DEMO_PERSONS.find((person) => person.id === IVY.personId)?.demographics;
  const uid = DEMO_ACCOUNTS.find((account) => account.personId === IVY.personId)?.uid ?? "";
  const now = Timestamp.now();
  const standard = {
    schemaVersion: 1,
    createdAt: now,
    updatedAt: now,
    createdBy: "system:seedDemo",
    updatedBy: "system:seedDemo",
    archivedAt: null,
    writeContext: { origin: "system", depth: 0, correlationId: null, causationId: null, auditEventId: null },
  };
  await adminDb.doc(consentPath).set({
    ...standard,
    personId: IVY.personId,
    uid,
    status: "given",
    wordingVersion: CURRENT_DEMOGRAPHICS_CONSENT.version,
    givenAt: now,
    withdrawnAt: null,
    history: [{ status: "given", at: now, wordingVersion: CURRENT_DEMOGRAPHICS_CONSENT.version, auditEventId: null }],
    basis: DEMOGRAPHICS_CONSENT_DECISION,
  });
  await adminDb.doc(valuesPath).set({ ...standard, ...seeded, recordedAt: now });
}

test("a member reviews, uses and withdraws consent to holding their gender and ethnicity, and gives it again by keyboard", async ({
  page,
}) => {
  test.setTimeout(150_000);
  try {
    await signInAsIvy(page);
    await page.goto("./#/account");
    const panel = page.getByRole("region", { name: CURRENT_DEMOGRAPHICS_CONSENT.title });
    await expect(panel.getByTestId("consent-status")).toContainText("Consent given", { timeout: 20_000 });
    // The wording says what is held, who can see it and how to withdraw.
    const wording = panel.getByTestId("consent-wording");
    for (const heading of ["What is held", "Who can see it", "How to withdraw"]) {
      await expect(wording.getByRole("heading", { name: heading })).toBeVisible();
    }
    // The terms recorded for her are read through the audited function, and shown to her alone.
    await expect(panel.getByTestId("recorded-terms")).toContainText("synthetic gender term B", { timeout: 20_000 });
    await reviewAtBothWidths(page, "account-consent-given");

    // She confirms the recorded terms and adds her own words.
    await panel.getByLabel("These recorded terms describe me").check();
    await panel.getByLabel("Your gender, in your own words").fill("Synthetic words of her own");
    await panel.getByRole("button", { name: "Save your values" }).click();
    await expect(panel.getByText(/You confirmed these terms on/)).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByLabel("Your gender, in your own words")).toHaveValue("Synthetic words of her own");
    // Terms confirmed since they were recorded are not offered for confirmation again, so a later save confirms nothing.
    await expect(panel.getByLabel("These recorded terms describe me")).toHaveCount(0);
    const stored = (await adminDb.doc(valuesPath).get()).data();
    expect(stored).toMatchObject({ genderSelfDescribed: "Synthetic words of her own" });
    expect(stored?.confirmedAt).toBeDefined();

    // She withdraws. The values are deleted at once, and the record keeps both acts.
    await panel.getByRole("button", { name: "Withdraw consent" }).click();
    const dialog = page.getByRole("dialog", { name: "Withdraw your consent?" });
    await expect(dialog).toContainText("deleted at once");
    await dialog.getByRole("button", { name: "Withdraw and delete" }).click();
    await expect(panel.getByTestId("consent-status")).toContainText("No consent", { timeout: 20_000 });
    await expect(panel.getByTestId("consent-history")).toContainText("Consent withdrawn");
    await expect(panel.getByTestId("own-demographics")).toHaveCount(0);
    expect((await adminDb.doc(valuesPath).get()).exists).toBe(false);
    expect((await adminDb.doc(consentPath).get()).get("status")).toBe("withdrawn");
    await reviewAtBothWidths(page, "account-consent-withdrawn");

    // She gives it again without a pointer: the statement first, then the button.
    const give = panel.getByRole("button", { name: "Give consent" });
    await expect(give).toBeDisabled();
    await panel.getByLabel(CURRENT_DEMOGRAPHICS_CONSENT.statement).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(give).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(panel.getByTestId("consent-status")).toContainText("Consent given", { timeout: 20_000 });
    // Nothing came back with the new consent: what was deleted stays deleted.
    await expect(panel.getByTestId("own-demographics")).toContainText("No recorded term is held for you now", {
      timeout: 20_000,
    });
    await expect(panel.getByTestId("consent-history").getByRole("listitem")).toHaveCount(3);
  } finally {
    await restoreSeededState();
  }
});
