// The lists of the registry in the browser, against the synthetic world of `seed:demo`: the
// replications and the members directory, with their search, filters, sort, counts, preview
// panel and keyboard use, the filter state in the address, deep links, the Home dashboard and
// the accessibility of each page. Everyone here is invented, and every address uses the
// example.org domain.

import { latestSignInLink } from "../support/emulators";
import { administratorBrowser, reviewPage } from "./identity-support";
import { ALPHA, IVY, rowNamed, signInAsIvy } from "./registry-support";
import { expect, requestSignInLink, test } from "./support";

test("a member searches, filters and sorts the replications, and the address keeps the view", async ({ page }) => {
  await signInAsIvy(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Replications" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Replications" })).toBeVisible();
  const count = page.getByTestId("result-count");
  await expect(count).toHaveText("Showing 4 of 4 replications");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Replications");

  // Every row says what it is: the demonstration data is labelled, and the withdrawn study is marked.
  const alpha = rowNamed(page, /^DemoAlpha2001/);
  await expect(alpha).toContainText("Demonstration data");
  await expect(alpha).toContainText("Example, A. and Sample, B. (2001)");
  await expect(alpha).toContainText("Ben Sample");
  await expect(rowNamed(page, /^DemoDelta2015/)).toContainText("Not on website");
  // A replication without a status says so, and none is shown as zero.
  await expect(rowNamed(page, /^DemoDelta2015/)).toContainText("Not recorded");
  await expect(rowNamed(page, /^DemoDelta2015/)).toContainText("None linked");
  // A lead that waits for review is not shown to a member who cannot read it, and no lead is invented.
  await expect(rowNamed(page, /^DemoGamma2010/)).toContainText("No confirmed lead");

  // A search finds another spelling of the identifier.
  await page.getByLabel("Search replications").fill("demo_beta");
  await expect(count).toHaveText("Showing 1 of 4 replications");
  await expect(rowNamed(page, /^DemoBeta2005/)).toBeVisible();
  await page.getByRole("button", { name: "Clear the search and filters" }).click();
  await expect(count).toHaveText("Showing 4 of 4 replications");

  // Filters go into the address, so the view is shared by its link and survives a reload.
  await page.getByLabel("Theme").selectOption("Memory");
  await page.getByLabel("Public website").selectOption("listed");
  await expect(page).toHaveURL(/theme=Memory/);
  await expect(page).toHaveURL(/listing=listed/);
  await expect(count).toHaveText("Showing 1 of 4 replications");
  await page.reload();
  await expect(page.getByLabel("Theme")).toHaveValue("Memory");
  await expect(count).toHaveText("Showing 1 of 4 replications");
  await page.getByRole("button", { name: "Clear the search and filters" }).click();

  await page.getByLabel("Public website").selectOption("withdrawn");
  await expect(count).toHaveText("Showing 1 of 4 replications");
  await expect(rowNamed(page, /^DemoDelta2015/)).toBeVisible();
  await page.getByLabel("Public website").selectOption("all");
  await page.getByLabel("Status").selectOption("none");
  await expect(rowNamed(page, /^DemoDelta2015/)).toBeVisible();
  await expect(count).toHaveText("Showing 1 of 4 replications");
  await page.getByRole("button", { name: "Clear the search and filters" }).click();

  // Sorting by a column, either way, with the state for assistive technology.
  const study = page.getByRole("columnheader", { name: "Study", exact: true });
  await expect(study).toHaveAttribute("aria-sort", "ascending");
  await study.getByRole("button").click();
  await expect(study).toHaveAttribute("aria-sort", "descending");
  await expect(page).toHaveURL(/dir=desc/);
  const firstRow = page.getByTestId("replications-table").getByRole("row").nth(1);
  await expect(firstRow).toHaveAccessibleName(/^DemoGamma2010/);
  await reviewPage(page, "replications-list");
});

test("a member moves through the replications by keyboard and previews one beside the list", async ({ page }) => {
  await signInAsIvy(page);
  await page.goto("./#/replications");
  const first = rowNamed(page, /^DemoAlpha2001/);
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(rowNamed(page, /^DemoBeta2005/)).toBeFocused();
  await page.keyboard.press("End");
  await expect(rowNamed(page, /^DemoGamma2010/)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(rowNamed(page, /^DemoDelta2015/)).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");

  // The preview opens beside the list without leaving it, takes focus, and is in the address.
  const panel = page.getByRole("complementary", { name: `Preview of ${ALPHA}` });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: ALPHA })).toBeFocused();
  await expect(page).toHaveURL(/open=DemoAlpha2001/);
  await expect(panel).toContainText("Citation verified");
  await expect(panel).toContainText("Collecting");
  await expect(page.getByTestId("replications-table")).toBeVisible();
  await reviewPage(page, "replications-preview");

  // Escape closes it and returns to the row.
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(first).toBeFocused();

  // The full page opens from the preview.
  await page.keyboard.press("Enter");
  await panel.getByRole("link", { name: "Open the full page" }).click();
  await expect(page).toHaveURL(/#\/replications\/DemoAlpha2001$/);
  await expect(page.getByRole("heading", { level: 1, name: ALPHA })).toBeVisible();
});

test("a member searches and filters the members directory, previews a member and opens the profile", async ({
  page,
}) => {
  await signInAsIvy(page);
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
  const count = page.getByTestId("result-count");
  await expect(count).toHaveText(/Showing 12 of 12 members/);
  // Only an administrator sees whether a profile has been claimed.
  await expect(page.getByRole("columnheader", { name: "Profile" })).toHaveCount(0);

  await page.getByLabel("Search members").fill("harbour");
  await expect(count).toHaveText(/Showing 2 of 12 members/);
  await page.getByLabel("Search members").fill("");
  await page.getByLabel("Country").selectOption("DE");
  await expect(page).toHaveURL(/country=DE/);
  await expect(count).toHaveText(/Showing 2 of 12 members/);
  await page.reload();
  await expect(count).toHaveText(/Showing 2 of 12 members/);
  await page.getByLabel("Country").selectOption("");
  await page.getByLabel("Replication").selectOption(ALPHA);
  await expect(count).toHaveText(/Showing 2 of 12 members/);
  await page.getByLabel("Replication").selectOption("");
  await page.getByLabel("Core team").selectOption("yes");
  await expect(count).toHaveText(/Showing 1 of 12 members/);
  await expect(rowNamed(page, /^Jo Dummy/)).toContainText("Demonstration role");
  await page.getByLabel("Core team").selectOption("");
  // A laboratory has no page of its own yet: its people are a filter of the directory.
  await page.getByLabel("Laboratory").selectOption({ label: "Demo Cognition Laboratory" });
  await expect(count).toHaveText(/Showing 2 of 12 members/);
  await page.getByRole("button", { name: "Clear the search and filters" }).click();

  // Sorting by country keeps the people without one last.
  await page.getByRole("columnheader", { name: "Country" }).getByRole("button").click();
  const rows = page.getByTestId("members-table").getByRole("row");
  await expect(rows.nth(1)).toContainText("Germany");
  await reviewPage(page, "members-list");

  // A preview beside the list, then the full profile.
  const ben = rowNamed(page, /^Ben Sample/);
  await ben.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("complementary", { name: "Preview of Ben Sample" });
  await expect(panel).toContainText("Northfield Example University");
  await expect(panel.getByRole("link", { name: ALPHA })).toBeVisible();
  await reviewPage(page, "members-preview");
  await panel.getByRole("link", { name: "Open the full page" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Ben Sample" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Members");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Ben Sample");
});

test("an administrator sees whether profiles are claimed and the leads that wait for review", async ({
  browser,
  baseURL,
}) => {
  const admin = await administratorBrowser(browser, baseURL as string);
  try {
    await admin.page.goto("./#/members?core=yes");
    await expect(admin.page.getByRole("columnheader", { name: "Profile" })).toBeVisible();
    await expect(rowNamed(admin.page, /^Jo Dummy/)).toContainText("Not claimed");
    await admin.page.goto("./#/replications");
    await expect(rowNamed(admin.page, /^DemoGamma2010/)).toContainText("Lead needs review");

    // The review queue of memberships, from the dashboard.
    await admin.page.goto("./#/");
    const queues = admin.page.getByTestId("review-queues");
    await expect(queues.getByRole("link", { name: /Memberships to review/ })).toBeVisible();
    await queues.getByRole("link", { name: /Memberships to review/ }).click();
    await expect(admin.page.getByRole("heading", { level: 1, name: "Memberships to review" })).toBeVisible();
    await expect(admin.page.getByRole("region", { name: "DemoGamma2010", exact: true })).toContainText("Dev Fictional");
    await reviewPage(admin.page, "admin-memberships");
  } finally {
    await admin.context.close();
  }
});

test("Home shows the member's work and a live snapshot of the programme whose figures lead to their lists", async ({
  page,
}) => {
  await signInAsIvy(page);
  await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  const profile = page.getByRole("region", { name: "Your profile", exact: true });
  await expect(profile.getByRole("link", { name: /DemoGamma2010/ })).toBeVisible();
  const snapshot = page.getByTestId("programme-snapshot");
  // Each total says where its records come from.
  await expect(snapshot.getByTestId("snapshot-totals")).toContainText(
    "4 replications (all demonstration data), of which 1 is not on the public website",
  );
  await expect(snapshot.getByTestId("snapshot-totals")).toContainText("12 members (all demonstration data)");
  const byStatus = snapshot.getByRole("region", { name: "Replications by status" });
  await expect(byStatus.getByRole("link", { name: "No status recorded: 1 replication" })).toBeVisible();

  // A chart has a table view with the same figures.
  await byStatus.getByRole("button", { name: "Show as table" }).click();
  await expect(byStatus.getByRole("table")).toContainText("Planning");
  await reviewPage(page, "home-dashboard");
  await byStatus.getByRole("button", { name: "Show as chart" }).click();

  // Each figure is a link to the filtered list it was counted from.
  await byStatus.getByRole("link", { name: /^Planning: 1 replication$/ }).click();
  await expect(page).toHaveURL(/#\/replications\?status=planning$/);
  await expect(page.getByTestId("result-count")).toHaveText("Showing 1 of 4 replications");
  await page.goBack();
  // Every country of the synthetic world has fewer than five members, so none is named with its
  // count, as on the analysis page: they are counted together and lead to the whole directory.
  const byCountry = snapshot.getByRole("region", { name: "Members by country" });
  await expect(byCountry.getByRole("link", { name: /^Germany:/ })).toHaveCount(0);
  await byCountry.getByRole("link", { name: /countries with fewer than 5 members each/ }).click();
  await expect(page).toHaveURL(/#\/members$/);
  await expect(page.getByTestId("result-count")).toHaveText(/12 members/);
  await page.goBack();
  await snapshot
    .getByRole("region", { name: "Publications by status" })
    .getByRole("link", { name: /^In-principle acceptance:/ })
    .click();
  await expect(page).toHaveURL(/publication=inPrincipleAcceptance/);
  await expect(page.getByTestId("result-count")).toHaveText("Showing 1 of 4 replications");
});

test("a deep link opened signed out leads through sign-in to the record and its tab", async ({ page }) => {
  await page.goto("./#/replications/DemoBeta2005?tab=outputs");
  await expect(page).toHaveURL(/#\/login\?next=/);
  await requestSignInLink(page, IVY.email);
  await page.goto(await latestSignInLink(IVY.email));
  await expect(page.getByRole("heading", { level: 1, name: "DemoBeta2005" })).toBeVisible();
  await expect(page).toHaveURL(/#\/replications\/DemoBeta2005\?tab=outputs$/);
  await expect(page.getByRole("tab", { name: "Outputs" })).toHaveAttribute("aria-selected", "true");
  // A reload keeps the record and the tab.
  await page.reload();
  await expect(page.getByRole("tab", { name: "Outputs" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toContainText("a planned synthetic report");

  // An address that names no replication says so, with a way back.
  await page.goto("./#/replications/NoSuchStudy1999");
  await expect(page.getByText("This replication does not exist")).toBeVisible();
  await page.getByRole("link", { name: "Go to the list of replications" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Replications" })).toBeVisible();
});
