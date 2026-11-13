// SYNTHETIC values only: the manifests below are invented for the tests.
import { Timestamp } from "firebase-admin/firestore";
import { describe, expect, it } from "vitest";
import {
  type BackupManifest,
  canonicalJson,
  compareManifests,
  contentHash,
  differenceCount,
  MANIFEST_FORMAT,
  parseManifest,
  sortedEntries,
} from "./manifest";
import { emulatorToken } from "./rules-probe";

const manifest = (documents: Record<string, string>): BackupManifest => ({
  format: MANIFEST_FORMAT,
  projectId: "demo-eegml",
  takenAt: "2026-11-13T00:00:00.000Z",
  documents: sortedEntries(Object.entries(documents).map(([key, value]) => ({ key, sha256: contentHash(value) }))),
  accounts: [],
  objects: [],
});

describe("the canonical form of a document", () => {
  it("ignores the order of keys and tells kinds of value apart", () => {
    expect(canonicalJson({ b: 1, a: { d: true, c: "x" } })).toBe(canonicalJson({ a: { c: "x", d: true }, b: 1 }));
    expect(contentHash({ value: 1 })).not.toBe(contentHash({ value: "1" }));
    expect(contentHash({ at: Timestamp.fromMillis(1000) })).not.toBe(
      contentHash({ at: { seconds: 1, nanoseconds: 0 } }),
    );
    expect(contentHash({ at: Timestamp.fromMillis(1000) })).toBe(contentHash({ at: Timestamp.fromMillis(1000) }));
    expect(contentHash({ list: [1, 2] })).not.toBe(contentHash({ list: [2, 1] }));
    expect(contentHash({ bytes: new Uint8Array([1, 2]) })).not.toBe(contentHash({ bytes: new Uint8Array([2, 1]) }));
  });
});

describe("the comparison of a backup with its restore", () => {
  it("finds nothing when both are equal", () => {
    const backup = manifest({ "persons/a": "one", "persons/b": "two" });
    expect(differenceCount(compareManifests(backup, manifest({ "persons/b": "two", "persons/a": "one" })))).toBe(0);
  });

  it("names a missing, a changed and an unexpected document", () => {
    const backup = manifest({ "persons/a": "one", "persons/b": "two", "persons/c": "three" });
    const restored = manifest({ "persons/a": "one", "persons/b": "corrupted", "persons/d": "new" });
    const difference = compareManifests(backup, restored);
    expect(difference.documents).toEqual({ missing: ["persons/c"], changed: ["persons/b"], unexpected: ["persons/d"] });
    expect(differenceCount(difference)).toBe(3);
  });

  it("refuses a manifest that names an entry twice or has another format", () => {
    expect(() =>
      sortedEntries([
        { key: "a", sha256: "x" },
        { key: "a", sha256: "y" },
      ]),
    ).toThrow(/twice/);
    expect(() => parseManifest(JSON.stringify({ ...manifest({}), format: "other" }))).toThrow(/format/);
    const backup = manifest({ "persons/a": "one" });
    expect(parseManifest(JSON.stringify(backup))).toEqual(backup);
  });

  it("holds paths and hashes, never a value", () => {
    const text = JSON.stringify(manifest({ "persons/a": "someone@example.org" }));
    expect(text).not.toContain("example.org");
  });
});

describe("the token of a rules probe", () => {
  it("is unsigned and names the project and the account", () => {
    const [header, payload, signature] = emulatorToken("demo-eegml", "uid-1", 100).split(".");
    expect(JSON.parse(Buffer.from(header ?? "", "base64url").toString())).toEqual({ alg: "none", typ: "JWT" });
    expect(JSON.parse(Buffer.from(payload ?? "", "base64url").toString())).toMatchObject({
      aud: "demo-eegml",
      sub: "uid-1",
    });
    expect(signature).toBe("");
  });
});
