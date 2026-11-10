import type { Capability } from "@eegml/shared";
import { House } from "lucide-react";
import { describe, expect, it } from "vitest";
import { NAVIGATION, type NavigationEntry, visibleNavigation } from "./navigation";

const entry = (id: string, order: number, requires: string): NavigationEntry => ({
  id,
  label: id,
  to: `/${id}`,
  icon: House,
  // The registry has one capability today. The cast lets the test use ones that do not exist yet.
  requires: requires as Capability,
  order,
});

describe("the navigation registry", () => {
  it("has unique identifiers, paths and positions", () => {
    for (const key of ["id", "to", "order"] as const) {
      const values = NAVIGATION.map((item) => item[key]);
      expect(new Set(values).size, key).toBe(values.length);
    }
  });

  it("shows Home to a signed-in account and nothing to anyone else", () => {
    expect(visibleNavigation(new Set<Capability>(["portal.use"])).map((item) => item.label)).toEqual(["Home"]);
    expect(visibleNavigation(new Set())).toEqual([]);
  });
});

describe("visibleNavigation", () => {
  const entries = [entry("c", 30, "portal.use"), entry("a", 10, "portal.use"), entry("b", 20, "something.else")];

  it("lists entries in ascending order", () => {
    const held = new Set(["portal.use", "something.else"]) as ReadonlySet<Capability>;
    expect(visibleNavigation(held, entries).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves out entries whose capability the account does not hold", () => {
    const held = new Set<Capability>(["portal.use"]);
    expect(visibleNavigation(held, entries).map((item) => item.id)).toEqual(["a", "c"]);
  });
});
