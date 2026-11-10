import type { Capability } from "@eegml/shared";
import { House } from "lucide-react";
import { describe, expect, it } from "vitest";
import { NAVIGATION, type NavigationEntry, navigationEntry, visibleNavigation } from "./navigation";

const entry = (id: string, order: number, requires: string): NavigationEntry => ({
  id,
  label: id,
  to: `/${id}`,
  icon: House,
  // The cast lets the test use capabilities that do not exist.
  requires: requires as Capability,
  order,
  group: "main",
});

describe("the navigation registry", () => {
  it("has unique identifiers, paths and positions", () => {
    for (const key of ["id", "to", "order"] as const) {
      const values = NAVIGATION.map((item) => item[key]);
      expect(new Set(values).size, key).toBe(values.length);
    }
  });

  it("shows Home and the account page to a signed-in account and nothing to anyone else", () => {
    expect(visibleNavigation(new Set<Capability>(["portal.use"])).map((item) => item.label)).toEqual([
      "Home",
      "Account and security",
    ]);
    expect(visibleNavigation(new Set())).toEqual([]);
  });

  it("lists the page that links a profile in place of Home while the account is not linked", () => {
    const held = new Set<Capability>(["portal.use"]);
    // Home sends an account that is not linked to the claim page, so it is not offered.
    expect(visibleNavigation(held, NAVIGATION, false).map((item) => item.to)).toEqual(["/claim", "/account"]);
    expect(visibleNavigation(held, NAVIGATION, true).map((item) => item.to)).toEqual(["/", "/account"]);
  });

  it("puts every administration page behind the capability its data and actions need", () => {
    const administration = NAVIGATION.filter((item) => item.group === "administration");
    expect(Object.fromEntries(administration.map((item) => [item.to, item.requires]))).toEqual({
      "/admin/claims": "claims.review",
      "/admin/lab-claims": "labs.claims.review",
      "/admin/corrections": "reconciliation.resolve",
      "/admin/users": "users.suspend",
      "/admin/roles": "roles.manage",
      "/admin/audit": "audit.read",
    });
    expect(visibleNavigation(new Set<Capability>(["portal.use", "audit.read"])).map((item) => item.id)).toEqual([
      "home",
      "account",
      "admin-audit",
    ]);
  });

  it("finds an entry by its identifier, and fails loudly for one that does not exist", () => {
    expect(navigationEntry("admin-users").requires).toBe("users.suspend");
    expect(() => navigationEntry("missing")).toThrow("missing");
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
