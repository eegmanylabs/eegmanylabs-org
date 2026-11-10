// The converters that the data layer builds from the collection registry.
// Fixtures are synthetic: an invented account on the example.org domain.
import { emptyAccess, userWriteContext } from "@eegml/shared";
import type { QueryDocumentSnapshot, SnapshotOptions } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";
import { converterOf, DataShapeError } from "./converter";

const now = { seconds: 1_767_323_045, nanoseconds: 0, toDate: () => new Date(0), toMillis: () => 0 };
const standard = {
  schemaVersion: 1,
  createdAt: now,
  updatedAt: now,
  createdBy: "uid-synthetic",
  updatedBy: "uid-synthetic",
  archivedAt: null,
  writeContext: userWriteContext(),
};
const user = {
  ...standard,
  emailLower: "synthetic.person@example.org",
  displayName: null,
  personId: null,
  status: "active",
  mfaEnrolled: false,
  lastSeenAt: now,
  dataOrigin: "live",
};

/** A stand-in for the snapshot that Firestore hands a converter. */
function snapshot(path: string, data: unknown) {
  const read = vi.fn((_options?: SnapshotOptions) => data);
  const stub = { id: path.split("/").at(-1), ref: { path }, data: read };
  return { stub: stub as unknown as QueryDocumentSnapshot, read };
}

describe("converterOf", () => {
  it("reads a stored document, validates it against the schema of its entry and adds its identifier", () => {
    const { stub, read } = snapshot("users/uid-synthetic", user);
    expect(converterOf("users").fromFirestore(stub)).toEqual({ ...user, id: "uid-synthetic" });
    // A pending server timestamp is given a local value, so a document just written locally validates.
    expect(read).toHaveBeenCalledWith({ serverTimestamps: "estimate" });
  });

  it("serves every entry of the registry from its own schema", () => {
    const access = { ...standard, ...emptyAccess() };
    expect(converterOf("access").fromFirestore(snapshot("access/uid-synthetic", access).stub)).toEqual({
      ...access,
      id: "uid-synthetic",
    });
    // The same data is no user: each key validates with the schema of its own entry.
    expect(() => converterOf("users").fromFirestore(snapshot("users/uid-synthetic", access).stub)).toThrow(
      DataShapeError,
    );
    expect(converterOf("users")).toBe(converterOf("users"));
    expect(converterOf("users")).not.toBe(converterOf("access"));
  });

  it("leaves out a field it does not know, so a document from a newer version can still be read", () => {
    const { stub } = snapshot("users/uid-synthetic", { ...user, addedLater: { anything: true } });
    expect(converterOf("users").fromFirestore(stub)).toEqual({ ...user, id: "uid-synthetic" });
  });

  it("refuses a document that does not match, naming its path and fields and never its values", () => {
    const { stub } = snapshot("users/uid-synthetic", { ...user, status: "deleted-secret-value", mfaEnrolled: "yes" });
    let raised: unknown;
    try {
      converterOf("users").fromFirestore(stub);
    } catch (error) {
      raised = error;
    }
    expect(raised).toBeInstanceOf(DataShapeError);
    const error = raised as DataShapeError;
    expect(error.code).toBe("data/invalid-shape");
    expect(error.kind).toBe("users");
    expect(error.path).toBe("users/uid-synthetic");
    expect([...error.fields].sort()).toEqual(["mfaEnrolled", "status"]);
    expect(error.message).not.toContain("deleted-secret-value");
  });

  it("writes the fields of a record without its identifier", () => {
    expect(converterOf("users").toFirestore({ ...user, id: "uid-synthetic" } as never)).toEqual(user);
  });
});
