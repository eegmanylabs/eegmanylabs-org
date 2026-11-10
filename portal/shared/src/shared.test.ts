// Fixtures are synthetic: invented values on the example.org domain.
import { describe, expect, it } from "vitest";
import { capabilitiesOf, hasCapability } from "./access";
import { isFirestoreBytes } from "./bytes";
import { sessionStartContract } from "./callables";
import { CAPABILITIES } from "./capabilities";
import { COLLECTIONS, ENTITY_COLLECTIONS, entityPath } from "./collections";
import { DEMO_PROJECT_ID, DEMO_PROJECT_PREFIX, FUNCTIONS_REGION } from "./constants";
import { ENTITY_TYPES } from "./entities";
import { DISPLAY_NAME_MAX_LENGTH, normaliseDisplayName, normaliseEmail } from "./identifiers";
import { nestedEntityId } from "./ids";
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
    expect(ENTITY_TYPES).toContain("user");
    expect(Object.keys(ENTITY_COLLECTIONS).sort()).toEqual([...ENTITY_TYPES].sort());
    expect(entityPath("user", "uid-1")).toBe("users/uid-1");
    for (const entityType of ENTITY_TYPES) {
      const entry = COLLECTIONS[ENTITY_COLLECTIONS[entityType]];
      const nested = entry.parent !== null;
      const ids = nested ? ["parent-1", "own-1"] : ["own-1"];
      const expected = entry.path.replace(/\{[^}]+\}/g, () => ids.shift() ?? "");
      expect(entityPath(entityType, nested ? nestedEntityId("parent-1", "own-1") : "own-1")).toBe(expected);
    }
  });

  it("resolves an entity in a subcollection from the identifier of its parent joined to its own", () => {
    expect(entityPath("hypothesis", "AmodioJost2007__h01")).toBe("replications/AmodioJost2007/hypotheses/h01");
    expect(entityPath("equipmentConfiguration", "lab__0f3a__config-1")).toBe(
      "laboratories/lab__0f3a/equipment/config-1",
    );
    expect(() => entityPath("hypothesis", "h01")).toThrow(RangeError);
  });
});

describe("paths", () => {
  it("builds document paths from the collection names", () => {
    expect(COLLECTIONS.users.docPath("uid-1")).toBe(`${COLLECTIONS.users.collectionPath()}/uid-1`);
    expect(COLLECTIONS.access.docPath("uid-1")).toBe(`${COLLECTIONS.access.collectionPath()}/uid-1`);
    expect(COLLECTIONS.auditEvents.docPath("event-1")).toBe(`${COLLECTIONS.auditEvents.collectionPath()}/event-1`);
    expect(COLLECTIONS.users.collectionPath()).toBe("users");
    expect(COLLECTIONS.access.collectionPath()).toBe("access");
    expect(COLLECTIONS.auditEvents.collectionPath()).toBe("auditEvents");
  });

  it.each(["", "a/b", ".", ".."])(
    "refuses the identifier %j, which would change the shape of the path",
    (identifier) => {
      expect(() => COLLECTIONS.users.docPath(identifier)).toThrow(RangeError);
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

describe("isFirestoreBytes", () => {
  it("recognises the byte strings of both SDKs and nothing else", () => {
    expect(isFirestoreBytes(new Uint8Array([1, 2, 3]))).toBe(true);
    expect(isFirestoreBytes({ toUint8Array: () => new Uint8Array() })).toBe(true);
    expect(isFirestoreBytes([1, 2, 3])).toBe(false);
    expect(isFirestoreBytes("AQID")).toBe(false);
    expect(isFirestoreBytes(null)).toBe(false);
  });
});

describe("what the interface shows", () => {
  const signedOut = { signedIn: false, access: null };
  const signedIn = { signedIn: true, access: null };
  const member = { signedIn: true, access: { suspended: false, capabilities: {} } };

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
