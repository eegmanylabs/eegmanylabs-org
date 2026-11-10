// The administration console and the account page in the browser, against the synthetic world
// of `seed:demo`: suspension that reaches an open page, the console closed to a laboratory
// member in the interface, in the rules and in the functions, requests to represent a
// laboratory, the audit log, and the prompt that replaces a privileged page while the second
// factor is missing. Everyone here is invented, and every address uses the example.org domain.
import {
  emptyAccess,
  listAccountClaimsContract,
  listAuditEventsContract,
  listUsersContract,
  requestLabClaimContract,
  setUserStatusContract,
  userWriteContext,
} from "@eegml/shared";
import { collection, connectFirestoreEmulator, getDocs, getFirestore, limit, query } from "firebase/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "../support/admin";
import { createTestClient, errorCodeOf, signInWithEmailLinkFromEmulator, type TestClient } from "../support/client";
import { HOST, PORTS } from "../support/emulators";
import { administratorBrowser, reviewPage } from "./identity-support";
import { expect, signIn, test, uniqueEmail } from "./support";

const ADMIN_ROUTES = [
  ["/admin/claims", "Account claims"],
  ["/admin/lab-claims", "Laboratory claims"],
  ["/admin/corrections", "Correction requests"],
  ["/admin/users", "Users"],
  ["/admin/roles", "Roles and capabilities"],
  ["/admin/audit", "Audit log"],
] as const;

/** A client of the database and the functions, signed in as a member, as a script in a browser would be. */
async function memberClient(email: string): Promise<{ client: TestClient; uid: string }> {
  const client = createTestClient();
  const user = await signInWithEmailLinkFromEmulator(client, email);
  return { client, uid: user.uid };
}

test("an administrator suspends a member, whose open page loses access without a reload", async ({
  page,
  browser,
  baseURL,
}) => {
  // Gus Specimen signs in with his secondary address, which the claim accepts.
  await signIn(page, "gus.specimen.second@example.org");
  await page.goto("./#/");
  await expect(page.getByRole("region", { name: "Your profile", exact: true })).toContainText("Gus Specimen");

  const admin = await administratorBrowser(browser, baseURL as string);
  try {
    await admin.page.goto("./#/admin/users");
    await admin.page.getByLabel("Search accounts").fill("Gus");
    const row = admin.page.getByRole("row").filter({ hasText: "Gus Specimen" });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("gus.specimen.second@example.org");
    await reviewPage(admin.page, "admin-users");

    await row.getByRole("button", { name: "Suspend Gus Specimen" }).click();
    const dialog = admin.page.getByRole("dialog", { name: "Suspend Gus Specimen?" });
    // A reason is required, and the dialog says so before anything is sent.
    await dialog.getByRole("button", { name: "Suspend" }).click();
    await expect(dialog.getByText("Enter a reason, up to 2,000 characters.")).toBeVisible();
    await dialog.getByLabel("Reason").fill("A synthetic reason for a test.");
    await dialog.getByRole("button", { name: "Suspend" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText("Suspended");

    // The member's open page loses the account's data at once, and then says why.
    await expect(page.getByRole("region", { name: "Your profile", exact: true })).toHaveCount(0, { timeout: 25_000 });
    await expect(page.getByRole("alert")).toContainText("This account has been suspended.", {
      timeout: 25_000,
    });

    // Reinstating brings the account back.
    await row.getByRole("button", { name: "Reinstate Gus Specimen" }).click();
    const reinstate = admin.page.getByRole("dialog", { name: "Reinstate Gus Specimen?" });
    await reinstate.getByLabel("Reason").fill("The synthetic matter is resolved.");
    await reinstate.getByRole("button", { name: "Reinstate" }).click();
    await expect(row).toContainText("Active");
  } finally {
    await admin.context.close();
  }
  const { uid } = await adminAuth.getUserByEmail("gus.specimen.second@example.org");
  expect((await adminDb.doc(`access/${uid}`).get()).get("suspended")).toBe(false);
});

test("a laboratory member cannot open the console by its address, and the rules and functions refuse it too", async ({
  page,
}) => {
  // Ivy Pretend, a member of one laboratory, through the demonstration account that claimed her.
  const email = "demo.one@example.org";
  await signIn(page, email);
  const navigation = page.getByRole("navigation", { name: "Main" });
  await expect(navigation.getByRole("link", { name: "Home" })).toBeVisible();
  await expect(navigation.getByRole("heading", { name: "Administration" })).toHaveCount(0);

  for (const [route, title] of ADMIN_ROUTES) {
    await page.goto(`./#${route}`);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("You do not have access to this page.");
    // Nothing of the queue is shown or asked for.
    await expect(page.getByRole("table")).toHaveCount(0);
  }
  await reviewPage(page, "admin-denied");

  // Called directly, every function of the console refuses.
  const { client } = await memberClient(email);
  try {
    expect(await errorCodeOf(client.call(listAccountClaimsContract, {}))).toBe("functions/permission-denied");
    expect(await errorCodeOf(client.call(listUsersContract, {}))).toBe("functions/permission-denied");
    expect(await errorCodeOf(client.call(listAuditEventsContract, {}))).toBe("functions/permission-denied");
    expect(
      await errorCodeOf(
        client.call(setUserStatusContract, { uid: "demo-account-two", status: "suspended", reason: "An attempt." }),
      ),
    ).toBe("functions/permission-denied");
    // And the rules refuse the records the console reads.
    const db = getFirestore(client.app);
    connectFirestoreEmulator(db, HOST, PORTS.firestore);
    expect(await errorCodeOf(getDocs(query(collection(db, "roleAssignments"), limit(10))))).toBe("permission-denied");
    expect(await errorCodeOf(getDocs(query(collection(db, "capabilityGrants"), limit(10))))).toBe("permission-denied");
  } finally {
    await client.close();
  }
});

test("a request to represent a laboratory shows its evidence and is approved in the console", async ({
  page,
  browser,
  baseURL,
}) => {
  // Kept to a test of its own: Ivy Pretend asks to represent her laboratory.
  const { client } = await memberClient("demo.one@example.org");
  try {
    await client.call(requestLabClaimContract, {
      laboratoryId: "demo-lab-cognition",
      requestedRole: "representative",
      message: "I keep the synthetic laboratory's records.",
    });
  } finally {
    await client.close();
  }

  const admin = await administratorBrowser(browser, baseURL as string);
  try {
    await admin.page.goto("./#/admin/lab-claims");
    const row = admin.page.getByRole("row").filter({ hasText: "Demo Cognition Laboratory" });
    await expect(row).toContainText("Ivy Pretend");
    await expect(row).toContainText("Representative");
    await expect(row).toContainText("Their profile lists this laboratory");
    // The laboratory's institution lists other domains than example.org.
    await expect(row).toContainText("Address outside the institution's domains");
    await expect(row).toContainText("I keep the synthetic laboratory's records.");
    await reviewPage(admin.page, "admin-lab-claims");
    await row.getByRole("button", { name: "Approve" }).click();
    await admin.page
      .getByRole("dialog", { name: "Approve this request?" })
      .getByRole("button", { name: "Approve" })
      .click();
    await expect(row).toHaveCount(0);
    await expect(admin.page.getByText("No requests wait for a decision")).toBeVisible();
  } finally {
    await admin.context.close();
  }

  // The member is told.
  await signIn(page, "demo.one@example.org");
  await page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
  await expect(page.getByRole("dialog", { name: "Notifications" })).toContainText(
    "Your request to represent a laboratory was approved",
  );
});

test("the roles page, the audit log and the account page work for an administrator", async ({ browser, baseURL }) => {
  const admin = await administratorBrowser(browser, baseURL as string);
  const page = admin.page;
  try {
    await page.goto("./#/admin/roles");
    await expect(page.getByRole("region", { name: "Active roles" }).getByRole("table")).toContainText(
      "Programme administrator",
    );
    await expect(page.getByRole("region", { name: "Core team capabilities" })).toContainText("roles.manage");
    await reviewPage(page, "admin-roles");

    // Grant a named permission with an end date, then revoke it.
    const grants = page.getByRole("region", { name: "Named permissions" });
    await grants.getByLabel("Account to grant to").fill("Cleo");
    await expect(grants.getByText("No account matches.")).toBeVisible();
    // Nobody grants a capability to their own account.
    await grants.getByLabel("Account to grant to").fill("Ada");
    await grants.getByRole("button", { name: /Ada Example/ }).click();
    await grants.getByLabel("Capability").selectOption("audit.read");
    await grants.getByLabel("Reason").fill("A synthetic reason for a test.");
    await grants.getByRole("button", { name: "Grant permission" }).click();
    await expect(grants.getByRole("alert")).toContainText("You cannot grant a capability to your own account.");
    await grants.getByRole("button", { name: "Choose another account" }).click();
    await grants.getByLabel("Account to grant to").fill("Ivy");
    await grants.getByRole("button", { name: /Ivy Pretend/ }).click();
    await grants.getByRole("button", { name: "Grant permission" }).click();
    const grantRow = grants.getByRole("row").filter({ hasText: "audit.read" });
    await expect(grantRow).toContainText("Active");
    await grantRow.getByRole("button", { name: "Revoke audit.read from Ivy Pretend" }).click();
    const revoke = page.getByRole("dialog", { name: "Revoke this permission?" });
    await revoke.getByLabel("Reason").fill("No longer needed in the test.");
    await revoke.getByRole("button", { name: "Revoke" }).click();
    await expect(grantRow).toContainText("Revoked");

    // The audit log shows that, newest first, with withheld values marked as such.
    await page.goto("./#/admin/audit");
    await page.getByLabel("Action").selectOption({ label: "Capability revoked" });
    await page.getByRole("button", { name: "Show entries" }).click();
    const entry = page.getByTestId("audit-entry").first();
    await expect(entry).toContainText("Capability revoked by Ada Example");
    await page.getByLabel("Action").selectOption({ label: "Account created" });
    await page.getByRole("button", { name: "Show entries" }).click();
    await expect(page.getByTestId("audit-entry").first().getByText("Withheld").first()).toBeVisible();
    await reviewPage(page, "admin-audit");

    // The account page: the address, the profile, the roles, the second factor and signing out.
    await page.goto("./#/account");
    await expect(page.getByTestId("account-identity")).toContainText("demo.admin@example.org");
    await expect(page.getByTestId("account-identity")).toContainText("Ada Example");
    await expect(page.getByTestId("active-roles")).toContainText("Programme administrator for the programme");
    await expect(page.getByRole("region", { name: "Second factor" })).toContainText("Required for your role");
    await reviewPage(page, "account");
  } finally {
    await admin.context.close();
  }
});

test("while the second factor is missing, a privileged page asks for it and the server refuses too", async ({
  page,
}) => {
  // An account whose access document says that it holds a programme role, needs a second factor
  // and has none: what the server writes for an administrator who has not enrolled one.
  const email = uniqueEmail("factor.missing");
  await signIn(page, email);
  const { uid } = await adminAuth.getUserByEmail(email);
  const access = adminDb.doc(`access/${uid}`);
  const seeded = async () => {
    const now = Timestamp.now();
    await access.set({
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: "system:test",
      updatedBy: "system:test",
      archivedAt: null,
      writeContext: userWriteContext(),
      ...emptyAccess(),
      member: true,
      programmeRoles: ["programme_admin"],
      secondFactorRequired: true,
    });
  };
  // The trigger that follows the first sign-in may still resolve the document from its sources.
  // The document is written again until it has stayed as seeded for a moment.
  await expect
    .poll(
      async () => {
        if ((await access.get()).get("secondFactorRequired") !== true) await seeded();
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        return (await access.get()).get("secondFactorRequired");
      },
      { timeout: 20_000 },
    )
    .toBe(true);

  // The navigation lists the console, and each of its pages asks for the factor in its place.
  await page.goto("./#/admin/audit");
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Audit log" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Audit log" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Set up a second factor to continue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show entries" })).toHaveCount(0);
  await reviewPage(page, "second-factor-prompt");
  await page.getByRole("link", { name: "Set up a second factor" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Account and security" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Second factor" })).toContainText("No second factor yet");
  await expect(page.getByTestId("active-roles")).toContainText("Waiting for your second factor");

  // The function refuses the same session, and says why.
  const client = createTestClient();
  try {
    await signInWithEmailLinkFromEmulator(client, email);
    let reason: unknown = null;
    try {
      await client.call(listAuditEventsContract, {});
    } catch (error) {
      reason = (error as { details?: { reason?: unknown } }).details?.reason;
    }
    expect(reason).toBe("secondFactorRequired");
  } finally {
    await client.close();
  }
});
