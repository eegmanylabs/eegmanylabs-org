import { describe, expect, it } from "vitest";
import { osfIdentifierOf } from "./osf";

describe("osfIdentifierOf", () => {
  it.each([
    ["https://osf.io/abc12/", "abc12"],
    ["https://osf.io/ABC12/files/osfstorage", "abc12"],
    ["https://osf.io/preprints/psyarxiv/xyz98?view_only=1", "xyz98"],
    ["http://www.osf.io/q1w2e", "q1w2e"],
  ])("reads %s", (address, id) => {
    expect(osfIdentifierOf(address)).toBe(id);
  });

  it.each([
    "https://example.org/abc12",
    "https://osf.io/",
    "https://osf.io/search/",
    "https://osf.io/ab/",
    "not an address",
  ])("refuses %s", (address) => {
    expect(osfIdentifierOf(address)).toBeNull();
  });
});
