// Red-team attacks on the restricted records of the programme: the raw rows and change logs of
// imports, the source registry, the audit trail, the outbound mail, the integrity reports, the
// documents that say who holds which role, and every place where a storage path could be read.
// Each test states the secure behaviour, so a test that fails has found a hole.
// Fixtures are synthetic: fictitious accounts, people and studies on the example.org domain.
import { COLLECTIONS, type CollectionEntry, type CollectionKey } from "@eegml/shared";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, getCountFromServer, limit, query, where } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { deleteObject, getBytes, getDownloadURL, getMetadata, listAll, ref, uploadString } from "firebase/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectOutcomes, requestsOf } from "../requests";
import { pathOf, placeholderIds, seedWorld } from "../seed";
import { createRulesEnvironment } from "../support";
import { CALLERS, type CallerKind, firestoreOf, OWN_REPLICATION, storageOf, uidOfCaller } from "../world";
import {
  EVERYONE,
  EVERYONE_BELOW_ADMIN,
  forEach,
  INSIDERS_WITHOUT_MANAGEMENT,
  OUTSIDERS,
  storedPath,
} from "./exfiltration-and-escalation-support";

let environment: RulesTestEnvironment;
const { get, list, listAcrossParents } = requestsOf(() => environment);
const dbOf = (caller: CallerKind) => firestoreOf(environment, CALLERS[caller]);

/** Everyone who holds no capability of the programme: every caller except the core team and the administrator. */
const WITHOUT_PROGRAMME_POWERS = [
  ...OUTSIDERS,
  ...INSIDERS_WITHOUT_MANAGEMENT,
  "owner",
  "ownCoordinator",
  "ownLead",
] as const satisfies readonly CallerKind[];

/** A file that trusted code stored, so that a refusal is a refusal and not a file that is missing. */
const STORED_FILE = `attachments/replication/${OWN_REPLICATION}/synthetic-ethics-letter.txt`;

/** The stored document of an entry whose rules are not written yet. */
const unbuiltPath = (key: CollectionKey): string => {
  const entry: CollectionEntry = COLLECTIONS[key];
  return pathOf(entry, placeholderIds(entry));
};

beforeAll(async () => {
  environment = await createRulesEnvironment("demo-eegml-redteam-restricted");
  await seedWorld(environment);
  await environment.withSecurityRulesDisabled(async (context) => {
    await uploadString(ref(context.storage() as unknown as FirebaseStorage, STORED_FILE), "A synthetic letter.");
  });
});

afterAll(async () => {
  await environment.clearStorage();
  await environment.cleanup();
});

describe("the records of imports", () => {
  const RECORDS = [
    ["sourceRecords", "a raw row"],
    ["sourceRecordRawChunks", "the continuation of a raw row"],
    ["importBatches", "a batch"],
    ["importBatchChanges", "a change of a batch"],
    ["importBatchSeenRecords", "the records a batch saw"],
    ["importBatchLog", "a log entry of a batch"],
    ["sources", "an entry of the source registry"],
    ["sourceTabs", "a tab of a source"],
    ["reconciliationItems", "an item of the review queue"],
    ["integrationMappings", "an identifier in an external system"],
  ] as const satisfies readonly (readonly [CollectionKey, string])[];

  it("are refused by path to every caller without a capability of the programme", async () => {
    for (const [key, what] of RECORDS) {
      await expectOutcomes({
        ...forEach(WITHOUT_PROGRAMME_POWERS, "denied", `reads ${what}`, (caller) => get(caller, storedPath(key))),
        [`coreTeam: reads ${what}`]: ["allowed", get("coreTeam", storedPath(key))],
      });
    }
  });

  it("are refused as lists, across parents and as counts", async () => {
    await expectOutcomes({
      ...forEach(WITHOUT_PROGRAMME_POWERS, "denied", "lists the raw rows", (caller) =>
        list(caller, "sourceRecords", limit(5)),
      ),
      ...forEach(WITHOUT_PROGRAMME_POWERS, "denied", "lists the raw rows of one source", (caller) =>
        list(caller, "sourceRecords", where("sourceKey", "==", "F"), limit(5)),
      ),
      ...forEach(WITHOUT_PROGRAMME_POWERS, "denied", "lists the batches", (caller) =>
        list(caller, "importBatches", limit(5)),
      ),
      ...forEach(WITHOUT_PROGRAMME_POWERS, "denied", "lists the source registry", (caller) =>
        list(caller, "sources", limit(5)),
      ),
      ...forEach(WITHOUT_PROGRAMME_POWERS, "denied", "lists the review queue", (caller) =>
        list(caller, "reconciliationItems", where("status", "==", "open"), limit(5)),
      ),
      ...Object.fromEntries(
        ["changes", "log", "seenRecords", "rawChunks", "tabs"].flatMap((group) =>
          Object.entries(
            forEach(WITHOUT_PROGRAMME_POWERS, "denied", `lists every document named ${group}`, (caller) =>
              listAcrossParents(caller, group, limit(5)),
            ),
          ),
        ),
      ),
      ...forEach(
        WITHOUT_PROGRAMME_POWERS,
        "denied",
        "counts the raw rows",
        (caller) => () => getCountFromServer(query(collection(dbOf(caller), "sourceRecords"), limit(5))),
      ),
      ...forEach(
        WITHOUT_PROGRAMME_POWERS,
        "denied",
        "counts the changes of every batch",
        (caller) => () => getCountFromServer(query(collectionGroup(dbOf(caller), "changes"), limit(5))),
      ),
    });
  });

  it("never give any client the address of a source document", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "reads the location of a source", (caller) =>
        get(caller, storedPath("sourceLocation")),
      ),
      ...forEach(EVERYONE, "denied", "lists the private documents of a source", (caller) =>
        list(caller, "sources/F/private", limit(5)),
      ),
    });
  });
});

describe("the audit trail, the outbound mail and the integrity reports", () => {
  it("refuse every client the audit trail and the outbound mail, a programme administrator included", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "reads an audit entry", (caller) => get(caller, storedPath("auditEvents"))),
      ...forEach(EVERYONE, "denied", "lists the audit trail", (caller) => list(caller, "auditEvents", limit(5))),
      ...forEach(EVERYONE, "denied", "lists the audit entries about itself", (caller) =>
        list(caller, "auditEvents", where("actorUid", "==", uidOfCaller(caller)), limit(5)),
      ),
      ...forEach(
        EVERYONE,
        "denied",
        "counts the audit trail",
        (caller) => () => getCountFromServer(query(collection(dbOf(caller), "auditEvents"), limit(5))),
      ),
      ...forEach(EVERYONE, "denied", "reads an outbound message", (caller) => get(caller, storedPath("mail"))),
      ...forEach(EVERYONE, "denied", "lists the messages to one address", (caller) =>
        list(caller, "mail", where("toAddress", "==", "owner.account@example.org"), limit(5)),
      ),
    });
  });

  it("refuse the integrity reports to every caller without a capability of the programme", async () => {
    await expectOutcomes({
      ...forEach(WITHOUT_PROGRAMME_POWERS, "denied", "reads a report", (caller) =>
        get(caller, storedPath("integrityReports")),
      ),
      ...forEach(WITHOUT_PROGRAMME_POWERS, "denied", "reads a finding", (caller) =>
        get(caller, storedPath("integrityReportFindings")),
      ),
      ...forEach(WITHOUT_PROGRAMME_POWERS, "denied", "lists the findings of every report", (caller) =>
        listAcrossParents(caller, "findings", limit(5)),
      ),
      "admin: reads a report": ["allowed", get("admin", storedPath("integrityReports"))],
    });
  });
});

describe("the documents that say who holds which role", () => {
  const GRANTS = ["roleAssignments", "roleCapabilities", "capabilityGrants", "recordGrants"] as const;

  it("are refused to everyone who does not manage roles, the core team included", async () => {
    for (const key of GRANTS) {
      await expectOutcomes({
        ...forEach(EVERYONE_BELOW_ADMIN, "denied", `reads a document of ${key}`, (caller) =>
          get(caller, storedPath(key)),
        ),
        ...forEach(EVERYONE_BELOW_ADMIN, "denied", `lists ${key}`, (caller) => list(caller, key, limit(5))),
        [`admin: reads a document of ${key}`]: ["allowed", get("admin", storedPath(key))],
      });
    }
  });

  it("are refused to the account they are about, which reads its roles in its access document", async () => {
    await expectOutcomes({
      "ownLead: reads its own role assignment": ["denied", get("ownLead", storedPath("roleAssignments"))],
      "ownLead: lists its own role assignments": [
        "denied",
        list("ownLead", "roleAssignments", where("uid", "==", uidOfCaller("ownLead")), limit(5)),
      ],
      "owner: reads the grant that names it": ["denied", get("owner", storedPath("capabilityGrants"))],
      "owner: lists the record grants that name it": [
        "denied",
        list("owner", "recordGrants", where("uid", "==", uidOfCaller("owner")), limit(5)),
      ],
      "ownLead: reads its own access document": ["allowed", get("ownLead", `access/${uidOfCaller("ownLead")}`)],
    });
  });

  it("keep the history of an assignment and every other document of the system closed", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "reads the history beneath a role assignment", (caller) =>
        get(caller, `${storedPath("roleAssignments")}/history/entry-1`),
      ),
      ...forEach(EVERYONE, "denied", "reads a second document of the system", (caller) =>
        get(caller, "system/secrets"),
      ),
      ...forEach(EVERYONE, "denied", "lists the documents of the system", (caller) => list(caller, "system", limit(5))),
      "member: reads the settings of the system": ["allowed", get("member", "system/settings")],
    });
  });
});

describe("a storage path", () => {
  it("is refused in every document that holds one, whose rules are not written yet", async () => {
    await expectOutcomes({
      ...forEach(EVERYONE, "denied", "reads a document of attachments", (caller) =>
        get(caller, unbuiltPath("attachments")),
      ),
      ...forEach(EVERYONE, "denied", "lists the attachments of its scope", (caller) =>
        list(caller, "attachments", where("scopeKeys", "array-contains", "members"), limit(5)),
      ),
    });
  });

  it("is never read by a client from the dataset registry, which serves a location only through a function that records it", async () => {
    // The location of a copy, the connection of a server and a viewer link have no rule at all.
    for (const key of ["storageEndpointConnection", "datasetStorageRefLocation", "datasetViewerLinks"] as const) {
      await expectOutcomes(
        forEach(EVERYONE, "denied", `reads a document of ${key}`, (caller) => get(caller, storedPath(key))),
      );
    }
    // The listings of files name paths: only holders of datasets.paths.read for the unit read them,
    // which a lab member, the replication's team and every outsider are not.
    await expectOutcomes({
      ...forEach([...OUTSIDERS, ...INSIDERS_WITHOUT_MANAGEMENT], "denied", "reads a listing", (caller) =>
        get(caller, storedPath("datasetManifests")),
      ),
      ...forEach(
        [...OUTSIDERS, ...INSIDERS_WITHOUT_MANAGEMENT],
        "denied",
        "lists the listings of the replication",
        (caller) => listAcrossParents(caller, "manifests", where("replicationId", "==", OWN_REPLICATION), limit(5)),
      ),
      ...forEach([...OUTSIDERS, ...INSIDERS_WITHOUT_MANAGEMENT], "denied", "reads the chunks of a listing", (caller) =>
        get(caller, storedPath("datasetManifestFileChunks")),
      ),
      ...forEach(
        EVERYONE_BELOW_ADMIN.filter((caller) => caller !== "coreTeam"),
        "denied",
        "lists every listing",
        (caller) => listAcrossParents(caller, "manifests", limit(5)),
      ),
      "the lead reads a listing": ["allowed", get("ownLead", storedPath("datasetManifests"))],
      "the coordinator lists the listings of the laboratory": [
        "allowed",
        listAcrossParents("ownCoordinator", "manifests", where("laboratoryId", "==", "lab-synthetic-own"), limit(5)),
      ],
    });
  });

  it.each(EVERYONE)("is refused in Cloud Storage to: %s", async (kind) => {
    const storage = storageOf(environment, CALLERS[kind]);
    const own = `attachments/user/${uidOfCaller(kind)}/synthetic-note.txt`;
    const refused = async (run: () => Promise<unknown>): Promise<string> => {
      try {
        await run();
        return "(allowed)";
      } catch (error) {
        return (error as { code?: string }).code ?? String(error);
      }
    };
    expect({
      download: await refused(() => getBytes(ref(storage, STORED_FILE))),
      address: await refused(() => getDownloadURL(ref(storage, STORED_FILE))),
      metadata: await refused(() => getMetadata(ref(storage, STORED_FILE))),
      listOfFolder: await refused(() => listAll(ref(storage, `attachments/replication/${OWN_REPLICATION}`))),
      listOfBucket: await refused(() => listAll(ref(storage))),
      uploadToOwnFolder: await refused(() => uploadString(ref(storage, own), "A synthetic note.")),
      overwrite: await refused(() => uploadString(ref(storage, STORED_FILE), "Overwritten.")),
      removal: await refused(() => deleteObject(ref(storage, STORED_FILE))),
    }).toEqual({
      download: "storage/unauthorized",
      address: "storage/unauthorized",
      metadata: "storage/unauthorized",
      listOfFolder: "storage/unauthorized",
      listOfBucket: "storage/unauthorized",
      uploadToOwnFolder: "storage/unauthorized",
      overwrite: "storage/unauthorized",
      removal: "storage/unauthorized",
    });
  });

  it("is still held by the file that the refusals above are about", async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const bytes = await getBytes(ref(context.storage() as unknown as FirebaseStorage, STORED_FILE));
      expect(new TextDecoder().decode(bytes)).toBe("A synthetic letter.");
    });
  });
});
