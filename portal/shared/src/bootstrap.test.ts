// Fixtures are synthetic: an invented address on the example.org domain and a secret made up for these tests.
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_ADMINS_COLLECTION,
  bootstrapAdminId,
  bootstrapAdminPath,
  bootstrapAdminRecordSchema,
} from "./bootstrap";
import { COLLECTION_ENTRIES } from "./collections";
import { personEmailIndexId } from "./ids";
import { systemWriteContext } from "./schemas/base";

const SECRET = "synthetic-secret-for-tests-only-0123456789";
const GOLDEN = "7ca035c9f4492d5246b6";

describe("the identifier of a bootstrap record", () => {
  it("is pinned to a golden value, because the command and the function must derive the same one", () => {
    expect(bootstrapAdminId("synthetic.person@example.org", SECRET)).toBe(GOLDEN);
  });

  it("takes the address in canonical form", () => {
    expect(bootstrapAdminId("  Synthetic.Person@Example.ORG ", SECRET)).toBe(GOLDEN);
    expect(bootstrapAdminId("synthetic.person+x@example.org", SECRET)).not.toBe(GOLDEN);
  });

  it("differs from the email index entry of the same address, and from one environment to the next", () => {
    expect(GOLDEN).not.toBe(personEmailIndexId("synthetic.person@example.org", SECRET));
    expect(bootstrapAdminId("synthetic.person@example.org", `${SECRET}-of-another-environment`)).not.toBe(GOLDEN);
  });

  it("gives the path of the record, and refuses anything that is no keyed short hash", () => {
    expect(bootstrapAdminPath(GOLDEN)).toBe(`bootstrapAdmins/${GOLDEN}`);
    expect(() => bootstrapAdminPath("synthetic.person@example.org")).toThrow(RangeError);
    expect(() => bootstrapAdminPath("../users/uid")).toThrow(RangeError);
  });
});

describe("a bootstrap record", () => {
  const at = {
    seconds: 1_700_000_000,
    nanoseconds: 0,
    toDate: () => new Date(1_700_000_000_000),
    toMillis: () => 1_700_000_000_000,
  };
  const record = {
    schemaVersion: 1,
    createdAt: at,
    updatedAt: at,
    createdBy: "system:adminBootstrap",
    updatedBy: "system:adminBootstrap",
    archivedAt: null,
    writeContext: systemWriteContext(),
    usedAt: null,
    usedBy: null,
  };

  it("holds the standard fields and who used it, and nothing else", () => {
    expect(bootstrapAdminRecordSchema.parse(record)).toEqual(record);
    expect(Object.keys(bootstrapAdminRecordSchema.shape).sort()).toEqual(Object.keys(record).sort());
  });

  it("has no field for an address", () => {
    expect(bootstrapAdminRecordSchema.safeParse({ ...record, email: "synthetic.person@example.org" }).success).toBe(
      false,
    );
    expect(
      bootstrapAdminRecordSchema.safeParse({ ...record, emailLower: "synthetic.person@example.org" }).success,
    ).toBe(false);
  });

  it("lives in a collection that the registry leaves closed to every client", () => {
    expect(COLLECTION_ENTRIES.map((entry) => entry.collectionId)).not.toContain(BOOTSTRAP_ADMINS_COLLECTION);
  });
});
