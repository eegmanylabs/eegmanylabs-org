// Governance in the browser, against the synthetic world of `seed:demo`: the subject access
// export downloads a file, an erasure waits for a second administrator, the access review records
// an attestation, and a retention sweep with no period deletes nothing and says so. Everyone here
// is invented, and every address uses the example.org domain.
import { readFileSync } from "node:fs";
import { administratorBrowser, reviewPage } from "./identity-support";
import { expect, signIn, test } from "./support";

test("an administrator uses the four parts of governance", async ({ browser, baseURL }) => {
  const admin = await administratorBrowser(browser, baseURL as string);
  const page = admin.page;
  try {
    await page.goto("./#/admin/governance");
    await expect(page.getByRole("heading", { name: "Governance", level: 1 })).toBeVisible();
    await reviewPage(page, "admin-governance");

    // Subject access: the export of one person downloads as JSON.
    await page.getByLabel("Find the person in the directory").fill("Kit");
    await page.getByRole("radio", { name: /Kit Sampleton/ }).check();
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download the export" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^subject-access-demo-person-kit-\d{4}-\d{2}-\d{2}\.json$/);
    const exported = JSON.parse(readFileSync(await download.path(), "utf8"));
    expect(exported.personId).toBe("demo-person-kit");
    expect(exported.specialCategoryIncluded).toBe(false);
    expect(exported.documents.map((document: { path: string }) => document.path)).toContain(
      "persons/demo-person-kit/private/contact",
    );

    // Erasure of a person linked to an account: the form says so before anything is sent, offers
    // to unlink the account, and holds the request back until then.
    await page.getByRole("tab", { name: "Erasure" }).click();
    await page.getByLabel("Find the person in the directory").fill("Ivy");
    await page.getByRole("radio", { name: /Ivy Pretend/ }).check();
    await expect(page.getByTestId("erasure-linked")).toContainText("This person is linked to an account");
    await page.getByLabel("Reason").fill("A synthetic request made by a test.");
    await expect(page.getByRole("button", { name: "Request the erasure" })).toBeDisabled();
    await page.getByRole("button", { name: "Unlink the account" }).click();
    const unlink = page.getByRole("dialog", { name: "Unlink the account" });
    await expect(unlink).toBeVisible();
    await unlink.getByRole("button", { name: "Cancel" }).click();
    await page.getByLabel("Reason").fill("");

    // Erasure: the request waits, and the administrator who made it cannot decide it.
    await page.getByLabel("Find the person in the directory").fill("Kit");
    await page.getByRole("radio", { name: /Kit Sampleton/ }).check();
    await page.getByLabel("Reason").fill("A synthetic request made by a test.");
    await page.getByRole("button", { name: "Request the erasure" }).click();
    const request = page.getByTestId("erasure-request").filter({ hasText: "Kit Sampleton" });
    await expect(request).toContainText("Waiting for a second administrator");
    await request.getByRole("button", { name: "Approve and erase" }).click();
    const dialog = page.getByRole("dialog", { name: "Approve the erasure" });
    await dialog.getByRole("button", { name: "Erase" }).click();
    await expect(dialog).toContainText("other than the one who asked for it");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(request).toContainText("Waiting for a second administrator");

    // Access review: the listing, and an attestation of it.
    await page.getByRole("tab", { name: "Access review" }).click();
    await expect(page.getByTestId("access-review-account").first()).toBeVisible();
    await expect(page.getByText(/Programme administrator.*appointed by/).first()).toBeVisible();
    await reviewPage(page, "admin-governance-review");
    await page.getByRole("button", { name: "I have reviewed this listing" }).click();
    await expect(page.getByTestId("access-review-attestation")).toHaveCount(1);

    // Retention: with no period configured a sweep deletes nothing and says so.
    await page.getByRole("tab", { name: "Retention" }).click();
    await expect(page.getByTestId("retention-period").first()).toContainText("None: never deleted");
    await page.getByRole("button", { name: "Run a dry run" }).click();
    await expect(page.getByTestId("retention-outcome").first()).toContainText("No period is configured");
    const mail = page.getByTestId("retention-period").filter({ hasText: "Sent and failed messages" });
    await mail.getByRole("spinbutton").fill("90");
    await mail.getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("retention-period").filter({ hasText: "Sent and failed messages" })).toContainText(
      "90 days",
    );
    await reviewPage(page, "admin-governance-retention");
  } finally {
    await admin.context.close();
  }
});

// The functions refuse a member as well, which tests/functions/governance.test.ts proves.
test("governance stays closed to a member in the interface", async ({ page }) => {
  await signIn(page, "demo.one@example.org");
  await page.goto("./#/admin/governance");
  await expect(page.getByText("You do not have access to this page.")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Subject access" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Governance" })).toHaveCount(0);
});
