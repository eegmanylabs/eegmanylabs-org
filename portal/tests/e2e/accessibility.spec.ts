// Automated accessibility checks with axe-core. A test fails on any serious or critical finding.
// Fixtures are synthetic: every address is invented and uses the example.org domain.
import { latestSignInLink } from "../support/emulators";
import { signInAsIvy } from "./registry-support";
import { expect, requestSignInLink, seriousFindings, signIn, test, uniqueEmail } from "./support";

test("the sign-in page has no serious accessibility findings", async ({ page }) => {
  await page.goto("./#/login");
  await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);

  // With a validation message showing.
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
  expect(await seriousFindings(page)).toEqual([]);

  // The confirmation.
  await requestSignInLink(page, uniqueEmail("axe.confirmation"));
  expect(await seriousFindings(page)).toEqual([]);
});

test("the page that asks for the address again has no serious accessibility findings", async ({
  page,
  browser,
  baseURL,
}) => {
  const email = uniqueEmail("axe.other.device");
  await page.goto("./#/login");
  await requestSignInLink(page, email);
  const elsewhere = await browser.newContext({ baseURL: baseURL as string });
  try {
    const other = await elsewhere.newPage();
    await other.goto(await latestSignInLink(email));
    await expect(other.getByRole("heading", { level: 1, name: "Confirm your email address" })).toBeVisible();
    expect(await seriousFindings(other)).toEqual([]);
  } finally {
    await elsewhere.close();
  }
});

test("the first page after sign-in has no serious accessibility findings", async ({ page }) => {
  const email = uniqueEmail("axe.home");
  await signIn(page, email);
  await expect(page.getByTestId("account-details")).toContainText(email);
  expect(await seriousFindings(page)).toEqual([]);

  // With the sidebar collapsed to its icon rail.
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);

  // With the account menu open.
  await page.getByRole("button", { name: `Account: ${email}` }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);
});

test("the first page after sign-in on a narrow screen has no serious accessibility findings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page, uniqueEmail("axe.narrow"));
  await expect(page.getByTestId("account-details")).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);

  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);
});

test("the not-found page has no serious accessibility findings", async ({ page }) => {
  await page.goto("./#/no/such/page");
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);
});

test("the page for an unknown address has no serious accessibility findings", async ({ page, baseURL }) => {
  await page.goto(`${baseURL}replications/AmodioJost2007`);
  await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
  expect(await seriousFindings(page)).toEqual([]);
  await expect(page.getByRole("main")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.lang)).toBe("en-GB");
});

test("a page with a checklist, a code block and a table has no serious accessibility findings", async ({ page }) => {
  await signInAsIvy(page);
  await page.goto("./#/pages");
  await page.getByRole("main").getByRole("button", { name: "New page", exact: true }).first().click();
  const dialog = page.getByRole("dialog", { name: "New page" });
  await dialog.getByLabel("Title").fill("Synthetic blocks");
  await dialog.getByRole("button", { name: "Create the page" }).click();
  const editor = page.getByTestId("page-editor").locator(".bn-editor");
  await expect(editor).toBeVisible();
  const slash = async (command: string, option: RegExp) => {
    await page.keyboard.type(command);
    await expect(page.getByRole("option", { name: option })).toBeVisible();
    await page.keyboard.press("Enter");
  };
  // Each block goes on a line of its own, made with the keyboard: a click on the last block can
  // land in a cell of the table, where the menu of blocks does not open.
  const item = editor.locator('[data-content-type="checkListItem"]');
  await editor.locator(".bn-block-content").last().click();
  await slash("/checklist", /Check list/);
  await page.keyboard.type("Book the EEG room");
  // Enter twice leaves the item for a new line, which the next block takes.
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await slash("/table", /Table/);
  await expect(editor.locator("table")).toBeVisible();
  await item.getByText("Book the EEG room").click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await slash("/code", /Code block/);
  await page.keyboard.type("print('synthetic')");
  await expect(editor.locator('[data-content-type="codeBlock"]')).toContainText("print('synthetic')");
  // Every box of the checklist, the empty items the keys left included, has its name.
  for (const box of await editor.locator('[data-content-type="checkListItem"] input[type="checkbox"]').all()) {
    await expect(box).toHaveAttribute("aria-label", "Done");
  }
  await expect(editor.locator('[data-content-type="checkListItem"] input[type="checkbox"]')).not.toHaveCount(0);
  expect(await seriousFindings(page)).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await seriousFindings(page)).toEqual([]);
});
