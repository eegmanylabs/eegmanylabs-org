// The sign-in journey, through the real interface, the emulators and the built application.
import { adminAuth, adminDb } from "../support/admin";
import { latestSignInLink } from "../support/emulators";
import {
  CONFIRMATION_HEADING,
  expect,
  liveListenerCount,
  requestSignInLink,
  SIGN_IN_HEADING,
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

  // sessionStart was called once for this sign-in.
  expect(monitor.requests.filter((url) => url.endsWith("/sessionStart"))).toHaveLength(1);

  // Two documents are watched. The access document is used in two places and has one listener.
  expect(await liveListenerCount(page)).toBe(2);

  // A change made by trusted code shows up without a reload.
  const { uid } = await adminAuth.getUserByEmail(email);
  await adminDb.doc(`access/${uid}`).update({ member: true, personId: "person-synthetic-1" });
  await expect(account).toContainText("Linked to a member profile");

  // The session survives a reload.
  await page.reload();
  await expect(page.getByTestId("account-details")).toContainText("Linked to a member profile");

  // Sign out through the account menu.
  await page.getByRole("button", { name: `Account: ${email}` }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByText("You have signed out.", { exact: true })).toBeVisible();

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

test("the confirmation is the same for every address", async ({ page, context }) => {
  // One address already has an account, the other has never been seen.
  const known = uniqueEmail("known.account");
  await adminAuth.createUser({ email: known, emailVerified: true });
  const unknown = uniqueEmail("never.seen");

  const confirmations: (string | null)[] = [];
  for (const email of [known, unknown]) {
    await context.clearCookies();
    await page.goto("./#/login");
    await requestSignInLink(page, email);
    confirmations.push(await page.getByRole("status").filter({ hasText: CONFIRMATION_HEADING }).textContent());
    await page.getByRole("button", { name: "Use a different address" }).click();
  }
  expect(confirmations[0]).toContain("a sign-in link is on its way");
  expect(confirmations[0]).toBe(confirmations[1]);
  expect(confirmations[0]).not.toContain("@");
});

test("an address that is not an email address is rejected before anything is sent", async ({ page, monitor }) => {
  await page.goto("./#/login");
  await page.getByLabel("Email address").fill("not-an-address");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  const field = page.getByLabel("Email address");
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(/Enter a full email address/);
  expect(monitor.requests.filter((url) => url.includes("sendOobCode"))).toEqual([]);
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
