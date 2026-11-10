// The sign-in journey, through the real interface, the emulators and the built application.
// Fixtures are synthetic: every address is invented and uses the example.org domain.
import type { Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "../support/admin";
import { latestSignInLink } from "../support/emulators";
import {
  CONFIRMATION_HEADING,
  expect,
  firestoreDatabases,
  liveListenerCount,
  requestSignInLink,
  SIGN_IN_HEADING,
  signOutThroughMenu,
  test,
  uniqueEmail,
} from "./support";

test("a signed-out visit to Home lands on the sign-in page", async ({ page }) => {
  await page.goto("./");
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: SIGN_IN_HEADING })).toBeVisible();
  await expect(page).toHaveTitle("Sign in | EEGManyLabs members' portal");
});

test("a member signs in with an emailed link, sees their account, and signs out", async ({
  page,
  baseURL,
  monitor,
}) => {
  const email = uniqueEmail("first.visit");

  await page.goto("./");
  await expect(page).toHaveURL(/#\/login$/);
  await requestSignInLink(page, email);

  // The link is read from the Authentication emulator, which stands in for the mailbox.
  await page.goto(await latestSignInLink(email));

  // Home, with the single-use code gone from the address.
  await expect(page).toHaveURL(`${baseURL}#/`);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  await expect(page).toHaveTitle("Home | EEGManyLabs members' portal");
  await expect(
    page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Home", exact: true }),
  ).toHaveAttribute("aria-current", "page");

  // The account state comes from users/{uid} and access/{uid}, which sessionStart has just created.
  const account = page.getByTestId("account-details");
  await expect(account).toContainText(email);
  await expect(account).toContainText("Active");
  await expect(account).toContainText("Not linked yet");
  await expect(page.getByRole("button", { name: `Account: ${email}` })).toBeVisible();

  // sessionStart is called once each time the application starts with an account.
  const sessionStarts = () => monitor.requests.filter((url) => url.endsWith("/sessionStart")).length;
  expect(sessionStarts()).toBe(1);
  // The local copy of the documents exists while the account is signed in.
  expect(await firestoreDatabases(page)).toHaveLength(1);

  // Two documents are watched. The access document is used in two places and has one listener.
  expect(await liveListenerCount(page)).toBe(2);

  // A change made by trusted code shows up without a reload.
  const { uid } = await adminAuth.getUserByEmail(email);
  await adminDb.doc(`access/${uid}`).update({ member: true, personId: "person-synthetic-1" });
  await expect(account).toContainText("Linked to a member profile");

  // The session survives a reload, and the reloaded application reports its start once more.
  // The server does not write for it: the account was seen a moment ago.
  const before = await adminDb.doc(`users/${uid}`).get();
  await page.reload();
  await expect(page.getByTestId("account-details")).toContainText("Linked to a member profile");
  await expect.poll(sessionStarts).toBe(2);
  expect((await adminDb.doc(`users/${uid}`).get()).updateTime?.isEqual(before.updateTime as Timestamp)).toBe(true);

  // Sign out through the account menu. The application starts afresh at the sign-in page.
  await page.getByRole("button", { name: `Account: ${email}` }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByText("You have signed out.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: SIGN_IN_HEADING })).toBeVisible();

  // Nothing the account read stays in the browser: Firestore's local copy is gone, no listener
  // is open, and the address that was typed is forgotten.
  expect(await firestoreDatabases(page)).toEqual([]);
  expect(await liveListenerCount(page)).toBe(0);
  expect(await page.evaluate(() => window.localStorage.getItem("portal.signIn.pending"))).toBeNull();
  expect(await page.evaluate((address) => JSON.stringify({ ...window.localStorage }).includes(address), email)).toBe(
    false,
  );

  // Signed out means signed out: Home sends the visitor back to the sign-in page.
  await page.goto("./#/");
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: SIGN_IN_HEADING })).toBeVisible();
});

test("after signing in, the visitor is returned to the page they asked for", async ({ page, baseURL }) => {
  const email = uniqueEmail("deep.link");
  await page.goto("./#/?from=bookmark");
  await expect(page).toHaveURL(`${baseURL}#/login?next=%2F%3Ffrom%3Dbookmark`);
  await requestSignInLink(page, email);
  await page.goto(await latestSignInLink(email));
  await expect(page).toHaveURL(`${baseURL}#/?from=bookmark`);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
});

test("the confirmation is the same for every address, and a link really is sent to each", async ({ page, context }) => {
  // One address already has an account, the other has never been seen.
  const known = uniqueEmail("known.account");
  await adminAuth.createUser({ email: known, emailVerified: true });
  const unknown = uniqueEmail("never.seen");

  const confirmations: string[] = [];
  for (const email of [known, unknown]) {
    await context.clearCookies();
    await page.goto("./#/login");
    await requestSignInLink(page, email);
    const confirmation = page.getByRole("status").filter({ hasText: CONFIRMATION_HEADING });
    // The confirmation repeats what the visitor typed, so a typing mistake can be seen.
    await expect(confirmation.getByTestId("entered-address")).toHaveText(email);
    // Apart from that, it says the same for both.
    confirmations.push(((await confirmation.textContent()) ?? "").replace(email, "<the address that was typed>"));
    await page.getByRole("button", { name: "Use a different address" }).click();
    // The address is not kept once the visitor has turned away from it.
    await expect(page.getByLabel("Email address")).toBeFocused();
    await expect(page.getByLabel("Email address")).toHaveValue("");
    expect(await page.evaluate(() => window.localStorage.getItem("portal.signIn.pending"))).toBeNull();
  }
  expect(confirmations[0]).toContain("a sign-in link is on its way");
  expect(confirmations[0]).toBe(confirmations[1]);
  expect(confirmations[0]).not.toContain("@");

  // The confirmation was true both times: the mailbox stand-in holds a link for each address.
  for (const email of [known, unknown]) {
    expect(await latestSignInLink(email)).toContain("oobCode=");
  }
});

test("the confirmation takes focus, so a keyboard does not start again from the top", async ({ page }) => {
  await page.goto("./#/login");
  await requestSignInLink(page, uniqueEmail("focus.confirmation"));
  await expect(page.getByRole("heading", { name: CONFIRMATION_HEADING })).toBeFocused();
});

// Refusals that have nothing to do with the address: a rate limit, the daily quota, a portal
// address that is not authorised, and email-link sign-in switched off in the project.
for (const refusal of [
  "TOO_MANY_ATTEMPTS_TRY_LATER",
  "QUOTA_EXCEEDED",
  "UNAUTHORIZED_DOMAIN",
  "OPERATION_NOT_ALLOWED",
]) {
  test(`a request for a link that the service refuses with ${refusal} is not shown as sent`, async ({
    page,
    monitor,
  }) => {
    const email = uniqueEmail("refused.request");
    await page.route("**/accounts:sendOobCode**", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: { code: 400, message: refusal, errors: [{ message: refusal }] } }),
      }),
    );
    await page.goto("./#/login");
    await page.getByLabel("Email address").fill(email);
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("The link could not be sent.");
    await expect(alert).toContainText("Try again later.");
    await expect(page.getByRole("heading", { name: CONFIRMATION_HEADING })).toHaveCount(0);
    // Nothing is remembered for a link that does not exist, and the form is ready for another try.
    expect(await page.evaluate(() => window.localStorage.getItem("portal.signIn.pending"))).toBeNull();
    await expect(page.getByLabel("Email address")).toHaveValue(email);
    expect(monitor.requests.filter((url) => url.includes("sendOobCode"))).toHaveLength(1);

    // Once the service accepts requests again, the same form sends the link.
    await page.unroute("**/accounts:sendOobCode**");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("heading", { name: CONFIRMATION_HEADING })).toBeVisible();
    expect(await latestSignInLink(email)).toContain("oobCode=");
  });
}

test("an address that is not an email address is rejected before anything is sent", async ({ page, monitor }) => {
  await page.goto("./#/login");
  await page.getByLabel("Email address").fill("not-an-address");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  const field = page.getByLabel("Email address");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(/Enter a full email address/);
  // Focus is on the field, so its description, the message, is read out.
  await expect(field).toBeFocused();
  expect(monitor.requests.filter((url) => url.includes("sendOobCode"))).toEqual([]);

  // The message goes as soon as the value changes.
  await page.keyboard.type("@example.org");
  await expect(field).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/Enter a full email address/)).toHaveCount(0);
});

test("a link opened in another browser asks for the address again", async ({ page, browser, baseURL }) => {
  const email = uniqueEmail("other.device");
  await page.goto("./#/login");
  await requestSignInLink(page, email);
  const link = await latestSignInLink(email);

  // A second browser profile: it has no memory of the request.
  const elsewhere = await browser.newContext({ baseURL: baseURL as string });
  try {
    const other = await elsewhere.newPage();
    await other.goto(link);
    await expect(other.getByRole("heading", { level: 1, name: "Confirm your email address" })).toBeVisible();
    await expect(other).not.toHaveURL(/oobCode/);

    await other.getByLabel("Email address").fill("someone.else@example.org");
    await other.getByRole("button", { name: "Finish signing in" }).click();
    await expect(other.getByLabel("Email address")).toHaveAccessibleDescription(
      /not the address this link was sent to/,
    );

    await other.getByLabel("Email address").fill(email);
    await other.getByRole("button", { name: "Finish signing in" }).click();
    await expect(other.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(other.getByTestId("account-details")).toContainText(email);
  } finally {
    await elsewhere.close();
  }
});

test("a link that has already been used is refused and a new one can be requested", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = uniqueEmail("used.link");
  await page.goto("./#/login");
  await requestSignInLink(page, email);
  const usedLink = await latestSignInLink(email);
  await page.goto(usedLink);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();

  const elsewhere = await browser.newContext({ baseURL: baseURL as string });
  try {
    const other = await elsewhere.newPage();
    await other.goto(usedLink);
    await other.getByLabel("Email address").fill(email);
    await other.getByRole("button", { name: "Finish signing in" }).click();
    await expect(other.getByText("That sign-in link no longer works.")).toBeVisible();
    await expect(other.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
  } finally {
    await elsewhere.close();
  }
});

test("a link is still good after the sign-in service could not be reached, and one press completes it", async ({
  page,
  baseURL,
}) => {
  const email = uniqueEmail("flaky.connection");
  await page.goto("./#/login");
  await requestSignInLink(page, email);
  // The connection drops just as the link is opened.
  await page.route("**/accounts:signInWithEmailLink**", (route) => route.abort("connectionfailed"));
  await page.goto(await latestSignInLink(email));

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("The portal could not reach the sign-in service.");
  await expect(alert).toContainText("Your link has not been used.");
  await expect(page.getByText("That sign-in link no longer works.")).toHaveCount(0);
  await expect(page).not.toHaveURL(/oobCode/);
  // The address is still remembered, so nothing has to be typed again.
  expect(await page.evaluate(() => window.localStorage.getItem("portal.signIn.pending"))).toContain(email);

  await page.unroute("**/accounts:signInWithEmailLink**");
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page).toHaveURL(`${baseURL}#/`);
  await expect(page.getByTestId("account-details")).toContainText(email);
});

test("a disabled account is told so, and is not sent round for new links", async ({ page }) => {
  const email = uniqueEmail("disabled.account");
  const { uid } = await adminAuth.createUser({ email, emailVerified: true });
  await page.goto("./#/login");
  await requestSignInLink(page, email);
  const link = await latestSignInLink(email);
  await adminAuth.updateUser(uid, { disabled: true });

  await page.goto(link);

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("This account has been disabled.");
  await expect(alert).toContainText("Contact a programme administrator.");
  await expect(page.getByText("That sign-in link no longer works.")).toHaveCount(0);
  await expect(alert.getByRole("button")).toHaveCount(0);
});

test("a visitor who is asked for the address can give up on the link and ask for a new one", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = uniqueEmail("gives.up");
  await page.goto("./#/login");
  await requestSignInLink(page, email);
  const elsewhere = await browser.newContext({ baseURL: baseURL as string });
  try {
    const other = await elsewhere.newPage();
    await other.goto(await latestSignInLink(email));
    await expect(other.getByRole("heading", { level: 1, name: "Confirm your email address" })).toBeVisible();
    await other.getByRole("button", { name: "Ask for a new link" }).click();
    await expect(other.getByRole("heading", { level: 1, name: SIGN_IN_HEADING })).toBeVisible();
    await expect(other.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    await expect(other.getByRole("alert")).toHaveCount(0);
  } finally {
    await elsewhere.close();
  }
});

test("a used link that a signed-in member opens again is not held against them later", async ({ page }) => {
  const email = uniqueEmail("reopened.link");
  await page.goto("./");
  await requestSignInLink(page, email);
  const usedLink = await latestSignInLink(email);
  await page.goto(usedLink);
  await expect(page.getByTestId("account-details")).toContainText(email);

  // The link is opened again while the account is signed in. The portal says so at once.
  await page.goto(usedLink);
  await expect(page.getByText("You are already signed in.", { exact: true })).toBeVisible();
  await expect(page.getByTestId("account-details")).toContainText(email);
  await expect(page).not.toHaveURL(/oobCode/);

  // After a sign-out the sign-in page carries no complaint about that link.
  await signOutThroughMenu(page);
  await expect(page.getByText("You have signed out.", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("That sign-in link no longer works.")).toHaveCount(0);
});

test("Google sign-in is not offered unless the build enables it", async ({ page }) => {
  await page.goto("./#/login");
  await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Google/ })).toHaveCount(0);
});

test("an address that matches no route shows the not-found page", async ({ page }) => {
  await page.goto("./#/no/such/page");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  await page.getByRole("link", { name: "Go to Home" }).click();
  await expect(page).toHaveURL(/#\/login$/);
});
