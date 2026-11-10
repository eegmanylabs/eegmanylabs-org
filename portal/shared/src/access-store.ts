// How the documents behind an access document are read, and how a resolved access set is
// compared with what is stored (docs/DATA_MODEL.md, section 14, the first row of derived data).
//
// This file is pure. `DocumentReader` is an interface that the functions and the tools each
// implement over the Admin SDK, so both resolve `access/{uid}` from the same documents in the
// same way, and neither imports the other.
import { type AccessDocument, type AccessInputs, type ResolvedAccess, resolveAccess } from "./access";
import { COLLECTIONS } from "./collections";
import { parseStoredDocument, type WriteContext } from "./schemas/base";
import {
  accessDocSchema,
  capabilityGrantDocSchema,
  recordGrantDocSchema,
  roleAssignmentDocSchema,
  roleCapabilitiesDocSchema,
} from "./schemas/identity";
import { type FirestoreTimestamp, isFirestoreTimestamp } from "./timestamp";
import type { z } from "./zod";

/** A document as it is stored: its identifier and its fields. */
export interface StoredDocument {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * The reads that trusted code needs of the database. Inside a transaction the implementation
 * reads through the transaction, so that what is read is what the transaction commits against.
 */
export interface DocumentReader {
  /** One document by its path, or null when it does not exist. */
  get(path: string): Promise<StoredDocument | null>;
  /** The documents of a collection in which a field equals a value. */
  whereEquals(collectionPath: string, field: string, value: string): Promise<readonly StoredDocument[]>;
  /** The documents of a collection in which an array field holds a value. */
  whereArrayContains(collectionPath: string, field: string, value: string): Promise<readonly StoredDocument[]>;
  /** Every document of a collection. For collections that stay small, such as `roleCapabilities`. */
  list(collectionPath: string): Promise<readonly StoredDocument[]>;
}

/** What `access/{uid}` is resolved from, as it is stored now. */
export interface AccessSources {
  readonly inputs: AccessInputs;
  /** The access document as it is stored, or null when the account has none. */
  readonly stored: StoredDocument | null;
  /**
   * The paths of documents that do not fit their schema. Such a document confers nothing, so a
   * damaged grant never widens what an account may do. The caller logs the paths.
   */
  readonly unreadable: readonly string[];
}

function parsed<Schema extends z.ZodType>(
  schema: Schema,
  path: string,
  documents: readonly StoredDocument[],
  unreadable: string[],
): z.output<Schema>[] {
  const valid: z.output<Schema>[] = [];
  for (const document of documents) {
    const result = parseStoredDocument(schema, document.data);
    if (result.success) valid.push(result.data);
    else unreadable.push(`${path}/${document.id}`);
  }
  return valid;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((element): element is string => typeof element === "string") : [];

/**
 * Whether the system setting asks holders of a programme role or of a named grant for a second
 * factor. Only an explicit `false` switches it off: a missing document, a missing field and
 * anything that is no boolean all mean true.
 */
export function requireSecondFactorOf(settings: Readonly<Record<string, unknown>> | null): boolean {
  return settings?.requireSecondFactor !== false;
}

/**
 * Reads everything the access document of one account is resolved from. Returns null for an
 * account that has no profile in `users`: an account that has never started the portal has no
 * access document, and none is made for it.
 */
export async function readAccessSources(reader: DocumentReader, uid: string, now: Date): Promise<AccessSources | null> {
  const user = await reader.get(COLLECTIONS.users.docPath(uid));
  if (user === null) return null;
  const personId = typeof user.data.personId === "string" && user.data.personId !== "" ? user.data.personId : null;
  const [stored, assignments, grants, records, groups, overrides, settings, person] = await Promise.all([
    reader.get(COLLECTIONS.access.docPath(uid)),
    reader.whereEquals(COLLECTIONS.roleAssignments.collectionPath(), "uid", uid),
    reader.whereEquals(COLLECTIONS.capabilityGrants.collectionPath(), "uid", uid),
    reader.whereEquals(COLLECTIONS.recordGrants.collectionPath(), "uid", uid),
    reader.whereArrayContains(COLLECTIONS.groups.collectionPath(), "memberUids", uid),
    reader.list(COLLECTIONS.roleCapabilities.collectionPath()),
    reader.get(COLLECTIONS.systemSettings.docPath()),
    personId === null ? null : reader.get(COLLECTIONS.persons.docPath(personId)),
  ]);

  const unreadable: string[] = [];
  const boundary = stored?.data.sessionsValidAfter;
  const inputs: AccessInputs = {
    uid,
    now,
    user: {
      // Anything but a plain `active` profile is treated as the stricter state.
      status: user.data.status === "active" ? "active" : "suspended",
      mfaEnrolled: user.data.mfaEnrolled === true,
    },
    personId,
    sessionsValidAfter: isFirestoreTimestamp(boundary) ? boundary : null,
    roleAssignments: parsed(
      roleAssignmentDocSchema,
      COLLECTIONS.roleAssignments.collectionPath(),
      assignments,
      unreadable,
    ),
    capabilityGrants: parsed(
      capabilityGrantDocSchema,
      COLLECTIONS.capabilityGrants.collectionPath(),
      grants,
      unreadable,
    ),
    roleCapabilities: parsed(
      roleCapabilitiesDocSchema,
      COLLECTIONS.roleCapabilities.collectionPath(),
      overrides,
      unreadable,
    ),
    recordGrants: parsed(recordGrantDocSchema, COLLECTIONS.recordGrants.collectionPath(), records, unreadable),
    groupKeys: groups.map((group) => group.id),
    // The person document lists the replications of its current, confirmed memberships, which a
    // trigger derives. They count only while the person names this account as its login.
    confirmedReplicationIds: person !== null && person.data.userId === uid ? strings(person.data.replicationIds) : [],
    requireSecondFactor: requireSecondFactorOf(settings?.data ?? null),
  };
  return { inputs, stored, unreadable };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (isFirestoreTimestamp(left) || isFirestoreTimestamp(right)) {
    return (
      isFirestoreTimestamp(left) &&
      isFirestoreTimestamp(right) &&
      left.seconds === right.seconds &&
      left.nanoseconds === right.nanoseconds
    );
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((element, index) => sameValue(element, right[index]))
    );
  }
  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every((key) =>
        sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
      )
    );
  }
  return left === right;
}

/** The fields of a resolved access set that differ from the stored document. */
export function changedAccessFields(
  stored: Readonly<Record<string, unknown>>,
  resolved: ResolvedAccess,
): (keyof ResolvedAccess)[] {
  return (Object.keys(resolved) as (keyof ResolvedAccess)[]).filter(
    (field) => !sameValue(stored[field], resolved[field]),
  );
}

/** What a writer of an access document adds to the resolved set. */
export interface AccessStamp {
  readonly now: FirestoreTimestamp;
  /** A uid, or a system actor string. */
  readonly actor: string;
  readonly writeContext: WriteContext;
}

const accessChangesSchema = accessDocSchema.partial();
/** The fields of an update of an access document: only those that differ, with the standard fields of an update. */
export type AccessChanges = z.output<typeof accessChangesSchema>;

/**
 * | Kind     | The writer                                                               |
 * |----------|--------------------------------------------------------------------------|
 * | `none`   | Writes nothing: the stored document already says what was resolved       |
 * | `create` | Creates the document                                                     |
 * | `update` | Updates the fields that differ, with the standard fields of an update    |
 */
export type AccessWrite =
  | { readonly kind: "none" }
  | { readonly kind: "create"; readonly document: AccessDocument }
  | { readonly kind: "update"; readonly changes: AccessChanges };

/**
 * Decides what to write so that the stored access document says what was resolved. A document
 * that already does is left alone, which is what makes access maintenance idempotent: a
 * trigger that is delivered twice, or that follows a function which has already written the
 * result, writes nothing.
 */
export function planAccessWrite(
  stored: StoredDocument | null,
  resolved: ResolvedAccess,
  stamp: AccessStamp,
): AccessWrite {
  if (stored === null) {
    return {
      kind: "create",
      document: accessDocSchema.parse({
        schemaVersion: COLLECTIONS.access.schemaVersion,
        createdAt: stamp.now,
        updatedAt: stamp.now,
        createdBy: stamp.actor,
        updatedBy: stamp.actor,
        archivedAt: null,
        writeContext: stamp.writeContext,
        ...resolved,
      }),
    };
  }
  const changed = changedAccessFields(stored.data, resolved);
  if (changed.length === 0) return { kind: "none" };
  const changes: Record<string, unknown> = {
    updatedAt: stamp.now,
    updatedBy: stamp.actor,
    writeContext: stamp.writeContext,
  };
  for (const field of changed) changes[field] = resolved[field];
  return { kind: "update", changes: accessChangesSchema.parse(changes) };
}

/** Resolves the access set of the sources and plans its write in one step. */
export function planAccessOf(
  sources: AccessSources,
  stamp: AccessStamp,
): { resolved: ResolvedAccess; write: AccessWrite } {
  const resolved = resolveAccess(sources.inputs);
  return { resolved, write: planAccessWrite(sources.stored, resolved, stamp) };
}
