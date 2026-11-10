// Shared fixtures and helpers of the end-to-end tests.
// All accounts are synthetic: invented addresses on the example.org domain.
import AxeBuilder from "@axe-core/playwright";
import { type BrowserContext, test as base, expect, type Page } from "@playwright/test";
import { HOST, latestSignInLink, PORTS } from "../support/emulators";

export { expect };

/** Every host the emulator build may talk to. A request to any other host fails the test. */
const ALLOWED_HOSTS: ReadonlySet<string> = new Set(
  [PORTS.preview, PORTS.auth, PORTS.firestore, PORTS.functions, PORTS.storage].map((port) => `${HOST}:${port}`),
);

export interface Monitor {
  /** Content-Security-Policy violations reported by any page of the context. */
  readonly cspViolations: string[];
  /** Hosts that were requested and are not the preview server or an emulator. */
  readonly foreignHosts: Set<string>;
  /** Errors that no code caught. */
  readonly uncaughtErrors: string[];
  /** Addresses of every HTTP request, in order. */
  readonly requests: string[];
  /** Call in a test that provokes violations or foreign requests on purpose. */
  expectProblems(): void;
}

async function monitorContext(context: BrowserContext): Promise<Monitor & { strict: boolean }> {
  const monitor = {
    cspViolations: [] as string[],
    foreignHosts: new Set<string>(),
    uncaughtErrors: [] as string[],
    requests: [] as string[],
    strict: true,
    expectProblems() {
      monitor.strict = false;
    },
  };
  await context.exposeBinding("__reportCspViolation", (_source, detail: string) => {
    monitor.cspViolations.push(detail);
  });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      const report = (window as unknown as { __reportCspViolation: (detail: string) => void }).__reportCspViolation;
      report(`${event.violatedDirective} blocked ${event.blockedURI || "inline"} on ${event.documentURI}`);
    });
  });
  context.on("weberror", (error) => monitor.uncaughtErrors.push(error.error().message));
  context.on("request", (request) => {
    const url = new URL(request.url());
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    monitor.requests.push(request.url());
    if (!ALLOWED_HOSTS.has(url.host)) monitor.foreignHosts.add(url.host);
  });
  return monitor;
}

/**
 * The test function of this suite. Every test is watched: it fails if the page violates its
 * Content-Security-Policy, talks to a host that is not local, or throws an uncaught error.
 */
export const test = base.extend<{ monitor: Monitor }>({
  monitor: [
    async ({ context }, use) => {
      const monitor = await monitorContext(context);
      await use(monitor);
      if (!monitor.strict) return;
      expect(monitor.cspViolations, "Content-Security-Policy violations").toEqual([]);
      expect([...monitor.foreignHosts], "requests to hosts that are not local").toEqual([]);
      expect(monitor.uncaughtErrors, "uncaught errors").toEqual([]);
    },
    { auto: true },
  ],
});

let counter = 0;

/** An address no other test uses, so tests do not see one another's accounts. */
export function uniqueEmail(label: string): string {
  counter += 1;
  return `${label}.${Date.now().toString(36)}${counter}@example.org`;
}

export const SIGN_IN_HEADING = "Sign in to the members' portal";
export const CONFIRMATION_HEADING = "Check your email";

/** Fills in the sign-in form and waits for the confirmation. The page must be on #/login. */
export async function requestSignInLink(page: Page, email: string): Promise<void> {
  await expect(page.getByRole("heading", { level: 1, name: SIGN_IN_HEADING })).toBeVisible();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: CONFIRMATION_HEADING })).toBeVisible();
}

/** The whole passwordless journey through the interface, ending on the page the link leads to. */
export async function signIn(page: Page, email: string, startAt = "./"): Promise<void> {
  await page.goto(startAt);
  await requestSignInLink(page, email);
  await page.goto(await latestSignInLink(email));
  await expect(page.getByRole("button", { name: /^Account:/ })).toBeVisible();
}

/** Every element whose computed box shadow is not "none", described for the failure message. */
export async function elementsWithBoxShadow(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("*")]
      .filter((element) => getComputedStyle(element).boxShadow !== "none")
      .map((element) => `<${element.tagName.toLowerCase()} class="${element.getAttribute("class") ?? ""}">`),
  );
}

/** Number of open Firestore listeners, read from the hook that emulator builds expose (see web/src/main.tsx). */
export async function liveListenerCount(page: Page): Promise<number | undefined> {
  return page.evaluate(() =>
    (window as unknown as { __portalTest?: { liveListenerCount: () => number } }).__portalTest?.liveListenerCount(),
  );
}

/** Names of the IndexedDB databases in which Firestore keeps its local copy of documents. */
export async function firestoreDatabases(page: Page): Promise<string[]> {
  return page.evaluate(async () =>
    (await indexedDB.databases())
      .map((database) => database.name ?? "")
      .filter((name) => name.startsWith("firestore/")),
  );
}

/** Signs out through the account menu and waits for the fresh sign-in page. */
export async function signOutThroughMenu(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Account:/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.getByRole("heading", { level: 1, name: SIGN_IN_HEADING })).toBeVisible();
}

/** The serious and critical findings of axe-core on the page as it is now, against WCAG 2.2 AA. */
export async function seriousFindings(page: Page): Promise<string[]> {
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
