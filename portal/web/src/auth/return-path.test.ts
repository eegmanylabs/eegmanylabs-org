import { describe, expect, it } from "vitest";
import { safeReturnPath, signInPathFor } from "./return-path";

describe("safeReturnPath", () => {
  it.each(["/", "/replications/AmodioJost2007", "/labs/lab-1?tab=people"])("keeps the internal path %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
  });

  it.each([
    ["nothing", null],
    ["an empty value", ""],
    ["an address on another site", "https://example.org/phish"],
    ["a protocol-relative address", "//example.org/phish"],
    ["a path with a backslash", "/\\example.org"],
    ["a relative path", "replications"],
    ["the sign-in page itself", "/login"],
    ["the sign-in page with a destination", "/login?next=/"],
  ])("falls back to Home for %s", (_label, candidate) => {
    expect(safeReturnPath(candidate)).toBe("/");
  });
});

describe("signInPathFor", () => {
  it("leaves the destination out when it is Home", () => {
    expect(signInPathFor("/")).toBe("/login");
  });

  it("carries any other destination in the address", () => {
    expect(signInPathFor("/labs/lab-1?tab=people")).toBe("/login?next=%2Flabs%2Flab-1%3Ftab%3Dpeople");
  });
});
