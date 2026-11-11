// The key under which a list keeps its scroll position. Addresses are synthetic.
import { describe, expect, it } from "vitest";
import { scrollKeyOf } from "./remembered-scroll";

describe("scrollKeyOf", () => {
  it("names the list by its path and filters, whatever preview is open and in whatever order", () => {
    expect(scrollKeyOf("#/members?country=FR&open=p-1")).toBe(scrollKeyOf("#/members?country=FR"));
    expect(scrollKeyOf("#/members?q=ada&country=FR")).toBe(scrollKeyOf("#/members?country=FR&q=ada"));
    expect(scrollKeyOf("#/members?country=FR")).not.toBe(scrollKeyOf("#/members?country=DE"));
    expect(scrollKeyOf("#/members")).not.toBe(scrollKeyOf("#/replications"));
  });
});
