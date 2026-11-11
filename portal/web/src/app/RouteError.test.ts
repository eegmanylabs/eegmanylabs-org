// Telling a page whose code could not be downloaded from any other failure of a page.
import { describe, expect, it } from "vitest";
import { isPageDownloadFailure } from "./RouteError";

describe("isPageDownloadFailure", () => {
  it("recognises a dynamic import that the browser could not fetch, in the words of each browser", () => {
    expect(
      isPageDownloadFailure(new TypeError("Failed to fetch dynamically imported module: http://127.0.0.1/a.js")),
    ).toBe(true);
    expect(isPageDownloadFailure(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isPageDownloadFailure(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isPageDownloadFailure(Object.assign(new Error("Loading chunk 3 failed"), { name: "ChunkLoadError" }))).toBe(
      true,
    );
  });

  it("leaves every other failure alone", () => {
    expect(isPageDownloadFailure(new TypeError("Cannot read properties of undefined"))).toBe(false);
    expect(isPageDownloadFailure("a string")).toBe(false);
    expect(isPageDownloadFailure(null)).toBe(false);
  });
});
