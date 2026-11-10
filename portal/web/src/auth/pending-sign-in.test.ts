// Addresses are synthetic and use the example.org domain.
import { beforeEach, describe, expect, it, vi } from "vitest";

// The data layer starts Firebase when it is imported. These functions need one check from it.
vi.mock("@/data", () => ({ isSignInLink: (href: string) => href.includes("oobCode=") }));

const {
  clearPendingSignIn,
  captureSignInLink,
  PENDING_LIFETIME_MS,
  readPendingSignIn,
  rememberPendingSignIn,
  signInReturnUrl,
} = await import("./pending-sign-in");

const KEY = "portal.signIn.pending";
const request = { email: "member@example.org", next: "/labs/lab-1" };
const NOW = Date.UTC(2026, 0, 2, 12);

beforeEach(() => {
  window.localStorage.clear();
});

describe("the remembered sign-in request", () => {
  it("is given back while a link can still be expected to work", () => {
    rememberPendingSignIn(request, NOW);
    expect(readPendingSignIn(NOW)).toEqual(request);
    expect(readPendingSignIn(NOW + PENDING_LIFETIME_MS)).toEqual(request);
  });

  it("is forgotten, and removed from the browser, once it is older than a link lasts", () => {
    rememberPendingSignIn(request, NOW);
    expect(readPendingSignIn(NOW + PENDING_LIFETIME_MS + 1)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it.each([
    ["an entry without a time, as earlier versions wrote it", JSON.stringify(request)],
    ["an entry from the future", JSON.stringify({ ...request, requestedAt: NOW + 60_000 })],
    ["an entry with a time that is no number", JSON.stringify({ ...request, requestedAt: "yesterday" })],
    ["text that is not JSON", "{not json"],
    ["an entry without an address", JSON.stringify({ next: null, requestedAt: NOW })],
  ])("removes %s", (_label, stored) => {
    window.localStorage.setItem(KEY, stored);
    expect(readPendingSignIn(NOW)).toBeNull();
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("can be cleared", () => {
    rememberPendingSignIn(request, NOW);
    clearPendingSignIn();
    expect(readPendingSignIn(NOW)).toBeNull();
  });
});

describe("signInReturnUrl", () => {
  it.each([
    ["https://portal.example.org/", "https://portal.example.org/"],
    ["https://portal.example.org/index.html", "https://portal.example.org/"],
    ["https://example.org/portal/", "https://example.org/portal/"],
    ["https://example.org/portal/index.html?x=1#/login", "https://example.org/portal/"],
    ["https://example.org/portal/?apiKey=k&oobCode=c#/login?next=%2F", "https://example.org/portal/"],
    ["http://127.0.0.1:9250/portal/#/", "http://127.0.0.1:9250/portal/"],
  ])("gives the start address of the application for %s", (documentAddress, expected) => {
    expect(signInReturnUrl(documentAddress)).toBe(expected);
  });
});

describe("captureSignInLink", () => {
  function fakes(href: string) {
    const url = new URL(href);
    const replaceState = vi.fn();
    return {
      location: { href, pathname: url.pathname, hash: url.hash } as Location,
      history: { replaceState } as unknown as History,
      replaceState,
    };
  }

  it("returns a sign-in link and takes the single-use code out of the address", () => {
    const href = "https://example.org/portal/?apiKey=k&oobCode=code-1&mode=signIn#/login";
    const { location, history, replaceState } = fakes(href);
    expect(captureSignInLink(location, history)).toBe(href);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/portal/#/login");
  });

  it("leaves any other address alone", () => {
    const { location, history, replaceState } = fakes("https://example.org/portal/#/login?next=%2F");
    expect(captureSignInLink(location, history)).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
