// Automated accessibility checks with axe-core. A test fails on any serious or critical finding.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { latestSignInLink } from "../support/emulators";
import { expect, requestSignInLink, signIn, test, uniqueEmail } from "./support";

async function seriousFindings(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map(
      (violation) =>
        `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(" ")).join(", ")})`,
    );
}

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

test("Home has no serious accessibility findings", async ({ page }) => {
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

test("Home on a narrow screen has no serious accessibility findings", async ({ page }) => {
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
