// The claim journey in the browser, against the synthetic world of `seed:demo`: an imported
// member claims the profile the programme holds, an address that two people share goes to an
// administrator, an address that matches nobody asks for access, a management role that the
// records imply waits for an administrator, and the whole journey works by keyboard alone.
// Everyone here is invented, and every address uses the example.org domain.
import { userWriteContext } from "@eegml/shared";
import { connectFirestoreEmulator, doc, getFirestore, serverTimestamp, updateDoc } from "firebase/firestore";
import { adminAuth, adminDb } from "../support/admin";
import { createTestClient, errorCodeOf, signInWithEmailLinkFromEmulator } from "../support/client";
import { HOST, latestSignInLink, PORTS } from "../support/emulators";
import { administratorBrowser, claimOutcome, reviewPage } from "./identity-support";
import { expect, requestSignInLink, signIn, signOutThroughMenu, test, uniqueEmail } from "./support";

/** The person "Ben Sample": the principal investigator of one laboratory and the lead of one replication. */
const BEN = { email: "ben.sample@example.org", personId: "demo-person-ben" };

test.describe
  .serial("acceptance scenario 1: an imported member claims the profile the programme holds", () => {
    test("signs in by email link, is linked, and sees the right laboratory and replication", async ({ page }) => {
      await signIn(page, BEN.email);

      // An account that is not linked is taken to the claim page, which links it at once and
      // goes on to Home, where a panel says once that the account is now linked.
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
      await expect(page).toHaveURL(/#\/$/);
      await expect(page.getByTestId("just-linked")).toContainText("Account linked");
      const profile = page.getByRole("region", { name: "Your profile" }).getByTestId("profile-summary");
      await expect(profile).toContainText("Ben Sample");
      await expect(profile).toContainText("Demo Attention Laboratory");
      await expect(profile).toContainText("Demonstration study Alpha (synthetic) (DemoAlpha2001)");
      // Nothing of the other laboratories or replications of the world.
      await expect(profile).not.toContainText("Demo Memory Laboratory");
      await expect(profile).not.toContainText("DemoBeta2005");

      // The management roles that the records imply wait for an administrator, and say so.
      const pending = page.getByRole("region", { name: "Roles waiting for confirmation" });
      await expect(pending).toContainText("Replication lead for Demonstration study Alpha (synthetic) (DemoAlpha2001)");
      await expect(pending).toContainText("Laboratory coordinator for Demo Attention Laboratory");
      // Home is the current destination of the navigation, and the claim page is no longer offered.
      const navigation = page.getByRole("navigation", { name: "Main" });
      await expect(navigation.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
      await expect(navigation.getByRole("link", { name: "Your member profile" })).toHaveCount(0);
      await reviewPage(page, "home-just-linked");

      // The record on the server: one person linked to one account.
      const { uid } = await adminAuth.getUserByEmail(BEN.email);
      const person = (await adminDb.doc(`persons/${BEN.personId}`).get()).data();
      expect(person?.userId).toBe(uid);
      expect((await adminDb.doc(`accountClaims/${uid}`).get()).data()).toMatchObject({
        status: "approved",
        personId: BEN.personId,
      });

      // The panel is said once: a reload shows Home without it.
      await page.reload();
      await expect(page.getByRole("region", { name: "Your profile" })).toContainText("Demo Attention Laboratory");
      await expect(page.getByTestId("just-linked")).toHaveCount(0);
    });

    test("a second sign-in creates no duplicate account, link or role", async ({ page }) => {
      const { uid } = await adminAuth.getUserByEmail(BEN.email);
      const snapshot = async () => ({
        accounts: (await adminAuth.listUsers()).users.filter((user) => user.email === BEN.email).length,
        users: (await adminDb.collection("users").where("emailLower", "==", BEN.email).get()).size,
        linkedPersons: (await adminDb.collection("persons").where("userId", "==", uid).get()).size,
        claims: (await adminDb.collection("accountClaims").where("uid", "==", uid).get()).size,
        roles: (await adminDb.collection("roleAssignments").where("uid", "==", uid).get()).docs
          .map((role) => role.id)
          .sort(),
      });
      const before = await snapshot();
      expect(before).toMatchObject({ accounts: 1, users: 1, linkedPersons: 1, claims: 1 });

      await signIn(page, BEN.email);
      // A linked account goes straight to Home.
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Your profile" })).toContainText("Ben Sample");
      expect(await snapshot()).toEqual(before);
      expect((await adminAuth.getUserByEmail(BEN.email)).uid).toBe(uid);
    });

    test("a pending replication lead role confers no lead rights until an administrator approves it", async ({
      page,
      browser,
      baseURL,
    }) => {
      // The member, as a client of the database: a lead may edit the replication's definition.
      // The abstract is edited, because the citation of this replication has been checked and
      // changes only through editReplicationCitation.
      const client = createTestClient();
      try {
        const user = await signInWithEmailLinkFromEmulator(client, BEN.email);
        const db = getFirestore(client.app);
        connectFirestoreEmulator(db, HOST, PORTS.firestore);
        const editAsLead = () =>
          updateDoc(doc(db, "replications/DemoAlpha2001"), {
            abstract: "A synthetic abstract, edited in a test.",
            updatedAt: serverTimestamp(),
            updatedBy: user.uid,
            writeContext: userWriteContext(),
          });
        expect(await errorCodeOf(editAsLead())).toBe("permission-denied");

        await signIn(page, BEN.email, "./#/account");
        await expect(page.getByTestId("pending-roles")).toContainText("Replication lead for");
        await expect(page.getByTestId("active-roles")).not.toContainText("Replication lead");

        // An administrator confirms the role in the console.
        const admin = await administratorBrowser(browser, baseURL as string);
        try {
          await admin.page.goto("./#/admin/roles");
          const pending = admin.page.getByRole("region", { name: "Roles waiting for confirmation" });
          await pending.getByRole("button", { name: "Confirm Replication lead for Ben Sample" }).click();
          await expect(pending.getByRole("button", { name: "Confirm Replication lead for Ben Sample" })).toHaveCount(0);
        } finally {
          await admin.context.close();
        }

        // The member's open page follows without a reload, and the right now works.
        await expect(page.getByTestId("active-roles")).toContainText("Replication lead for");
        await expect(page.getByTestId("pending-roles")).not.toContainText("Replication lead");
        await expect.poll(async () => errorCodeOf(editAsLead()), { timeout: 15_000 }).toBe("(no error)");
        // The member is notified, and the notification leads to the account page.
        const bell = page.getByRole("button", { name: /^Notifications, \d+ unread$/ });
        await expect(bell).toBeVisible();
        await bell.click();
        await expect(page.getByRole("dialog", { name: "Notifications" })).toContainText(
          "You now hold the role Replication lead",
        );
      } finally {
        await client.close();
      }
    });
  });

test("an address that two people share goes to review, and an administrator approves it in the console", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page, "shared.mock@example.org");
  const outcome = claimOutcome(page);
  await expect(outcome.getByRole("heading", { name: "An administrator needs to review your account" })).toBeVisible();
  await expect(outcome).toContainText("You do not need to do anything else");
  await reviewPage(page, "claim-review");
  // The member may tell the reviewer something that helps tell the two records apart, once.
  await outcome.getByLabel("Your name").fill("Hugo Mock");
  await outcome.getByLabel("Affiliation").fill("Northfield Example University");
  await outcome.getByLabel("Message").fill("I joined the synthetic laboratory in 2024.");
  await outcome.getByRole("button", { name: "Send to the administrator" }).click();
  await expect(outcome.getByRole("button", { name: "Send to the administrator" })).toHaveCount(0);

  const admin = await administratorBrowser(browser, baseURL as string);
  try {
    // Home counts what waits in the queue and links to it.
    await admin.page.goto("./#/");
    const queues = admin.page.getByTestId("review-queues");
    await expect(queues.getByRole("link", { name: /Account claims/ })).toBeVisible();
    await reviewPage(admin.page, "home-administrator");
    await queues.getByRole("link", { name: /Account claims/ }).click();
    await expect(admin.page.getByRole("heading", { level: 1, name: "Account claims" })).toBeVisible();

    // The claim is headed by the name the member stated, marked as unverified, beside the verified address.
    const card = admin.page.getByRole("article", { name: "Hugo Mock (unverified name)" });
    await expect(card).toContainText("shared.mock@example.org");
    const candidates = card.getByTestId("claim-candidates");
    await expect(candidates.getByRole("radio")).toHaveCount(2);
    // The reviewer is told why the claim is here, and what the member wrote.
    await expect(card).toContainText("Address held by more than one person");
    await expect(card).toContainText("I joined the synthetic laboratory in 2024.");
    await expect(candidates).toContainText("Holds this address as primary");
    await reviewPage(admin.page, "admin-claims");
    // Nothing is chosen for the administrator when the candidates are several.
    await expect(card.getByRole("button", { name: "Approve and link" })).toBeDisabled();
    await expect(candidates).toContainText("Hana Mock");
    await expect(candidates).toContainText("Hugo Mock");
    await candidates.getByRole("radio", { name: "Hugo Mock" }).check();
    await card.getByRole("button", { name: "Approve and link" }).click();
    await admin.page
      .getByRole("dialog", { name: "Link this account?" })
      .getByRole("button", { name: "Approve and link" })
      .click();
    await expect(admin.page.getByText("Hugo Mock is now linked.", { exact: true })).toBeVisible();
    await expect(card).toHaveCount(0);

    // The claimant's open page goes on to Home without a reload, says that the account is linked and shows the profile.
    await expect(page.getByTestId("just-linked")).toContainText("Account linked");
    await expect(page.getByRole("region", { name: "Your profile", exact: true })).toContainText("Hugo Mock");
  } finally {
    await admin.context.close();
  }
});

test("an address that matches nobody asks for access, and the request waits for an administrator", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page, "demo.two@example.org");
  const outcome = claimOutcome(page);
  await expect(outcome.getByRole("heading", { name: "We could not find a profile for this address" })).toBeVisible();
  await expect(outcome.getByRole("button", { name: "Sign out and use another address" })).toBeVisible();
  await reviewPage(page, "claim-no-match");

  // The form checks what it can before it sends anything.
  await outcome.getByRole("button", { name: "Send request" }).click();
  await expect(outcome.getByText("Enter your name, up to 200 characters.")).toBeVisible();
  await expect(outcome.getByLabel("Your name")).toBeFocused();

  await outcome.getByLabel("Your name").fill("Demo Account Two");
  await outcome.getByLabel("Affiliation").fill("Ridgeway Example College");
  await outcome.getByLabel("Message").fill("I collect data for a synthetic replication.");
  await outcome.getByRole("button", { name: "Send request" }).click();
  await expect(outcome.getByRole("heading", { name: "An administrator needs to review your account" })).toBeFocused();
  await expect(outcome).toContainText("Sent for review on");

  // After a reload the page still shows the request that was made, and offers no second form.
  await page.reload();
  await expect(
    claimOutcome(page).getByRole("heading", { name: "An administrator needs to review your account" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Send request" })).toHaveCount(0);

  const admin = await administratorBrowser(browser, baseURL as string);
  try {
    await admin.page.goto("./#/admin/claims");
    const card = admin.page.getByRole("article", { name: "Demo Account Two" });
    await expect(card).toContainText("Asked for access");
    await expect(card).toContainText("Ridgeway Example College");
    await expect(card).toContainText("I collect data for a synthetic replication.");
  } finally {
    await admin.context.close();
  }
});

test("a member reports a wrong detail of the profile, and an administrator resolves it", async ({
  page,
  browser,
  baseURL,
}) => {
  // Ivy Pretend's profile was claimed by the demonstration account when the world was seeded.
  await signIn(page, "demo.one@example.org");
  const profile = page.getByRole("region", { name: "Your profile" });
  await profile.getByRole("button", { name: "Report a wrong detail" }).click();
  const dialog = page.getByRole("dialog", { name: "Report a wrong detail" });
  await dialog.getByLabel("Which detail is wrong").selectOption({ label: "Affiliation" });
  await dialog.getByLabel("What it should say").fill("Ridgeway Example College, synthetic department");
  await dialog.getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText("Your report has been sent.", { exact: true })).toBeVisible();
  await expect(profile).toContainText("Affiliation: Ridgeway Example College, synthetic department");
  await reviewPage(page, "home-member");

  const admin = await administratorBrowser(browser, baseURL as string);
  try {
    await admin.page.goto("./#/admin/corrections");
    const row = admin.page.getByRole("row").filter({ hasText: "Ridgeway Example College, synthetic department" });
    await expect(row).toContainText("Ivy Pretend");
    await reviewPage(admin.page, "admin-corrections");
    await row.getByRole("button", { name: "Resolve" }).click();
    const resolve = admin.page.getByRole("dialog", { name: "Resolve this report" });
    await resolve.getByLabel("Message to the member").fill("Corrected in the directory.");
    await resolve.getByRole("button", { name: "Resolve" }).click();
    // The dialog closes once the server has recorded the outcome.
    await expect(resolve).toHaveCount(0);
    await expect(row).toHaveCount(0);
  } finally {
    await admin.context.close();
  }

  // The member's report is marked, and the notification says so with the administrator's message.
  // The affiliation comes from other records, so the report is accepted and the record not yet corrected.
  await expect(profile.getByText("Accepted, not yet corrected")).toBeVisible();
  await page.getByRole("button", { name: /^Notifications, \d+ unread$/ }).click();
  const panel = page.getByRole("dialog", { name: "Notifications" });
  await expect(panel).toContainText("Your report of a wrong detail was accepted");
  await expect(panel).toContainText("Corrected in the directory.");
  await reviewPage(page, "notifications");
  await panel.getByRole("button", { name: /^Mark as read: Your report/ }).click();
  await expect(panel.getByRole("button", { name: /^Mark as read: Your report/ })).toHaveCount(0);
});

test.describe("by keyboard alone", () => {
  /** Presses Tab until the element has focus, and fails when that takes implausibly long. */
  async function tabTo(page: import("@playwright/test").Page, target: import("@playwright/test").Locator) {
    for (let presses = 0; presses < 40; presses += 1) {
      if (await target.evaluate((element) => element === document.activeElement)) return;
      await page.keyboard.press("Tab");
    }
    throw new Error("The element was not reached with the Tab key.");
  }

  test("a member asks for a link, is linked and reaches Home without a pointer", async ({ page }) => {
    const email = "eli.madeup@example.org";
    await page.goto("./#/login");
    await tabTo(page, page.getByLabel("Email address"));
    await page.keyboard.type(email);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeFocused();
    // Opening the link from the mailbox is a navigation, not a use of the page.
    await page.goto(await latestSignInLink(email));

    // The match links the account and goes on to Home, where the panel that says so is reachable.
    await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(page.getByTestId("just-linked")).toBeVisible();
    await tabTo(page, page.getByRole("button", { name: "Report a wrong detail" }));
    await expect(page.getByRole("region", { name: "Your profile", exact: true })).toContainText("Eli Madeup");
  });

  test("an account without a match fills in and sends its request without a pointer", async ({ page }) => {
    const email = uniqueEmail("keyboard.request");
    await page.goto("./#/login");
    await requestSignInLink(page, email);
    await page.goto(await latestSignInLink(email));
    const outcome = claimOutcome(page);
    await expect(outcome.getByRole("heading", { name: "We could not find a profile for this address" })).toBeVisible();

    await tabTo(page, outcome.getByLabel("Your name"));
    await page.keyboard.type("Keyboard Example");
    await page.keyboard.press("Tab");
    await page.keyboard.type("Northfield Example University");
    await page.keyboard.press("Tab");
    await page.keyboard.type("I work with a synthetic laboratory.");
    await page.keyboard.press("Tab");
    await expect(outcome.getByRole("button", { name: "Send request" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(outcome.getByRole("heading", { name: "An administrator needs to review your account" })).toBeFocused();
  });
});

test("the navigation does not offer the claim page to a linked account, which the claim page sends to Home", async ({
  page,
}) => {
  await signIn(page, "demo.one@example.org", "./#/claim");
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  // The navigation lists the claim page only while an account is not linked.
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Your member profile" }),
  ).toHaveCount(0);
  await signOutThroughMenu(page);
});
