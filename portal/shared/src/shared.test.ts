// Fixtures are synthetic: invented values on the example.org domain.
import { describe, expect, it } from "vitest";
import { sessionStartContract } from "./callables";
import { CAPABILITIES, capabilitiesOf, hasCapability } from "./capabilities";
import { DEMO_PROJECT_ID, DEMO_PROJECT_PREFIX, FUNCTIONS_REGION } from "./constants";
import { ENTITY_TYPES, entityPath } from "./entities";
import { DISPLAY_NAME_MAX_LENGTH, normaliseDisplayName, normaliseEmail } from "./identifiers";
import { COLLECTIONS, paths } from "./paths";
import { isFirestoreTimestamp } from "./timestamp";
import { z } from "./zod";

describe("constants", () => {
  it("keeps the functions in London and the emulator project recognisable as a demonstration project", () => {
    expect(FUNCTIONS_REGION).toBe("europe-west2");
    expect(DEMO_PROJECT_ID.startsWith(DEMO_PROJECT_PREFIX)).toBe(true);
  });
});

describe("zod", () => {
  it("runs without compiling code at run time, which the Content-Security-Policy forbids", () => {
    expect(z.config().jitless).toBe(true);
  });
});

describe("normaliseEmail", () => {
  it("trims white space and lowers the case", () => {
    expect(normaliseEmail("  Synthetic.Person@Example.ORG ")).toBe("synthetic.person@example.org");
  });

  it("gives the same result when applied twice", () => {
    const once = normaliseEmail(" A.B@example.org");
    expect(normaliseEmail(once)).toBe(once);
  });
});

describe("normaliseDisplayName", () => {
  it("trims the name and collapses runs of white space", () => {
    expect(normaliseDisplayName("  Synthetic \t\n  Person  ")).toBe("Synthetic Person");
  });

  it("removes control characters and the characters that reorder text", () => {
    expect(normaliseDisplayName("Syn\u0000thetic\u0007 Person")).toBe("Syn thetic Person");
    expect(normaliseDisplayName("\u202Enosrep citehtnys\u202C")).toBe("nosrep citehtnys");
    expect(normaliseDisplayName("\u2066Synthetic\u2069")).toBe("Synthetic");
  });

  it("cuts a long name to the stored maximum without splitting a character", () => {
    expect(normaliseDisplayName("x".repeat(5000))).toHaveLength(DISPLAY_NAME_MAX_LENGTH);
    // Each of these takes two code units. An odd limit must not leave half of one.
    const cut = normaliseDisplayName(`a${"\u{1F600}".repeat(150)}`) ?? "";
    expect(cut.length).toBeLessThanOrEqual(DISPLAY_NAME_MAX_LENGTH);
    expect([...cut].every((character) => character === "a" || character === "\u{1F600}")).toBe(true);
  });

  it.each([
    ["an empty string", ""],
    ["white space only", " \n\t "],
    ["control characters only", "\u0000\u0001"],
  ])("gives null for %s", (_label, value) => {
    expect(normaliseDisplayName(value)).toBeNull();
  });

  it.each([undefined, null, 42, { name: "x" }, ["x"]])("gives null for %j, which is not text", (value) => {
    expect(normaliseDisplayName(value)).toBeNull();
  });

  it("gives the same result when applied twice", () => {
    const once = normaliseDisplayName("  Synthetic   Person ");
    expect(normaliseDisplayName(once)).toBe(once);
  });
});

describe("the entity registry", () => {
  it("resolves every entity type to a document path", () => {
    expect(ENTITY_TYPES).toEqual(["user"]);
    expect(entityPath("user", "uid-1")).toBe("users/uid-1");
  });
});

describe("paths", () => {
  it("builds document paths from the collection names", () => {
    expect(paths.user("uid-1")).toBe(`${COLLECTIONS.users}/uid-1`);
    expect(paths.access("uid-1")).toBe(`${COLLECTIONS.access}/uid-1`);
    expect(paths.auditEvent("event-1")).toBe(`${COLLECTIONS.auditEvents}/event-1`);
  });

  it.each(["", "a/b", ".", ".."])(
    "refuses the identifier %j, which would change the shape of the path",
    (identifier) => {
      expect(() => paths.user(identifier)).toThrow(RangeError);
    },
  );
});

describe("isFirestoreTimestamp", () => {
  it("recognises the shape that both SDKs share and nothing else", () => {
    const date = new Date(0);
    expect(isFirestoreTimestamp({ seconds: 0, nanoseconds: 0, toDate: () => date, toMillis: () => 0 })).toBe(true);
    expect(isFirestoreTimestamp(date)).toBe(false);
    expect(isFirestoreTimestamp({ seconds: 0, nanoseconds: 0 })).toBe(false);
    expect(isFirestoreTimestamp(null)).toBe(false);
  });
});

describe("the capability matrix", () => {
  const signedOut = { signedIn: false, access: null };
  const signedIn = { signedIn: true, access: null };
  const member = { signedIn: true, access: { member: true, personId: "person-synthetic-1" } };

  it("gives a signed-out visitor nothing", () => {
    expect(capabilitiesOf(signedOut).size).toBe(0);
    for (const capability of CAPABILITIES) expect(hasCapability(signedOut, capability)).toBe(false);
  });

  it("lets every signed-in account use the portal, linked or not", () => {
    expect(hasCapability(signedIn, "portal.use")).toBe(true);
    expect(hasCapability(member, "portal.use")).toBe(true);
    expect([...capabilitiesOf(signedIn)]).toEqual(["portal.use"]);
  });
});

describe("sessionStartContract", () => {
  it("takes an empty object and nothing else", () => {
    expect(sessionStartContract.input.safeParse({}).success).toBe(true);
    expect(sessionStartContract.input.safeParse({ uid: "someone-else" }).success).toBe(false);
    expect(sessionStartContract.input.safeParse(null).success).toBe(false);
  });

  it("returns whether the account is a member and which person it is linked to", () => {
    expect(sessionStartContract.output.parse({ member: false, personId: null })).toEqual({
      member: false,
      personId: null,
    });
    expect(sessionStartContract.output.safeParse({ member: false }).success).toBe(false);
    expect(sessionStartContract.output.safeParse({ member: false, personId: null, extra: 1 }).success).toBe(false);
  });
});
