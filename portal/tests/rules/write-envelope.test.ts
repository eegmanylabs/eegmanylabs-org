// Attacks on the envelope of every direct client write, generated from the collection registry
// and the schemas. For each entry that a client may write, an allowed writer sends a
// well-formed document and then the same document with one thing wrong: a forged author, a
// time of its own choosing, a context that is not a user's, a missing key, an unexpected key,
// the provenance of an import, or a change to a field that the registry keeps from clients.
// Every such request must be refused, and the well-formed one must be accepted.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import {
  COLLECTION_ENTRIES,
  type CollectionEntry,
  clientImmutableFields,
  userWriteContext,
  type WriteOperation,
} from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, doc, serverTimestamp, setDoc, Timestamp, updateDoc } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { outcomeOf } from "./attempts";
import type { Fixture } from "./fixtures";
import { grantedOperations, grantsFor, type Known } from "./policy";
import { fieldSetsOf } from "./schema-fields";
import { fixtureOf, pathOf, restoreDocuments, seedWorld } from "./seed";
import { createRulesEnvironment } from "./support";
import { actingUid, CALLERS, type CallerProfile, createdBy, firestoreOf, STORED_AT, updatedBy } from "./world";

let environment: RulesTestEnvironment;

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-rules-envelope");
  await seedWorld(environment);
});

afterAll(async () => {
  await environment.cleanup();
});

const writable = COLLECTION_ENTRIES.filter(
  (entry) => entry.enforcement === "enforced" && entry.write.mode === "client",
);

/** A time that a client chose for itself: an hour before the request. */
const clientTime = () => Timestamp.fromMillis(Date.now() - 3_600_000);

/** An allowed writer of an operation: an administrator where one may write, and the owner or a member otherwise. */
function writerOf(entry: CollectionEntry, operation: WriteOperation, known: Known): CallerProfile {
  const writer = [CALLERS.admin, CALLERS.owner, CALLERS.member].find(
    (caller) => grantsFor(entry, operation, caller, known).length > 0,
  );
  if (writer === undefined) throw new Error(`Nobody of the world may ${operation} a document of ${entry.key}.`);
  return writer;
}

/** A value that differs from the stored one and has its type. */
function forged(value: unknown): unknown {
  if (typeof value === "string") return `${value}-forged`;
  if (typeof value === "number") return value + 1;
  if (typeof value === "boolean") return !value;
  if (Array.isArray(value)) return [...value, "forged"];
  if (value instanceof Timestamp) return Timestamp.fromMillis(value.toMillis() + 1_000);
  if (typeof value === "object" && value !== null) return { ...value, forged: true };
  return "forged";
}

const IMPORTED: Readonly<Record<string, unknown>> = {
  sourceRecordIds: ["source-record-1"],
  fieldSources: { name: "source-record-1" },
  importedValues: { name: "A value from a source" },
  sourceCreatedAt: STORED_AT,
  sourceUpdatedAt: STORED_AT,
  sourceAuthor: { personId: null, nameSource: "Synthetic Author" },
  sourceRecordId: "source-record-1",
};

/** Runs requests that must all be refused, and returns the labels of those that were not. */
async function wronglyAllowed(requests: Readonly<Record<string, () => Promise<unknown>>>): Promise<string[]> {
  const allowed: string[] = [];
  for (const [label, run] of Object.entries(requests)) {
    if ((await outcomeOf(run)) === "allowed") allowed.push(label);
  }
  return allowed;
}

describe.each(writable.map((entry) => [entry.key, entry] as const))("%s", (key, entry) => {
  const fixture = fixtureOf(key) as Fixture;
  const seedPath = pathOf(entry, fixture.ids);
  const creation = fixture.create;
  const createPath = creation === undefined ? null : pathOf(entry, creation.ids);
  const fields = fieldSetsOf(entry);
  const granted = grantedOperations(entry);

  afterEach(async () => {
    await restoreDocuments(environment, { [seedPath]: fixture.seed }, createPath === null ? [] : [createPath]);
  });

  if (creation !== undefined && createPath !== null && granted.includes("create")) {
    const writer = writerOf(entry, "create", creation.subject ?? fixture.subject);
    const uid = actingUid(writer);
    const wellFormed = () => ({ ...creation.data(uid), ...createdBy(uid, entry.flags.appendOnly) });
    const create = (document: Record<string, unknown>) => () =>
      setDoc(doc(firestoreOf(environment, writer), createPath), document);

    it("refuses a new document with a forged author, time, version or context, and accepts it without", async () => {
      const mutable = entry.flags.appendOnly
        ? { "a key of a document that can be updated": { ...wellFormed(), updatedAt: serverTimestamp() } }
        : {
            "another account as its editor": { ...wellFormed(), updatedBy: "uid-someone-else" },
            "a time of the client's choosing as its last change": { ...wellFormed(), updatedAt: clientTime() },
            "a new document that is already archived": { ...wellFormed(), archivedAt: serverTimestamp() },
          };
      const attacks: Record<string, Record<string, unknown>> = {
        "another account as its author": { ...wellFormed(), createdBy: "uid-someone-else" },
        "a time of the client's choosing as its creation": { ...wellFormed(), createdAt: clientTime() },
        "a schema version of its own": { ...wellFormed(), schemaVersion: 2 },
        "the context of an import": { ...wellFormed(), writeContext: { ...userWriteContext(), origin: "import" } },
        "a context deep in a chain": { ...wellFormed(), writeContext: { ...userWriteContext(), depth: 1 } },
        "a context that names an audit entry": { ...wellFormed(), writeContext: userWriteContext("event-forged") },
        "no context": Object.fromEntries(Object.entries(wellFormed()).filter(([field]) => field !== "writeContext")),
        ...mutable,
      };
      const requests = Object.fromEntries(Object.entries(attacks).map(([label, data]) => [label, create(data)]));
      expect(await wronglyAllowed(requests)).toEqual([]);
      expect(await outcomeOf(create(wellFormed()))).toBe("allowed");
    });

    it("refuses a new document with a required key missing, with an unexpected key or with the provenance of an import", async () => {
      const without = (field: string) =>
        Object.fromEntries(Object.entries(wellFormed()).filter(([name]) => name !== field));
      const attacks: Record<string, Record<string, unknown>> = {
        "an unexpected key": { ...wellFormed(), unexpectedKey: "x" },
        ...Object.fromEntries(fields.required.map((field) => [`without ${field}`, without(field)])),
        ...Object.fromEntries(
          fields.importOnly.map((field) => [`with ${field}`, { ...wellFormed(), [field]: IMPORTED[field] }]),
        ),
      };
      // Every required field of the schema is in the document that was accepted above.
      expect(fields.required.filter((field) => !(field in creation.data(uid)))).toEqual([]);
      const requests = Object.fromEntries(Object.entries(attacks).map(([label, data]) => [label, create(data)]));
      expect(await wronglyAllowed(requests)).toEqual([]);
    });
  }

  if (fixture.update !== undefined && granted.includes("update")) {
    const writer = writerOf(entry, "update", fixture.subject);
    const uid = actingUid(writer);
    const change = fixture.update;
    const wellFormed = () => ({ ...change(uid), ...updatedBy(uid) });
    const update = (patch: Record<string, unknown>) => () =>
      updateDoc(doc(firestoreOf(environment, writer), seedPath), patch);
    const grants = grantsFor(entry, "update", writer, fixture.subject);
    /** The fields the writer may change, or null where the registry does not limit them. */
    const onlyFields = grants.every((grant) => grant.onlyFields !== null)
      ? grants.flatMap((grant) => grant.onlyFields ?? [])
      : null;

    it("refuses a change with a forged editor, time or context, and accepts it without", async () => {
      const attacks: Record<string, Record<string, unknown>> = {
        "another account as its editor": { ...wellFormed(), updatedBy: "uid-someone-else" },
        "a time of the client's choosing": { ...wellFormed(), updatedAt: clientTime() },
        "no editor and no time": { ...change(uid), unstamped: deleteField() },
        "the context of an import": { ...wellFormed(), writeContext: { ...userWriteContext(), origin: "import" } },
        "a context that names an audit entry": { ...wellFormed(), writeContext: userWriteContext("event-forged") },
        "another time of creation": { ...wellFormed(), createdAt: clientTime() },
        "another author": { ...wellFormed(), createdBy: "uid-someone-else" },
        "another schema version": { ...wellFormed(), schemaVersion: 2 },
        "an archive time of the client's choosing": { ...wellFormed(), archivedAt: clientTime() },
        "an unexpected key": { ...wellFormed(), unexpectedKey: "x" },
      };
      const requests = Object.fromEntries(Object.entries(attacks).map(([label, data]) => [label, update(data)]));
      expect(await wronglyAllowed(requests)).toEqual([]);
      expect(await outcomeOf(update(wellFormed()))).toBe("allowed");
    });

    it("refuses a change to the identifier, the scope, the origin, the provenance and what trusted code owns", async () => {
      const immutable = clientImmutableFields(entry).filter(
        (field) => !["schemaVersion", "createdAt", "createdBy"].includes(field),
      );
      const attacks = Object.fromEntries(
        immutable.map((field) => [
          field,
          update({ ...wellFormed(), [field]: forged(fixture.seed[field] ?? IMPORTED[field]) }),
        ]),
      );
      expect(await wronglyAllowed(attacks)).toEqual([]);
    });

    if (onlyFields === null) {
      it("lets those who may write the record archive it and restore it, at the request time only", async () => {
        expect(await outcomeOf(update({ ...updatedBy(uid), archivedAt: serverTimestamp() }))).toBe("allowed");
        expect(await outcomeOf(update({ ...updatedBy(uid), archivedAt: null }))).toBe("allowed");
      });
    } else {
      it("refuses a change to any field outside the ones the registry names for the writer", async () => {
        const outside = [...fields.own, "archivedAt"].filter((field) => !onlyFields.includes(field));
        expect(outside.length).toBeGreaterThan(0);
        const attacks = Object.fromEntries(
          outside.map((field) => [
            field,
            update({
              ...wellFormed(),
              [field]: field === "archivedAt" ? serverTimestamp() : forged(fixture.seed[field] ?? IMPORTED[field]),
            }),
          ]),
        );
        expect(await wronglyAllowed(attacks)).toEqual([]);
      });
    }
  }
});

describe("the entries that a client may write", () => {
  it("are all attacked here", () => {
    expect(writable.length).toBeGreaterThan(30);
    for (const entry of writable) expect(fixtureOf(entry.key), entry.key).toBeDefined();
  });
});
