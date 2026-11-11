// The referential-integrity checker (docs/DATA_MODEL.md, section 14, the fourth mechanism).
// Pure: it reads a snapshot of documents, keyed by their path, and returns its findings. The
// command `integrity:check` of the tools and the scheduled function `integritySweep` load the
// collections it names and write what it finds to `integrityReports`.
//
// | Check                        | Finds                                                                    |
// |------------------------------|--------------------------------------------------------------------------|
// | `danglingReference`          | A reference field, an element of a reference array or a polymorphic reference that names no document |
// | `identifierMismatch`         | A document whose identifier is not the one rebuilt from its fields       |
// | `personLinkedToSeveralUsers` | A person that more than one login names, or a person and a login that disagree about their link |
// | `derivedValueDisagrees`      | A denormalised value that differs from its source: the leads of a replication, the units of a person, a status and its history, the scope of a checklist item |
// | `equipmentChainCurrent`      | A chain of equipment configurations with more than one current member    |
// | `dependencyCycle`            | Tasks whose dependencies close a cycle, which the functions refuse to create and an import may bring |
import {
  COLLECTIONS,
  type CollectionEntry,
  type CollectionKey,
  ENTITY_COLLECTIONS,
  entityPath,
  entryOfDocumentPath,
} from "./collections";
import { type EntityType, entityTypeSchema } from "./entities";
import {
  acknowledgementId,
  historicalAggregateId,
  type IdBuilderName,
  labClaimId,
  lookupFold,
  participationId,
  replicationMembershipId,
  sequenceId,
  statusDefinitionId,
  tagId,
} from "./ids";
import { memberEntryCounts, membershipCounts, sameUnits } from "./person-units";
import { dependencyCycles } from "./task-tree";

export const INTEGRITY_CHECKS = [
  "danglingReference",
  "identifierMismatch",
  "personLinkedToSeveralUsers",
  "derivedValueDisagrees",
  "equipmentChainCurrent",
  "dependencyCycle",
] as const;
export type IntegrityCheck = (typeof INTEGRITY_CHECKS)[number];

/** The collections the checker reads. A reference into a collection outside this list is not followed. */
export const INTEGRITY_COLLECTIONS = [
  "users",
  "persons",
  "personAffiliations",
  "institutions",
  "laboratories",
  "laboratoryMembers",
  "laboratoryEquipment",
  "replications",
  "replicationMemberships",
  "participations",
  "participationChecklist",
  "statusHistory",
  "taskLists",
  "tasks",
  "tags",
] as const satisfies readonly CollectionKey[];
export type IntegrityCollection = (typeof INTEGRITY_COLLECTIONS)[number];

export interface IntegrityFinding {
  readonly check: IntegrityCheck;
  readonly documentPath: string;
  readonly field?: string;
  /** Identifiers and counts only, never a personal value. */
  readonly detail: string;
}

/** A document as the checker sees it: its full path and its stored fields. */
export interface CheckedDocument {
  readonly path: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export type IntegritySnapshot = ReadonlyMap<IntegrityCollection, readonly CheckedDocument[]>;

/**
 * The reference fields the checker follows, by field name: the collection of the document they
 * name, and for a document in a subcollection the field of the referring document that names
 * its parent.
 */
const REFERENCE_FIELDS: Readonly<Record<string, { readonly target: IntegrityCollection; readonly parent?: string }>> = {
  personId: { target: "persons" },
  piPersonId: { target: "persons" },
  localLeadPersonId: { target: "persons" },
  leadPersonIds: { target: "persons" },
  laboratoryId: { target: "laboratories" },
  laboratoryIds: { target: "laboratories" },
  replicationId: { target: "replications" },
  replicationIds: { target: "replications" },
  institutionId: { target: "institutions" },
  userId: { target: "users" },
  statusHistoryId: { target: "statusHistory" },
  participationId: { target: "participations" },
  equipmentConfigurationId: { target: "laboratoryEquipment", parent: "laboratoryId" },
  supersedesId: { target: "laboratoryEquipment", parent: "laboratoryId" },
};

/** The builders whose parts are plain fields of the document, which the checker can rebuild. */
const REBUILDABLE: Partial<Record<IdBuilderName, (...parts: string[]) => string>> = {
  participationId,
  replicationMembershipId,
  acknowledgementId,
  labClaimId,
  historicalAggregateId,
  tagId,
  // A stored document gives its entity type as text, which must be one of the registry.
  statusDefinitionId: (entityType, key) => statusDefinitionId(entityTypeSchema.parse(entityType), key),
};

const lastSegment = (path: string) => path.slice(path.lastIndexOf("/") + 1);
const textOf = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const textsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const archived = (document: CheckedDocument) => document.data.archivedAt != null;

function targetPath(target: IntegrityCollection, id: string, parentId: string | null): string | null {
  const entry = COLLECTIONS[target] as CollectionEntry;
  const parameters = entry.path.split("/").filter((part) => part.startsWith("{")).length;
  try {
    if (parameters === 1) return entry.docPath(id);
    return parentId === null ? null : entry.docPath(parentId, id);
  } catch {
    return null;
  }
}

function danglingReferences(snapshot: IntegritySnapshot, paths: ReadonlySet<string>): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  for (const documents of snapshot.values()) {
    for (const document of documents) {
      for (const [field, value] of Object.entries(document.data)) {
        const reference = REFERENCE_FIELDS[field];
        if (reference === undefined || !snapshot.has(reference.target)) continue;
        const parentId = reference.parent === undefined ? null : textOf(document.data[reference.parent]);
        const ids = Array.isArray(value) ? textsOf(value) : [textOf(value)].filter((id): id is string => id !== null);
        for (const id of ids) {
          const path = targetPath(reference.target, id, parentId);
          if (path === null || !paths.has(path)) {
            findings.push({
              check: "danglingReference",
              documentPath: document.path,
              field,
              detail: `${field} names ${id}, which does not exist in ${COLLECTIONS[reference.target].collectionId}.`,
            });
          }
        }
      }
      const entityType = entityTypeSchema.safeParse(document.data.entityType);
      const entityId = textOf(document.data.entityId);
      if (entityType.success && entityId !== null) {
        const collection: string = ENTITY_COLLECTIONS[entityType.data];
        if (!(INTEGRITY_COLLECTIONS as readonly string[]).includes(collection)) continue;
        if (!snapshot.has(collection as IntegrityCollection)) continue;
        let path: string | null;
        try {
          path = entityPath(entityType.data, entityId);
        } catch {
          path = null;
        }
        if (path === null || !paths.has(path)) {
          findings.push({
            check: "danglingReference",
            documentPath: document.path,
            field: "entityId",
            detail: `The ${entityType.data} ${entityId} that the document refers to does not exist.`,
          });
        }
      }
    }
  }
  return findings;
}

function identifierMismatches(snapshot: IntegritySnapshot): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  for (const documents of snapshot.values()) {
    for (const document of documents) {
      const matched = entryOfDocumentPath(document.path);
      if (matched === null) continue;
      const { identifier } = matched.entry;
      const id = lastSegment(document.path);
      let expected: string | null = null;
      if (identifier.kind === "key" && identifier.field !== null) {
        expected = textOf(document.data[identifier.field]);
      } else if (identifier.kind === "builder" && identifier.fields.length > 0) {
        const rebuild = REBUILDABLE[identifier.builder];
        const parts = identifier.fields.map((field) => textOf(document.data[field]));
        if (rebuild === undefined || parts.some((part) => part === null)) continue;
        try {
          expected = rebuild(...(parts as string[]));
        } catch {
          expected = null;
        }
      } else {
        continue;
      }
      if (expected !== id) {
        findings.push({
          check: "identifierMismatch",
          documentPath: document.path,
          detail:
            expected === null
              ? "The identifier cannot be rebuilt from the fields of the document."
              : `The fields of the document give the identifier ${expected}.`,
        });
      }
    }
  }
  return findings;
}

function personLinks(snapshot: IntegritySnapshot): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const usersByPerson = new Map<string, string[]>();
  for (const user of snapshot.get("users") ?? []) {
    const personId = textOf(user.data.personId);
    if (personId !== null)
      usersByPerson.set(personId, [...(usersByPerson.get(personId) ?? []), lastSegment(user.path)]);
  }
  for (const [personId, uids] of usersByPerson) {
    if (uids.length > 1) {
      findings.push({
        check: "personLinkedToSeveralUsers",
        documentPath: COLLECTIONS.persons.docPath(personId),
        field: "userId",
        detail: `${uids.length} logins name this person: ${[...uids].sort().join(", ")}.`,
      });
    }
  }
  if (snapshot.has("users")) {
    for (const person of snapshot.get("persons") ?? []) {
      const userId = textOf(person.data.userId);
      const personId = lastSegment(person.path);
      if (userId === null) continue;
      const linked = usersByPerson.get(personId) ?? [];
      if (!linked.includes(userId)) {
        findings.push({
          check: "personLinkedToSeveralUsers",
          documentPath: person.path,
          field: "userId",
          detail: `The person names the login ${userId}, which does not name the person.`,
        });
      }
    }
  }
  return findings;
}

const sorted = (ids: Iterable<string>) => [...new Set(ids)].sort();
const listed = (ids: readonly string[]) => (ids.length === 0 ? "none" : ids.join(", "));

function derivedValues(snapshot: IntegritySnapshot): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const disagree = (documentPath: string, field: string, stored: readonly string[], derived: readonly string[]) =>
    findings.push({
      check: "derivedValueDisagrees",
      documentPath,
      field,
      detail: `Stored: ${listed(stored)}. Derived from the source: ${listed(derived)}.`,
    });

  const memberships = snapshot.get("replicationMemberships") ?? [];
  if (snapshot.has("replicationMemberships")) {
    for (const replication of snapshot.get("replications") ?? []) {
      const studyKey = lastSegment(replication.path);
      const leads = sorted(
        memberships
          .filter(
            (membership) =>
              membership.data.replicationId === studyKey &&
              (membership.data.role === "lead" || membership.data.role === "coLead") &&
              membershipCounts(membership.data),
          )
          .map((membership) => textOf(membership.data.personId) ?? ""),
      );
      const stored = sorted(textsOf(replication.data.leadPersonIds));
      if (!sameUnits(stored, leads)) disagree(replication.path, "leadPersonIds", stored, leads);
    }
  }

  const entries = snapshot.get("laboratoryMembers") ?? [];
  for (const person of snapshot.get("persons") ?? []) {
    const personId = lastSegment(person.path);
    if (snapshot.has("laboratoryMembers")) {
      const derived = sorted(
        entries
          .filter((entry) => entry.data.personId === personId && memberEntryCounts(entry.data))
          .map((entry) => textOf(entry.data.laboratoryId) ?? ""),
      );
      const stored = sorted(textsOf(person.data.laboratoryIds));
      if (!sameUnits(stored, derived)) disagree(person.path, "laboratoryIds", stored, derived);
    }
    if (snapshot.has("replicationMemberships")) {
      const derived = sorted(
        memberships
          .filter((membership) => membership.data.personId === personId && membershipCounts(membership.data))
          .map((membership) => textOf(membership.data.replicationId) ?? ""),
      );
      const stored = sorted(textsOf(person.data.replicationIds));
      if (!sameUnits(stored, derived)) disagree(person.path, "replicationIds", stored, derived);
    }
  }

  const history = new Map((snapshot.get("statusHistory") ?? []).map((entry) => [lastSegment(entry.path), entry]));
  if (snapshot.has("statusHistory")) {
    const statusOf: readonly [IntegrityCollection, string, EntityType][] = [
      ["replications", "statusKey", "replication"],
      ["participations", "status", "participation"],
    ];
    for (const [collection, field, entityType] of statusOf) {
      for (const document of snapshot.get(collection) ?? []) {
        const historyId = textOf(document.data.statusHistoryId);
        if (historyId === null) continue;
        const entry = history.get(historyId);
        if (entry === undefined) continue;
        const status = textOf(document.data[field]);
        if (
          entry.data.entityType !== entityType ||
          entry.data.entityId !== lastSegment(document.path) ||
          entry.data.toStatusKey !== status
        ) {
          findings.push({
            check: "derivedValueDisagrees",
            documentPath: document.path,
            field,
            detail: `The status is ${status ?? "none"}, and the history entry ${historyId} it names records ${String(entry.data.toStatusKey)} for ${String(entry.data.entityType)} ${String(entry.data.entityId)}.`,
          });
        }
      }
    }
  }

  const participations = new Map(
    (snapshot.get("participations") ?? []).map((participation) => [lastSegment(participation.path), participation]),
  );
  for (const item of snapshot.get("participationChecklist") ?? []) {
    const participation = participations.get(textOf(item.data.participationId) ?? "");
    if (participation === undefined) continue;
    for (const field of ["replicationId", "laboratoryId"] as const) {
      if (item.data[field] !== participation.data[field]) {
        findings.push({
          check: "derivedValueDisagrees",
          documentPath: item.path,
          field,
          detail: `The item says ${String(item.data[field])}, and its participation says ${String(participation.data[field])}.`,
        });
      }
    }
  }
  return findings;
}

function equipmentChains(snapshot: IntegritySnapshot): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const configurations = (snapshot.get("laboratoryEquipment") ?? []).filter((document) => !archived(document));
  const byPath = new Map(configurations.map((document) => [document.path, document]));
  /** The first configuration of the chain of a configuration, following `supersedesId` back. */
  const rootOf = (document: CheckedDocument): string => {
    const seen = new Set<string>();
    let current = document;
    for (;;) {
      seen.add(current.path);
      const laboratoryId = textOf(current.data.laboratoryId);
      const previousId = textOf(current.data.supersedesId);
      if (laboratoryId === null || previousId === null) return current.path;
      const previous = byPath.get(COLLECTIONS.laboratoryEquipment.docPath(laboratoryId, previousId));
      if (previous === undefined || seen.has(previous.path)) return current.path;
      current = previous;
    }
  };
  const currentByChain = new Map<string, string[]>();
  for (const document of configurations) {
    if (document.data.isCurrent !== true) continue;
    const root = rootOf(document);
    currentByChain.set(root, [...(currentByChain.get(root) ?? []), lastSegment(document.path)]);
  }
  for (const [root, current] of currentByChain) {
    if (current.length > 1) {
      findings.push({
        check: "equipmentChainCurrent",
        documentPath: root,
        field: "isCurrent",
        detail: `${current.length} configurations of this chain are current: ${sorted(current).join(", ")}.`,
      });
    }
  }
  return findings;
}

/**
 * The structure of tasks: the list, the parent, the dependencies and the tags each names exist;
 * the ancestors and the scope of a task agree with its parent and its list; no dependencies
 * close a cycle; and the folded name of a tag is the fold of its name.
 */
function taskStructure(snapshot: IntegritySnapshot, paths: ReadonlySet<string>): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];
  const tasks = snapshot.get("tasks") ?? [];
  const byId = new Map(tasks.map((task) => [lastSegment(task.path), task]));
  const lists = new Map((snapshot.get("taskLists") ?? []).map((list) => [lastSegment(list.path), list]));
  const dangling = (document: CheckedDocument, field: string, id: string, collection: string) =>
    findings.push({
      check: "danglingReference",
      documentPath: document.path,
      field,
      detail: `${field} names ${id}, which does not exist in ${collection}.`,
    });
  for (const task of tasks) {
    const listId = textOf(task.data.listId);
    const list = listId === null ? undefined : lists.get(listId);
    if (snapshot.has("taskLists") && listId !== null && list === undefined)
      dangling(task, "listId", listId, "taskLists");
    if (
      list !== undefined &&
      sorted(textsOf(list.data.scopeKeys)).join() !== sorted(textsOf(task.data.scopeKeys)).join()
    ) {
      findings.push({
        check: "derivedValueDisagrees",
        documentPath: task.path,
        field: "scopeKeys",
        detail: `The scope of the task differs from that of its list ${listId}.`,
      });
    }
    const parentId = textOf(task.data.parentId);
    const parent = parentId === null ? undefined : byId.get(parentId);
    if (parentId !== null && parent === undefined) dangling(task, "parentId", parentId, "tasks");
    const expected =
      parent === undefined ? (parentId === null ? [] : null) : [...textsOf(parent.data.ancestorIds), parentId];
    if (expected !== null && expected.join() !== textsOf(task.data.ancestorIds).join()) {
      findings.push({
        check: "derivedValueDisagrees",
        documentPath: task.path,
        field: "ancestorIds",
        detail: "The ancestors of the task are not those of its parent followed by the parent.",
      });
    }
    const dependsOn = task.data.dependsOn;
    for (const id of typeof dependsOn === "object" && dependsOn !== null ? Object.keys(dependsOn) : []) {
      if (!byId.has(id)) dangling(task, "dependsOn", id, "tasks");
    }
    if (snapshot.has("tags")) {
      for (const id of textsOf(task.data.tagIds)) {
        if (!paths.has(COLLECTIONS.tags.docPath(id))) dangling(task, "tagIds", id, "tags");
      }
    }
  }
  const nodes = tasks.map((task) => ({
    id: lastSegment(task.path),
    dependsOn:
      typeof task.data.dependsOn === "object" && task.data.dependsOn !== null
        ? (task.data.dependsOn as Readonly<Record<string, string>>)
        : {},
  }));
  for (const cycle of dependencyCycles(nodes)) {
    findings.push({
      check: "dependencyCycle",
      documentPath: COLLECTIONS.tasks.docPath(cycle[0] as string),
      field: "dependsOn",
      detail: `These tasks depend on each other in a cycle: ${cycle.join(", ")}.`,
    });
  }
  for (const tag of snapshot.get("tags") ?? []) {
    const name = textOf(tag.data.name);
    if (name !== null && lookupFold(name) !== tag.data.nameFolded) {
      findings.push({
        check: "derivedValueDisagrees",
        documentPath: tag.path,
        field: "nameFolded",
        detail: "The folded name of the tag is not the fold of its name.",
      });
    }
  }
  return findings;
}

/** Runs every check over a snapshot. A check whose collections are not in the snapshot finds nothing. */
export function checkIntegrity(snapshot: IntegritySnapshot): IntegrityFinding[] {
  const paths = new Set([...snapshot.values()].flatMap((documents) => documents.map((document) => document.path)));
  return [
    ...danglingReferences(snapshot, paths),
    ...identifierMismatches(snapshot),
    ...personLinks(snapshot),
    ...derivedValues(snapshot),
    ...equipmentChains(snapshot),
    ...taskStructure(snapshot, paths),
  ];
}

/** The number of findings of each check, every check included, as `integrityReports.counts` stores them. */
export function countFindings(findings: readonly IntegrityFinding[]): Record<IntegrityCheck, number> {
  const counts = Object.fromEntries(INTEGRITY_CHECKS.map((check) => [check, 0])) as Record<IntegrityCheck, number>;
  for (const finding of findings) counts[finding.check] += 1;
  return counts;
}

/** The most findings one report lists. `counts` holds the full number of each check. */
export const MAX_RECORDED_FINDINGS = 2_000;

/** Who ran a check: the scheduled function or the command of the tools. */
export type IntegrityRunOrigin = "scheduled" | "tools";

/** The identifier of a run: its origin and the instant it started, in UTC to the millisecond. */
export function integrityRunId(startedAt: Date, origin: IntegrityRunOrigin): string {
  return `${origin}-${startedAt.toISOString().replace(/[-:.]/g, "")}`;
}

/**
 * The documents that record a run: the report and its findings, in the order of the checks, as
 * plain data. The caller supplies the instants in the timestamp type of its SDK, and the actor
 * and the write context of trusted code.
 */
export function integrityRecords<Instant>(run: {
  readonly runId: string;
  readonly startedAt: Instant;
  readonly finishedAt: Instant;
  readonly actor: string;
  readonly writeContext: Readonly<Record<string, unknown>>;
  readonly findings: readonly IntegrityFinding[];
}): {
  readonly report: Record<string, unknown>;
  readonly findings: readonly { readonly id: string; readonly data: Record<string, unknown> }[];
} {
  const standard = { createdAt: run.finishedAt, createdBy: run.actor, writeContext: run.writeContext };
  return {
    report: {
      schemaVersion: COLLECTIONS.integrityReports.schemaVersion,
      ...standard,
      updatedAt: run.finishedAt,
      updatedBy: run.actor,
      archivedAt: null,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      status: "completed",
      counts: countFindings(run.findings),
    },
    findings: run.findings.slice(0, MAX_RECORDED_FINDINGS).map((finding, index) => ({
      id: sequenceId(index + 1),
      data: {
        schemaVersion: COLLECTIONS.integrityReportFindings.schemaVersion,
        ...standard,
        runId: run.runId,
        check: finding.check,
        documentPath: finding.documentPath,
        ...(finding.field === undefined ? {} : { field: finding.field }),
        detail: finding.detail,
      },
    })),
  };
}
