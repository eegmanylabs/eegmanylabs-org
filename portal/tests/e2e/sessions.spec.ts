// Sessions across browser tabs, and accounts that are stopped from acting.
// Fixtures are synthetic: every address is invented and uses the example.org domain.
import { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "../support/admin";
import { latestSignInLink } from "../support/emulators";
import {
  expect,
  firestoreDatabases,
  liveListenerCount,
  requestSignInLink,
  SIGN_IN_HEADING,
  signIn,
  signOutThroughMenu,
  test,
  uniqueEmail,
} from "./support";

test.describe("two tabs of one browser", () => {
  test("a link opened in a new tab signs in while an older tab has signed out", async ({ page, context }) => {
    const email = uniqueEmail("new.tab");

    // The older tab: signed in earlier, then signed out, and left open.
    await signIn(page, email);
    await expect(page.getByTestId("account-details")).toContainText(email);
    await signOutThroughMenu(page);
    // It keeps no Firestore client running without an account.
    expect(await liveListenerCount(page)).toBe(0);
    expect(await firestoreDatabases(page)).toEqual([]);

    // Later the member asks for a link in that tab and opens it from the email, in a new tab.
    await requestSignInLink(page, email);
    const newTab = await context.newPage();
    await newTab.goto(await latestSignInLink(email));

    // The new tab shows the account, read from the server, on the page that links a profile.
    await expect(newTab.getByRole("heading", { level: 1, name: "Your member profile" })).toBeVisible();
    await expect(newTab.getByTestId("account-details")).toContainText(email);
    await expect(newTab.getByTestId("account-details")).toContainText("Active");
    await expect(newTab.getByRole("alert")).toHaveCount(0);

    // The older tab follows: the browser shares the session, and it shows the account as well.
    await expect(page.getByRole("heading", { level: 1, name: "Your member profile" })).toBeVisible();
    await expect(page.getByTestId("account-details")).toContainText(email);

    // Both stay live: a change made by trusted code reaches each of them.
    const { uid } = await adminAuth.getUserByEmail(email);
    await adminDb.doc(`access/${uid}`).update({ member: true, personId: "person-synthetic-2" });
    await expect(newTab.getByTestId("account-details")).toContainText("Linked to a member profile");
    await expect(page.getByTestId("account-details")).toContainText("Linked to a member profile");
  });

  test("signing out in one tab ends the session in the other, and both work after the next sign-in", async ({
    page,
    context,
  }) => {
    const email = uniqueEmail("both.tabs");
    await signIn(page, email);
    const second = await context.newPage();
    await second.goto("./");
    await expect(second.getByTestId("account-details")).toContainText(email);
    await expect(page.getByTestId("account-details")).toContainText(email);

    await signOutThroughMenu(page);

    // The other tab notices, lets go of everything and shows the sign-in page.
    await expect(second).toHaveURL(/#\/login$/);
    await expect(second.getByRole("heading", { level: 1, name: SIGN_IN_HEADING })).toBeVisible();
    // Only the tab in which the member signed out confirms it.
    await expect(page.getByText("You have signed out.", { exact: true })).toBeVisible();
    await expect(second.getByText("You have signed out.", { exact: true })).toHaveCount(0);
    for (const tab of [page, second]) {
      expect(await liveListenerCount(tab)).toBe(0);
    }
    // The last tab to let go has removed the local copy of the documents.
    await expect.poll(() => firestoreDatabases(page)).toEqual([]);

    // The member signs in again in the first tab. Both tabs show the account, with no failure.
    await requestSignInLink(page, email);
    await page.goto(await latestSignInLink(email));
    for (const tab of [page, second]) {
      await expect(tab.getByRole("heading", { level: 1, name: "Your member profile" })).toBeVisible();
      await expect(tab.getByTestId("account-details")).toContainText(email);
      await expect(tab.getByRole("alert")).toHaveCount(0);
    }
  });
});

test.describe("an account that is stopped from acting", () => {
  // The server ends an open listener by refusing it. The page opens it again a few times before
  // it takes the refusal as final, so these states take some seconds to appear.
  const AFTER_RETRIES = { timeout: 25_000 };

  test("a suspended account loses its data while the page is open, is told why, and returns when reinstated", async ({
    page,
  }) => {
    const email = uniqueEmail("suspended.member");
    await signIn(page, email);
    const panel = page.getByRole("region", { name: "Your account" });
    await expect(panel.getByTestId("account-details")).toContainText(email);
    expect(await firestoreDatabases(page)).toHaveLength(1);
    const { uid } = await adminAuth.getUserByEmail(email);

    // An administrator's tool suspends the account while it is signed in and looking at the page.
    await adminDb.doc(`access/${uid}`).update({ suspended: true });
    await adminDb.doc(`users/${uid}`).update({ status: "suspended" });

    // The account's data leaves the page at once, without a reload by hand.
    await expect(panel.getByTestId("account-details")).toHaveCount(0);
    // Then the page says why, and where to ask about it.
    await expect(panel.getByRole("alert")).toContainText("This account has been suspended.", AFTER_RETRIES);
    await expect(panel.getByRole("link", { name: /Contact the programme/ })).toBeVisible();
    await expect(panel).not.toContainText(email);
    // The browser's copy of the documents is gone as well, and the shell offers nothing to open.
    await expect.poll(() => firestoreDatabases(page)).toEqual([]);
    expect(await liveListenerCount(page)).toBe(0);
    await expect(page.getByRole("button", { name: /^Notifications/ })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);

    // It stays that way on the next start: the rules and the function both refuse.
    await page.reload();
    await expect(panel.getByRole("alert")).toContainText("This account has been suspended.", AFTER_RETRIES);
    await expect(panel.getByTestId("account-details")).toHaveCount(0);
    await expect.poll(() => firestoreDatabases(page)).toEqual([]);

    // Signing out keeps the explanation on the sign-in page.
    await panel.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("heading", { name: "Sign in to the members' portal" })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText("This account has been suspended.");

    // Reinstated: signing in again brings the account back.
    await adminDb.doc(`access/${uid}`).update({ suspended: false });
    await adminDb.doc(`users/${uid}`).update({ status: "active" });
    await signIn(page, email);
    await expect(panel.getByTestId("account-details")).toContainText(email);
    await expect(panel.getByTestId("account-details")).toContainText("Active");
    await expect(panel.getByRole("alert")).toHaveCount(0);
  });

  test("a session is told to sign in again when the account's sessions are ended while the page is open", async ({
    page,
  }) => {
    const email = uniqueEmail("ended.live");
    await signIn(page, email);
    const panel = page.getByRole("region", { name: "Your account" });
    await expect(panel.getByTestId("account-details")).toContainText(email);
    const { uid } = await adminAuth.getUserByEmail(email);

    // Every session of the account that exists now is ended, while this one has the page open.
    await adminDb.doc(`access/${uid}`).update({ sessionsValidAfter: Timestamp.now() });

    await expect(panel.getByTestId("account-details")).toHaveCount(0);
    await expect(panel.getByRole("alert")).toContainText("You need to sign in again.", AFTER_RETRIES);
    await expect(panel.getByRole("alert")).toContainText("This session has been ended. Sign in again to continue.");
    await expect.poll(() => firestoreDatabases(page)).toEqual([]);

    // The button signs out, and a new sign-in is a new session that is accepted.
    await panel.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: SIGN_IN_HEADING })).toBeVisible();
    // A token states the time of sign-in in whole seconds, so the new session has to begin in
    // a later second than the one in which the sessions were ended.
    await page.waitForTimeout(1_100);
    await requestSignInLink(page, email);
    await page.goto(await latestSignInLink(email));
    await expect(page.getByTestId("account-details")).toContainText(email);
  });

  test("a session that was ended while the portal was closed is told to sign in again on the next start", async ({
    page,
  }) => {
    const email = uniqueEmail("ended.away");
    await signIn(page, email);
    await expect(page.getByTestId("account-details")).toContainText(email);
    const { uid } = await adminAuth.getUserByEmail(email);

    // The member leaves the portal. Meanwhile every session of the account is ended.
    await page.goto("about:blank");
    await adminDb.doc(`access/${uid}`).update({ sessionsValidAfter: Timestamp.now() });

    await page.goto("./");
    const panel = page.getByRole("region", { name: "Your account" });
    await expect(panel.getByRole("alert")).toContainText("You need to sign in again.");
    await expect(panel.getByRole("alert")).toContainText("This session has been ended. Sign in again to continue.");
    await expect(panel.getByTestId("account-details")).toHaveCount(0);

    await panel.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/#\/login$/);
    await expect(page.getByRole("heading", { level: 1, name: SIGN_IN_HEADING })).toBeVisible();
  });
});
