// What the built pages load, what their policy allows, and how they look.
import { createServer } from "node:http";
import { HOST, PORTS } from "../support/emulators";
import { elementsWithBoxShadow, expect, signIn, test, uniqueEmail } from "./support";

const FONT_AND_CDN_HOSTS = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn|jsdelivr|unpkg|cloudflare|googletagmanager/i;

test("the pages load nothing from a font service or a content delivery network", async ({ page, monitor }) => {
  const email = uniqueEmail("self.hosted");
  await signIn(page, email);
  await expect(page.getByTestId("account-details")).toContainText(email);
  await page.evaluate(() => document.fonts.ready);

  // DM Sans is the one typeface (decision D-018). It is in use and came from the portal's own address.
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replaceAll('"', "")),
  );
  expect(new Set(loaded)).toEqual(new Set(["DM Sans Variable"]));
  const declared = await page.evaluate(() => [...document.fonts].map((face) => face.family.replaceAll('"', "")));
  expect(new Set(declared)).toEqual(new Set(["DM Sans Variable"]));
  // Page titles are set in it as well, like all other text.
  const families = await page.evaluate(() =>
    ["h1", "h2", "body", "button"].map((selector) => {
      const element = document.querySelector(selector);
      return element ? getComputedStyle(element).fontFamily.split(",")[0]?.replaceAll('"', "").trim() : null;
    }),
  );
  expect(families).toEqual(["DM Sans Variable", "DM Sans Variable", "DM Sans Variable", "DM Sans Variable"]);
  const fontRequests = monitor.requests.filter((url) => url.endsWith(".woff2"));
  expect(fontRequests.length).toBeGreaterThan(0);
  for (const url of fontRequests) expect(new URL(url).host).toBe(`${HOST}:${PORTS.preview}`);

  expect(monitor.requests.filter((url) => FONT_AND_CDN_HOSTS.test(new URL(url).host))).toEqual([]);
  expect([...monitor.foreignHosts]).toEqual([]);
  expect(monitor.cspViolations).toEqual([]);
});

test("no element has a box shadow, in any state the pages can reach", async ({ page }) => {
  const email = uniqueEmail("no.shadows");

  // Sign-in page, with keyboard focus on the field and with a validation error.
  await page.goto("./#/login");
  await page.getByLabel("Email address").focus();
  expect(await elementsWithBoxShadow(page)).toEqual([]);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  expect(await elementsWithBoxShadow(page)).toEqual([]);

  // Home, with a focused control, an open tooltip and an open menu.
  await signIn(page, email);
  await expect(page.getByTestId("account-details")).toBeVisible();
  expect(await elementsWithBoxShadow(page)).toEqual([]);

  await page.getByRole("button", { name: "Collapse sidebar" }).focus();
  await expect(page.getByRole("tooltip")).toBeVisible();
  expect(await elementsWithBoxShadow(page)).toEqual([]);

  await page.getByRole("button", { name: `Account: ${email}` }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await elementsWithBoxShadow(page)).toEqual([]);
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  // The confirmation toast.
  await expect(page.getByText("You have signed out.", { exact: true })).toBeVisible();
  expect(await elementsWithBoxShadow(page)).toEqual([]);
});

test("no element has a box shadow in the navigation panel of narrow screens", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await signIn(page, uniqueEmail("no.shadows.narrow"));
  await page.getByRole("button", { name: "Open navigation" }).click();
  await expect(page.getByRole("dialog", { name: "Navigation" })).toBeVisible();
  expect(await elementsWithBoxShadow(page)).toEqual([]);
});

test("the policy follows the character-set declaration directly and precedes everything that loads", async ({
  page,
}) => {
  await page.goto("./#/login");
  const head = await page.evaluate(() => {
    const elements = [...document.head.children];
    const policyAt = elements.findIndex((element) => element.getAttribute("http-equiv") === "Content-Security-Policy");
    return {
      first: elements[0]?.outerHTML,
      policyAt,
      policy: elements[policyAt]?.getAttribute("content") ?? "",
      // Elements that fetch or run something, by their position in the head.
      loadersAt: elements.flatMap((element, index) => (/^(SCRIPT|LINK|STYLE)$/.test(element.tagName) ? [index] : [])),
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content"),
      referrer: document.querySelector('meta[name="referrer"]')?.getAttribute("content"),
      themeColour: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
      inkToken: getComputedStyle(document.documentElement).getPropertyValue("--ink-950").trim(),
      inlineScripts: [...document.scripts].filter((script) => !script.src).length,
    };
  });
  expect(head.first).toBe('<meta charset="utf-8">');
  expect(head.policyAt).toBe(1);
  expect(head.loadersAt.length).toBeGreaterThan(0);
  for (const position of head.loadersAt) expect(position).toBeGreaterThan(head.policyAt);
  expect(head.policy).toContain("default-src 'none'");
  expect(head.policy).toContain("script-src 'self';");
  expect(head.policy).not.toContain("unsafe-eval");
  expect(head.policy).toContain("font-src 'self'");
  expect(head.robots).toBe("noindex, nofollow");
  expect(head.referrer).toBe("strict-origin-when-cross-origin");
  // The colour of the browser's interface is the graphite of the design tokens.
  expect(head.themeColour).toBe(head.inkToken);
  expect(head.themeColour).toMatch(/^#[0-9a-f]{6}$/);
  expect(head.inlineScripts).toBe(0);
});

test("the policy is enforced: inline scripts do not run and other hosts cannot be reached", async ({
  page,
  monitor,
}) => {
  monitor.expectProblems();
  await page.goto("./#/login");
  await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();

  // The emulator hub is running and local, but it is not in connect-src. Even this request must
  // be refused, which shows that the policy decides and not the network.
  const outcome = await page.evaluate(async (hubUrl) => {
    const script = document.createElement("script");
    script.textContent = "window.__inlineScriptRan = true;";
    document.body.append(script);
    const reachedOtherHost = await fetch(hubUrl).then(
      () => true,
      () => false,
    );
    return { inlineScriptRan: "__inlineScriptRan" in window, reachedOtherHost };
  }, `http://${HOST}:${PORTS.hub}/`);
  expect(outcome).toEqual({ inlineScriptRan: false, reachedOtherHost: false });
  // Outside the page, the same address answers.
  expect((await fetch(`http://${HOST}:${PORTS.hub}/`)).ok).toBe(true);
  expect(monitor.cspViolations.some((violation) => violation.startsWith("script-src"))).toBe(true);
  expect(monitor.cspViolations.some((violation) => violation.startsWith("connect-src"))).toBe(true);
});

test("the application does not start inside a frame on another site", async ({ page, baseURL, monitor }) => {
  monitor.expectProblems();
  // A page on another origin that frames the portal.
  const framingPage = `<!doctype html><title>Another site</title><iframe src="${baseURL}#/login" width="800" height="600"></iframe>`;
  const otherSite = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(framingPage);
  });
  await new Promise<void>((resolve) => otherSite.listen(PORTS.secondOrigin, HOST, resolve));
  try {
    await page.goto(`http://${HOST}:${PORTS.secondOrigin}/`);
    // The guard asks the browser to show the portal in the whole window. A browser may refuse
    // that to a frame nobody has clicked in. Either way the portal must not be usable in the frame.
    const brokeOut = await page
      .waitForURL(`${baseURL}#/login`, { timeout: 3_000 })
      .then(() => true)
      .catch(() => false);
    if (brokeOut) {
      await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
    } else {
      const frame = page.frameLocator("iframe");
      await expect(frame.locator("html")).toHaveAttribute("data-framed", "true");
      await expect(frame.locator("#root")).toBeEmpty();
      await expect(frame.locator("body")).toBeHidden();
    }
  } finally {
    await new Promise((resolve) => otherSite.close(resolve));
  }
});

test("the server sends files and nothing else, as GitHub Pages does", async ({ request, baseURL }) => {
  const index = await request.get(`${baseURL}`);
  expect(index.status()).toBe(200);
  // No header carries a policy: what protects the page has to be in the page.
  expect(index.headers()["content-security-policy"]).toBeUndefined();
  expect(index.headers()["x-frame-options"]).toBeUndefined();
  const missing = await request.get(`${baseURL}no-such-file`);
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toContain("<h1>Page not found</h1>");
});

// GitHub Pages answers every unknown address with 404.html, however deep the address is.
for (const unknown of ["no-such-page", "replications/AmodioJost2007", "a/b/c"]) {
  test(`an unknown address ${unknown} shows a page that says so and leads back to the portal`, async ({
    page,
    baseURL,
  }) => {
    const failed: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400 && response.url() !== `${baseURL}${unknown}`) failed.push(response.url());
    });
    page.on("requestfailed", (request) => failed.push(request.url()));

    const response = await page.goto(`${baseURL}${unknown}`);
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Page not found | EEGManyLabs members' portal");

    // The page is complete at any depth: its font arrives and nothing it asks for is missing.
    await page.evaluate(() => document.fonts.ready);
    const fonts = await page.evaluate(() =>
      [...document.fonts].map((face) => `${face.family.replaceAll('"', "")}: ${face.status}`),
    );
    expect(fonts).toEqual(["DM Sans Variable: loaded"]);
    expect(failed).toEqual([]);
    expect(await page.evaluate(() => document.scripts.length)).toBe(0);
    expect(await elementsWithBoxShadow(page)).toEqual([]);

    // Its one link works from the keyboard and ends at the portal, which asks a visitor to sign in.
    await page.keyboard.press("Tab");
    const link = page.getByRole("link", { name: "Go to the members' portal" });
    await expect(link).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(`${baseURL}#/login`);
    await expect(page.getByRole("button", { name: "Email me a sign-in link" })).toBeVisible();
  });
}

test("the primary button is deep coral with a white label, as the tokens define them", async ({ page }) => {
  await page.goto("./#/login");
  const colours = await page.getByRole("button", { name: "Email me a sign-in link" }).evaluate((button) => {
    // The browser reports computed colours as rgb(). A probe gives the tokens in the same notation.
    const probe = document.createElement("span");
    document.body.append(probe);
    const resolved = (token: string) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    };
    const style = getComputedStyle(button);
    const result = {
      background: style.backgroundColor,
      label: style.color,
      border: style.borderTopColor,
      deepCoral: resolved("--aqua-deep"),
      coral: resolved("--aqua"),
      white: resolved("--paper-strong"),
    };
    probe.remove();
    return result;
  });
  expect(colours.deepCoral).toBe("rgb(169, 53, 58)");
  expect(colours.white).toBe("rgb(255, 255, 255)");
  expect(colours.background).toBe(colours.deepCoral);
  expect(colours.border).toBe(colours.deepCoral);
  expect(colours.label).toBe(colours.white);
  // Coral itself is for focus and indicators, never the fill behind a small white label.
  expect(colours.background).not.toBe(colours.coral);

  // Focus is drawn in coral, as an outline.
  await page.getByLabel("Email address").focus();
  const focus = await page.getByLabel("Email address").evaluate((field) => {
    const style = getComputedStyle(field);
    return { colour: style.outlineColor, style: style.outlineStyle, width: style.outlineWidth };
  });
  expect(focus).toEqual({ colour: colours.coral, style: "solid", width: "3px" });
});
