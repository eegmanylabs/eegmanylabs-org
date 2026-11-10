// The collection registry checked against itself: every entry is complete and consistent, every
// schema is strict and capped, and the path builders give the paths of the data model.
// tests/architecture/data-model.test.ts compares the registry with docs/DATA_MODEL.md.
import { describe, expect, it } from "vitest";
import {
  CAPABILITY_DEFINITIONS,
  DEFAULT_ROLE_CAPABILITIES,
  GRANTABLE_CAPABILITIES,
  ROLES,
  type Role,
} from "./capabilities";
import {
  ACCESS_TIERS,
  COLLECTION_ENTRIES,
  COLLECTION_KEYS,
  COLLECTIONS,
  type CollectionEntry,
  clientImmutableFields,
  DATA_CLASSES,
  ENFORCEMENTS,
  ENTITY_COLLECTIONS,
} from "./collections";
import { ID_BUILDERS } from "./ids";
import { APPEND_ONLY_BASE_FIELDS, DOCUMENT_BASE_FIELDS, PROVENANCE_FIELDS } from "./schemas/base";
import type { z } from "./zod";

type Node = z.ZodType & {
  readonly def: {
    readonly type: string;
    readonly shape?: Record<string, Node>;
    readonly catchall?: Node;
    readonly element?: Node;
    readonly innerType?: Node;
    readonly keyType?: Node;
    readonly valueType?: Node;
    readonly options?: readonly Node[];
    readonly checks?: readonly { readonly _zod: { readonly def: { readonly check: string } } }[];
  };
  readonly maxLength?: number | null;
};

interface Visit {
  readonly path: string;
  readonly node: Node;
}

/** Every schema node of a document schema, with the path of field names that leads to it. */
function nodesOf(schema: z.ZodType, path = ""): Visit[] {
  const node = schema as Node;
  const { def } = node;
  const below = (child: Node | undefined, step: string) => (child ? nodesOf(child, `${path}${step}`) : []);
  return [
    { path, node },
    ...Object.entries(def.shape ?? {}).flatMap(([field, child]) => below(child, path === "" ? field : `.${field}`)),
    ...below(def.element, "[]"),
    ...below(def.innerType, ""),
    ...below(def.keyType, "{key}"),
    ...below(def.valueType, "{}"),
    ...(def.options ?? []).flatMap((option) => below(option, "")),
  ];
}

const checksOf = (node: Node) => (node.def.checks ?? []).map((check) => check._zod.def.check);
const fieldsOf = (entry: CollectionEntry) => Object.keys(entry.schema.shape);
const parameterNames = (path: string) => [...path.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]);

describe("the registry", () => {
  it("has one entry for every collection, subcollection and fixed-name document of the data model", () => {
    expect(COLLECTION_KEYS).toHaveLength(143);
    expect(COLLECTION_ENTRIES.map((entry) => entry.key)).toEqual(COLLECTION_KEYS);
  });

  it("gives every entry a key of its own and a path of its own", () => {
    const shapes = COLLECTION_ENTRIES.map((entry) => entry.path.replace(/\{[^{}]+\}/g, "{}"));
    expect(new Set(shapes).size).toBe(COLLECTION_ENTRIES.length);
    for (const entry of COLLECTION_ENTRIES) {
      expect(entry.key).toMatch(/^[a-z][A-Za-z]*$/);
      expect(COLLECTIONS[entry.key as keyof typeof COLLECTIONS]).toBe(entry);
    }
  });

  it("uses only the tiers, classes and enforcement values it defines", () => {
    for (const entry of COLLECTION_ENTRIES) {
      expect(entry.read.tiers.length, entry.key).toBeGreaterThan(0);
      for (const tier of entry.read.tiers) expect(ACCESS_TIERS, entry.key).toContain(tier);
      expect(DATA_CLASSES, entry.key).toContain(entry.dataClass);
      expect(ENFORCEMENTS, entry.key).toContain(entry.enforcement);
      // FUNCTION means no client at all, so it never stands beside another tier.
      if (entry.read.tiers.includes("FUNCTION")) expect(entry.read.tiers, entry.key).toEqual(["FUNCTION"]);
    }
  });

  it("derives the parent and the collection name of every entry from its path", () => {
    expect(COLLECTIONS.users.parent).toBeNull();
    expect(COLLECTIONS.userFavourites.parent).toBe("users");
    expect(COLLECTIONS.userFavourites.collectionId).toBe("favourites");
    expect(COLLECTIONS.userPreferences.parent).toBe("users");
    expect(COLLECTIONS.userPreferences.collectionId).toBe("settings");
    expect(COLLECTIONS.labClaimReview.parent).toBe("labClaims");
    expect(COLLECTIONS.participationDetail.parent).toBe("participations");
    expect(COLLECTIONS.pageVersionChunks.parent).toBe("pageVersions");
    expect(COLLECTIONS.datasetStorageRefLocation.parent).toBe("datasetStorageRefs");
    expect(COLLECTIONS.importBatchChangeState.parent).toBe("importBatchChanges");
    expect(COLLECTIONS.systemSettings.parent).toBeNull();
    expect(COLLECTIONS.systemSettings.collectionId).toBe("system");
    for (const entry of COLLECTION_ENTRIES) {
      const depth = entry.path.split("/").length;
      expect(depth % 2, entry.key).toBe(0);
      expect(entry.parent === null, entry.key).toBe(depth === 2);
      if (entry.parent !== null) expect(COLLECTION_KEYS, entry.key).toContain(entry.parent);
    }
  });

  it("uses a collection name beneath one kind of parent only, except for private and special", () => {
    const parentsOf = new Map<string, Set<string | null>>();
    for (const entry of COLLECTION_ENTRIES) {
      const parents = parentsOf.get(entry.collectionId) ?? new Set();
      parents.add(entry.parent);
      parentsOf.set(entry.collectionId, parents);
    }
    const shared = [...parentsOf].filter(([, parents]) => parents.size > 1).map(([name]) => name);
    expect(shared.sort()).toEqual(["private", "special"]);
  });

  it("classes every document under special/ as special-category data, and nothing else", () => {
    for (const entry of COLLECTION_ENTRIES) {
      expect(entry.dataClass === "special", entry.key).toBe(entry.collectionId === "special");
      if (entry.collectionId === "special") expect(entry.read.tiers, entry.key).toEqual(["FUNCTION"]);
      if (entry.collectionId === "private") expect(entry.dataClass, entry.key).toBe("restricted");
    }
  });

  it("lets no client write what no client reads, with the one exception of viewer links", () => {
    const writeOnly = COLLECTION_ENTRIES.filter(
      (entry) => entry.read.tiers.includes("FUNCTION") && entry.write.mode === "client",
    ).map((entry) => entry.key);
    expect(writeOnly).toEqual(["datasetViewerLinks"]);
  });
});

describe("the enforcement of an entry", () => {
  it("leaves closed to every client exactly the collections whose features are not built yet", () => {
    const denied = COLLECTION_ENTRIES.filter((entry) => entry.enforcement === "deniedUntilBuilt").map(
      (entry) => entry.key,
    );
    expect(denied.sort()).toEqual(
      [
        // The review queue for affiliation strings, which waits for the reconciliation pages.
        "institutionCandidates",
        // Restricted custom values, which wait for custom properties.
        "personCustom",
        "laboratoryCustom",
        "replicationCustom",
        "participationCustom",
        "taskCustom",
        "datasetCustom",
        "manuscriptCustom",
        // Recruitment reports, planned pauses and forecasts.
        "recruitmentReports",
        "plannedPauses",
        "forecastRuns",
        // Tasks.
        "taskLists",
        "tasks",
        "tags",
        "reminders",
        // Pages, threads, attachments, databases, views and dashboards.
        "pages",
        "pageContent",
        "pageUpdates",
        "pageVersions",
        "pageVersionChunks",
        "pagePermissions",
        "threads",
        "threadComments",
        "attachments",
        "databases",
        "databaseRows",
        "collectionSchemas",
        "views",
        "dashboards",
        // Storage endpoints, datasets and processing runs.
        "storageEndpoints",
        "storageEndpointConnection",
        "datasets",
        "datasetDetail",
        "datasetStorageRefs",
        "datasetStorageRefLocation",
        "datasetManifests",
        "datasetManifestFileChunks",
        "datasetTransfers",
        "datasetQcAssessments",
        "datasetAccessEvents",
        "datasetViewerLinks",
        "processingRuns",
        // Governance records.
        "decisions",
        "risks",
        "incidents",
        "meetings",
        "progressReports",
        // Synchronisation, generated documents, publishing and automation.
        "integrationConnections",
        "syncMappings",
        "syncMappingCellState",
        "syncRuns",
        "syncConflicts",
        "documentTemplates",
        "generatedDocuments",
        "publicationBatches",
        "automationRules",
        "automationRuns",
        "scheduledReports",
        "searchIndex",
        // Written by triggers of the first slice, and read by features that come later.
        "activity",
        "eventFailures",
      ].sort(),
    );
    expect(COLLECTION_ENTRIES.filter((entry) => entry.enforcement === "enforced")).toHaveLength(82);
  });

  it("never opens a document beneath a parent that is still closed", () => {
    for (const entry of COLLECTION_ENTRIES) {
      const parent = COLLECTION_ENTRIES.find((candidate) => candidate.key === entry.parent);
      if (parent?.enforcement === "deniedUntilBuilt") expect(entry.enforcement, entry.key).toBe("deniedUntilBuilt");
    }
  });
});

describe("the identifier rule of an entry", () => {
  it("names a builder that exists and fields that the schema has", () => {
    for (const entry of COLLECTION_ENTRIES) {
      const rule = entry.identifier;
      if (rule.kind === "builder") {
        expect(Object.keys(ID_BUILDERS), entry.key).toContain(rule.builder);
        for (const field of rule.fields) expect(fieldsOf(entry), `${entry.key}.${field}`).toContain(field);
      }
      if (rule.kind === "key" && rule.field !== null) expect(fieldsOf(entry), entry.key).toContain(rule.field);
    }
  });

  it("is a fixed name exactly when the path ends in one", () => {
    for (const entry of COLLECTION_ENTRIES) {
      const last = entry.path.split("/").at(-1) ?? "";
      const endsInName = !last.startsWith("{");
      expect(entry.identifier.kind === "fixed", entry.key).toBe(endsInName);
      if (entry.identifier.kind === "fixed") expect(entry.identifier.name, entry.key).toBe(last);
    }
  });

  it("uses every builder of a document identifier somewhere", () => {
    const used = new Set(
      COLLECTION_ENTRIES.flatMap((entry) => (entry.identifier.kind === "builder" ? [entry.identifier.builder] : [])),
    );
    // nestedEntityId builds the entityId of a reference, which is no document identifier. The other
    // three derive the identifier that an importer gives a record of a collection whose identifiers
    // the data model calls opaque: a person, an affiliation and a document link.
    expect(Object.keys(ID_BUILDERS).filter((name) => !used.has(name as keyof typeof ID_BUILDERS))).toEqual([
      "nestedEntityId",
      "importedPersonId",
      "importedAffiliationId",
      "documentLinkSlotId",
    ]);
  });
});

describe("the access rules of an entry", () => {
  const referenceProblems = (entry: CollectionEntry, references: readonly string[]) =>
    references.filter((reference) => {
      if (reference.startsWith("{")) return !parameterNames(entry.path).includes(reference.slice(1, -1));
      if (reference.startsWith("parent.")) {
        const parent = COLLECTION_ENTRIES.find((candidate) => candidate.key === entry.parent);
        return parent === undefined || !fieldsOf(parent).includes(reference.slice("parent.".length));
      }
      return !fieldsOf(entry).includes(reference);
    });

  it("name scope fields that exist: a field, a field of the parent or a parameter of the path", () => {
    for (const entry of COLLECTION_ENTRIES) {
      expect(referenceProblems(entry, entry.read.scopeFields), `${entry.key} read`).toEqual([]);
      if (entry.write.mode === "client") {
        expect(referenceProblems(entry, entry.write.scopeFields), `${entry.key} write`).toEqual([]);
      }
    }
  });

  it("give every scoped or owned read something to compare the caller with", () => {
    for (const entry of COLLECTION_ENTRIES) {
      const scoped = entry.read.tiers.some((tier) => tier === "SCOPED" || tier === "SELF");
      if (scoped) expect(entry.read.scopeFields.length, entry.key).toBeGreaterThan(0);
    }
  });

  it("name, for every read of the tier ADMIN whose rules are written, the capability that decides it", () => {
    for (const entry of COLLECTION_ENTRIES) {
      const { tiers, capability } = entry.read;
      if (capability !== null) {
        expect(GRANTABLE_CAPABILITIES, entry.key).toContain(capability);
        // A capability decides the tiers ADMIN and SCOPED, and no other.
        expect(
          tiers.some((tier) => tier === "ADMIN" || tier === "SCOPED"),
          entry.key,
        ).toBe(true);
      }
      if (entry.enforcement === "enforced" && tiers.includes("ADMIN")) {
        expect(capability, entry.key).not.toBeNull();
      }
    }
  });

  it("give a scoped role the right to read through a capability only where it can hold that capability", () => {
    for (const entry of COLLECTION_ENTRIES) {
      const { tiers, capability } = entry.read;
      if (capability === null || !tiers.includes("SCOPED")) continue;
      // A capability of the level `programme` is never held for one replication or laboratory.
      expect(CAPABILITY_DEFINITIONS[capability].level, entry.key).toBe("unit");
    }
  });

  it("decide who reads the records of roles and grants by the sensitive capability that manages them", () => {
    for (const key of ["roleAssignments", "roleCapabilities", "capabilityGrants", "recordGrants"] as const) {
      expect(COLLECTIONS[key].read).toMatchObject({ tiers: ["ADMIN"], capability: "roles.manage" });
    }
    expect(DEFAULT_ROLE_CAPABILITIES.core_team).not.toContain("roles.manage");
  });

  it("name fields that exist wherever a client write is limited to some fields or kept from others", () => {
    for (const entry of COLLECTION_ENTRIES) {
      if (entry.write.mode !== "client") continue;
      expect(entry.write.grants.length, entry.key).toBeGreaterThan(0);
      for (const field of entry.write.functionOnlyFields)
        expect(fieldsOf(entry), `${entry.key}.${field}`).toContain(field);
      for (const grant of entry.write.grants) {
        expect(grant.writers.length, entry.key).toBeGreaterThan(0);
        expect(grant.operations.length, entry.key).toBeGreaterThan(0);
        for (const field of grant.onlyFields ?? []) {
          expect(fieldsOf(entry), `${entry.key}.${field}`).toContain(field);
          expect(entry.write.functionOnlyFields, `${entry.key}.${field}`).not.toContain(field);
        }
      }
    }
  });

  it("never let a client update or delete an append-only document", () => {
    for (const entry of COLLECTION_ENTRIES) {
      if (!entry.flags.appendOnly || entry.write.mode !== "client") continue;
      for (const grant of entry.write.grants) expect(grant.operations, entry.key).toEqual(["create"]);
    }
  });

  it("let a client delete only what is a convenience of one user, or a permission on a page", () => {
    const deletable = COLLECTION_ENTRIES.filter(
      (entry) =>
        entry.write.mode === "client" && entry.write.grants.some((grant) => grant.operations.includes("delete")),
    ).map((entry) => entry.key);
    expect(deletable.sort()).toEqual(
      ["pagePermissions", "reminders", "userFavourites", "userRecents", "userSubscriptions", "views"].sort(),
    );
  });

  it("name, for each right that the capability matrix decides, a capability that every listed role holds by default", () => {
    for (const entry of COLLECTION_ENTRIES) {
      if (entry.write.mode !== "client") continue;
      for (const grant of entry.write.grants) {
        if (grant.capability === null) continue;
        expect(GRANTABLE_CAPABILITIES, entry.key).toContain(grant.capability);
        for (const writer of grant.writers) {
          if (!(ROLES as readonly string[]).includes(writer)) continue;
          expect(DEFAULT_ROLE_CAPABILITIES[writer as Role], `${entry.key}: ${writer}`).toContain(grant.capability);
        }
      }
    }
  });

  it("keep from every client the collections that the data model reserves for trusted code", () => {
    const functionOnly = [
      "users",
      "access",
      "roleAssignments",
      "roleCapabilities",
      "capabilityGrants",
      "recordGrants",
      "groups",
      "invitations",
      "accountClaims",
      "accountClaimReview",
      "labClaims",
      "labClaimReview",
      "personContact",
      "personDemographics",
      "personEmailIndex",
      "identityKeys",
      "institutionCandidates",
      "laboratoryEquipment",
      "replicationAliases",
      "replicationSummaries",
      "statusHistory",
      "historicalAggregates",
      "studyAliasIndex",
      "outreachContacts",
      "recruitmentReports",
      "forecastRuns",
      "pageContent",
      "pageVersions",
      "pageVersionChunks",
      "storageEndpointConnection",
      "datasetStorageRefLocation",
      "datasetAccessEvents",
      "sources",
      "sourceLocation",
      "sourceTabs",
      "importBatches",
      "importBatchChanges",
      "importBatchChangeState",
      "importBatchSeenRecords",
      "importBatchLog",
      "sourceRecords",
      "sourceRecordSpecial",
      "sourceRecordRawChunks",
      "reconciliationItems",
      "integrationMappings",
      "integrationConnections",
      "syncMappings",
      "syncMappingCellState",
      "syncRuns",
      "syncConflicts",
      "generatedDocuments",
      "publicationBatches",
      "auditEvents",
      "activity",
      "automationRuns",
      "mail",
      "eventFailures",
      "searchIndex",
      "integrityReports",
      "integrityReportFindings",
      "systemSettings",
    ];
    const actual = COLLECTION_ENTRIES.filter((entry) => entry.write.mode === "function").map((entry) => entry.key);
    expect(actual.sort()).toEqual([...functionOnly, "personCustom"].sort());
  });

  it("let the owner of a notification set readAt and nothing else", () => {
    const { write } = COLLECTIONS.userNotifications;
    expect(write).toMatchObject({
      mode: "client",
      grants: [{ writers: ["self"], operations: ["update"], onlyFields: ["readAt"] }],
    });
  });

  it("limit what a person may change of their own directory entry to the four profile fields", () => {
    const { write } = COLLECTIONS.persons;
    expect(write.mode).toBe("client");
    if (write.mode !== "client") return;
    expect(write.grants.find((grant) => grant.writers.includes("self"))?.onlyFields).toEqual([
      "orcid",
      "scholarUrl",
      "universityUrl",
      "labUrl",
    ]);
    expect(write.functionOnlyFields).toEqual(expect.arrayContaining(["userId", "claimedAt", "slug"]));
    expect(write.grants.every((grant) => !grant.operations.includes("create"))).toBe(true);
  });

  it("keep every status that has a history from direct client writes", () => {
    const reserved = (key: keyof typeof COLLECTIONS) => {
      const { write } = COLLECTIONS[key];
      return write.mode === "client" ? write.functionOnlyFields : [];
    };
    expect(reserved("replications")).toEqual(expect.arrayContaining(["statusKey", "statusHistoryId"]));
    expect(reserved("participations")).toEqual(expect.arrayContaining(["status", "statusHistoryId"]));
    expect(reserved("manuscripts")).toEqual(expect.arrayContaining(["status", "statusHistoryId"]));
    expect(reserved("datasets")).toEqual(expect.arrayContaining(["workflowStatusKey", "statusHistoryId"]));
    expect(reserved("tasks")).toEqual(expect.arrayContaining(["statusKey", "statusHistoryId"]));
  });
});

describe("clientImmutableFields", () => {
  it("lists the record of creation, the identifier, the scope, the origin, the provenance and what is reserved", () => {
    expect(clientImmutableFields(COLLECTIONS.participations)).toEqual([
      "schemaVersion",
      "createdAt",
      "createdBy",
      "replicationId",
      "laboratoryId",
      "scopeKeys",
      "dataOrigin",
      "sourceRecordIds",
      "fieldSources",
      "importedValues",
      "sourceCreatedAt",
      "sourceUpdatedAt",
      "sourceAuthor",
      "status",
      "statusHistoryId",
    ]);
    expect(clientImmutableFields(COLLECTIONS.replications)).toEqual([
      "schemaVersion",
      "createdAt",
      "createdBy",
      "studyKey",
      "dataOrigin",
      "sourceRecordIds",
      "fieldSources",
      "importedValues",
      "sourceCreatedAt",
      "sourceUpdatedAt",
      "sourceAuthor",
      "statusKey",
      "statusHistoryId",
      "leadPersonIds",
    ]);
    expect(clientImmutableFields(COLLECTIONS.userFavourites)).toEqual([
      "schemaVersion",
      "createdAt",
      "createdBy",
      "entityType",
      "entityId",
    ]);
  });

  it("names only fields that the schema of the entry has", () => {
    for (const entry of COLLECTION_ENTRIES) {
      for (const field of clientImmutableFields(entry))
        expect(fieldsOf(entry), `${entry.key}.${field}`).toContain(field);
    }
  });

  it("keeps every provenance field of an imported record from a client", () => {
    for (const entry of COLLECTION_ENTRIES) {
      const provenance = fieldsOf(entry).filter(
        (field) => PROVENANCE_FIELDS.includes(field) || field === "sourceRecordId",
      );
      expect(clientImmutableFields(entry), entry.key).toEqual(expect.arrayContaining(provenance));
    }
    expect(clientImmutableFields(COLLECTIONS.contributors)).toContain("sourceRecordId");
    expect(clientImmutableFields(COLLECTIONS.laboratories)).toEqual(
      expect.arrayContaining(["sourceRecordIds", "fieldSources", "importedValues", "sourceAuthor"]),
    );
  });
});

describe("the flags of an entry", () => {
  it("switch the audit trigger off for derived and bulk content, as the data model lists it", () => {
    const unaudited = COLLECTION_ENTRIES.filter((entry) => !entry.flags.audited).map((entry) => entry.key);
    expect(unaudited.sort()).toEqual(
      [
        "auditEvents",
        "activity",
        "eventFailures",
        "searchIndex",
        "access",
        "mail",
        "automationRuns",
        "syncRuns",
        "integrityReports",
        "integrityReportFindings",
        "sourceRecords",
        "sourceRecordSpecial",
        "sourceRecordRawChunks",
        "importBatchChanges",
        "importBatchChangeState",
        "importBatchSeenRecords",
        "importBatchLog",
        "syncMappingCellState",
        "userNotifications",
        "userRecents",
        "pageContent",
        "pageUpdates",
        "pageVersionChunks",
        "datasetManifestFileChunks",
      ].sort(),
    );
  });

  it("mark as importable exactly the entries whose documents carry the provenance fields", () => {
    for (const entry of COLLECTION_ENTRIES) {
      expect(fieldsOf(entry).includes("sourceRecordIds"), entry.key).toBe(
        entry.flags.importable || entry.key === "importBatchChanges" || entry.key === "importBatchSeenRecords",
      );
      if (entry.flags.importable && !entry.flags.appendOnly) {
        for (const field of PROVENANCE_FIELDS) expect(fieldsOf(entry), `${entry.key}.${field}`).toContain(field);
      }
    }
  });

  it("index for search nothing that is restricted or special", () => {
    for (const entry of COLLECTION_ENTRIES) {
      if (!entry.flags.searchable) continue;
      expect(["public", "member"], entry.key).toContain(entry.dataClass);
      expect(entry.read.tiers, entry.key).not.toContain("FUNCTION");
    }
  });
});

describe("the schema of an entry", () => {
  it("states its version, which the entry repeats for writers", () => {
    for (const entry of COLLECTION_ENTRIES) {
      expect(entry.schemaVersion, entry.key).toBe(1);
      expect(entry.schema.shape.schemaVersion.safeParse(entry.schemaVersion).success, entry.key).toBe(true);
      expect(entry.schema.shape.schemaVersion.safeParse(entry.schemaVersion + 1).success, entry.key).toBe(false);
    }
  });

  it("carries the standard fields of its lifecycle, and no field that only an update could set when it is append-only", () => {
    const updateOnly = DOCUMENT_BASE_FIELDS.filter((field) => !APPEND_ONLY_BASE_FIELDS.includes(field));
    for (const entry of COLLECTION_ENTRIES) {
      const standard = entry.flags.appendOnly ? APPEND_ONLY_BASE_FIELDS : DOCUMENT_BASE_FIELDS;
      expect(fieldsOf(entry), entry.key).toEqual(expect.arrayContaining([...standard]));
      if (entry.flags.appendOnly) {
        expect(
          fieldsOf(entry).filter((field) => updateOnly.includes(field)),
          entry.key,
        ).toEqual([]);
      }
    }
  });

  it("is strict at every level: no object accepts a key it does not name", () => {
    for (const entry of COLLECTION_ENTRIES) {
      const loose = nodesOf(entry.schema)
        .filter(({ node }) => node.def.type === "object" && node.def.catchall?.def.type !== "never")
        .map(({ path }) => path || "(document)");
      expect(loose, entry.key).toEqual([]);
      expect(entry.schema.safeParse({ unknownField: true }).error?.issues, entry.key).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: "unrecognized_keys", keys: ["unknownField"] })]),
      );
    }
  });

  it("caps every text, every array and every map that it holds", () => {
    const uncapped = COLLECTION_ENTRIES.flatMap((entry) =>
      nodesOf(entry.schema)
        .filter(({ node }) => {
          if (node.def.type === "string") return node.maxLength === null || node.maxLength === undefined;
          if (node.def.type === "array") return !checksOf(node).includes("max_length");
          // A map keyed by an enumeration is bounded by its keys. Any other map states its bound.
          if (node.def.type === "record")
            return node.def.keyType?.def.type !== "enum" && !checksOf(node).includes("custom");
          return false;
        })
        .map(({ path }) => `${entry.key}: ${path}`),
    );
    expect(uncapped).toEqual([]);
  });

  it("keeps every verbatim source value as it arrives: a field that ends in Source is never trimmed or converted", () => {
    const sourceFields = COLLECTION_ENTRIES.flatMap((entry) =>
      nodesOf(entry.schema)
        .filter(({ path }) => /Source(\[\]|\{\})?$/.test(path))
        .map((visit) => ({ entry: entry.key, ...visit })),
    );
    expect(sourceFields.length).toBeGreaterThan(40);
    const altered = sourceFields
      .filter(({ node }) => node.def.type === "string")
      .filter(({ node }) => checksOf(node).some((check) => check === "overwrite" || check === "min_length"))
      .map(({ entry, path }) => `${entry}: ${path}`);
    expect(altered).toEqual([]);
    for (const { entry, path, node } of sourceFields.filter(({ node: candidate }) => candidate.def.type === "string")) {
      expect(node.safeParse("  Mixed Case  ").data, `${entry}: ${path}`).toBe("  Mixed Case  ");
      expect(node.safeParse("").success, `${entry}: ${path}`).toBe(true);
      expect(node.safeParse(7).success, `${entry}: ${path}`).toBe(false);
    }
  });

  it("is used by one entry only, except the document of restricted custom values", () => {
    const users = new Map<unknown, string[]>();
    for (const entry of COLLECTION_ENTRIES) users.set(entry.schema, [...(users.get(entry.schema) ?? []), entry.key]);
    const shared = [...users.values()].filter((keys) => keys.length > 1);
    expect(shared).toEqual([
      [
        "personCustom",
        "laboratoryCustom",
        "replicationCustom",
        "participationCustom",
        "taskCustom",
        "datasetCustom",
        "manuscriptCustom",
      ],
    ]);
  });
});

describe("the path builders", () => {
  it("fill the parameters of a path in order", () => {
    expect(COLLECTIONS.users.docPath("uid-1")).toBe("users/uid-1");
    expect(COLLECTIONS.userFavourites.docPath("uid-1", "page__p1")).toBe("users/uid-1/favourites/page__p1");
    expect(COLLECTIONS.userPreferences.docPath("uid-1")).toBe("users/uid-1/settings/preferences");
    expect(COLLECTIONS.threadComments.docPath("thread-1", "comment-1")).toBe("threads/thread-1/comments/comment-1");
    expect(COLLECTIONS.pageVersionChunks.docPath("page-1", "version-1", "000000")).toBe(
      "pages/page-1/versions/version-1/chunks/000000",
    );
    expect(COLLECTIONS.datasetStorageRefLocation.docPath("ds-1", "ref-1")).toBe(
      "datasets/ds-1/storageRefs/ref-1/private/location",
    );
    expect(COLLECTIONS.systemSettings.docPath()).toBe("system/settings");
  });

  it("give the collection of an entry from the identifiers of its ancestors", () => {
    expect(COLLECTIONS.users.collectionPath()).toBe("users");
    expect(COLLECTIONS.userFavourites.collectionPath("uid-1")).toBe("users/uid-1/favourites");
    expect(COLLECTIONS.userPreferences.collectionPath("uid-1")).toBe("users/uid-1/settings");
    expect(COLLECTIONS.pageVersionChunks.collectionPath("page-1", "version-1")).toBe(
      "pages/page-1/versions/version-1/chunks",
    );
    expect(COLLECTIONS.personContact.collectionPath("person-1")).toBe("persons/person-1/private");
    expect(COLLECTIONS.systemSettings.collectionPath()).toBe("system");
  });

  it("refuse an identifier that would change the shape of a path, and a wrong number of identifiers", () => {
    for (const identifier of ["", "a/b", ".", ".."]) {
      expect(() => COLLECTIONS.userFavourites.docPath("uid-1", identifier)).toThrow(RangeError);
      expect(() => COLLECTIONS.userFavourites.collectionPath(identifier)).toThrow(RangeError);
    }
    const loose = COLLECTIONS.userFavourites.docPath as (...ids: string[]) => string;
    expect(() => loose("uid-1")).toThrow(RangeError);
    expect(() => loose("uid-1", "a", "b")).toThrow(RangeError);
  });

  it("build a valid path for every entry", () => {
    for (const entry of COLLECTION_ENTRIES) {
      const ids = parameterNames(entry.path).map((_name, index) => `id-${index}`);
      const path = entry.docPath(...ids);
      expect(path.split("/"), entry.key).toHaveLength(entry.path.split("/").length);
      expect(path, entry.key).not.toMatch(/[{}]/);
      expect(
        path.startsWith(
          `${entry.collectionPath(...ids.slice(0, entry.identifier.kind === "fixed" ? ids.length : -1))}/`,
        ),
      ).toBe(true);
    }
  });
});

describe("the entity registry", () => {
  it("maps every entity type to a collection whose documents share it", () => {
    for (const key of Object.values(ENTITY_COLLECTIONS)) {
      const entry = COLLECTIONS[key];
      expect(entry.identifier.kind, key).not.toBe("fixed");
      expect(parameterNames(entry.path).length, key).toBeLessThanOrEqual(2);
    }
    expect(new Set(Object.values(ENTITY_COLLECTIONS)).size).toBe(Object.keys(ENTITY_COLLECTIONS).length);
  });
});
