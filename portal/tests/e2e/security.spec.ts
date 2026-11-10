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

  // Both families are in use and both came from the portal's own address.
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family.replaceAll('"', "")),
  );
  expect(new Set(loaded)).toEqual(new Set(["DM Sans Variable", "Fraunces Variable"]));
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

test("the policy is the first element of the document head and the other meta elements are present", async ({
  page,
}) => {
  await page.goto("./#/login");
  const head = await page.evaluate(() => ({
    first: document.head.firstElementChild?.getAttribute("http-equiv"),
    policy: document.head.firstElementChild?.getAttribute("content") ?? "",
    robots: document.querySelector('meta[name="robots"]')?.getAttribute("content"),
    referrer: document.querySelector('meta[name="referrer"]')?.getAttribute("content"),
    inlineScripts: [...document.scripts].filter((script) => !script.src).length,
  }));
  expect(head.first).toBe("Content-Security-Policy");
  expect(head.policy).toContain("default-src 'none'");
  expect(head.policy).toContain("script-src 'self';");
  expect(head.policy).not.toContain("unsafe-eval");
  expect(head.policy).toContain("font-src 'self'");
  expect(head.robots).toBe("noindex, nofollow");
  expect(head.referrer).toBe("strict-origin-when-cross-origin");
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

test("an unknown path gets the 404 page, which is a copy of the application", async ({ request, baseURL }) => {
  const index = await request.get(`${baseURL}`);
  expect(index.status()).toBe(200);
  const missing = await request.get(`${baseURL}no-such-file`);
  expect(missing.status()).toBe(404);
  expect(await missing.text()).toBe(await index.text());
  // No header carries a policy: like GitHub Pages, the server sends only the files.
  expect(index.headers()["content-security-policy"]).toBeUndefined();
  expect(index.headers()["x-frame-options"]).toBeUndefined();
});
