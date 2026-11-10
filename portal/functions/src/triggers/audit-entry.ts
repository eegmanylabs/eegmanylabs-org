// What the audit trigger records for one write (decision D-007 and docs/DATA_MODEL.md,
// section 13). This file is pure: it turns the two states of a document into an audit entry,
// or decides that the write needs none. `audit.ts` reads and writes the database around it.
import { createHash } from "node:crypto";
import {
  AUDIT_WITHHELD_MARKER,
  type AuditAction,
  type AuditActorKind,
  type AuditChange,
  type CollectionEntry,
  DOCUMENT_BASE_FIELDS,
  type EntityType,
  entityOfDocumentPath,
  entryOfDocumentPath,
  isFirestoreTimestamp,
  isSystemActor,
  namesSpecialCategory,
  WRITE_ORIGINS,
  type WriteOrigin,
} from "@eegml/shared";

/** One write as the trigger sees it. */
export interface ObservedWrite {
  /** The identifier of the event, which names the audit entry, so that a second delivery writes nothing new. */
  readonly eventId: string;
  /** The path of the document, relative to the database. */
  readonly documentPath: string;
  readonly before: Readonly<Record<string, unknown>> | null;
  readonly after: Readonly<Record<string, unknown>> | null;
  /** The kind of principal that the platform names as the writer. */
  readonly authType: string;
  /** The identifier of that principal, where the platform gives one. */
  readonly authId: string | null;
  readonly time: Date;
}

/** The kind of principal that the platform names for a person signed in through Firebase Authentication. */
export const END_USER_AUTH_TYPE = "app_user";

/** A value of a member-readable document above this many bytes is recorded as its size and its hash. */
export const AUDIT_VALUE_MAX_BYTES = 10 * 1024;

/**
 * The fields that every write changes, or that say nothing beyond what the entry itself says:
 * the stamps of a write. Archiving is a change like any other, so `archivedAt` is recorded.
 */
const STAMP_FIELDS: readonly string[] = DOCUMENT_BASE_FIELDS.filter((field) => field !== "archivedAt");

/**
 * Whether the audit trigger records writes to a collection: the registry flags it as audited
 * and lets clients write to it. What only trusted code writes is recorded by that code.
 */
export function coveredByAuditTrigger(entry: CollectionEntry): boolean {
  return entry.flags.audited && entry.write.mode === "client";
}

/** The audit entry that a write names as its own, or null. */
function namedAuditEntry(data: Readonly<Record<string, unknown>> | null): string | null {
  const context = data?.writeContext;
  if (typeof context !== "object" || context === null) return null;
  const id = (context as { auditEventId?: unknown }).auditEventId;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * The audit entry that a callable function says it wrote for this change, or null.
 *
 * A function writes its entry in the transaction of the change and names it in
 * `writeContext.auditEventId` of each document it writes. The security rules refuse a client
 * write that names an entry, so a name that is new with this write was set by trusted code.
 * A name that the document carried before says nothing about this write. The trigger still
 * looks the entry up before it believes the claim (see `audit.ts`).
 */
export function claimedAuditEntry(write: Pick<ObservedWrite, "before" | "after">): string | null {
  if (write.after === null) return null;
  const named = namedAuditEntry(write.after);
  return named !== null && named !== namedAuditEntry(write.before) ? named : null;
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
    return (
      leftKeys.length === Object.keys(right).length &&
      leftKeys.every((key) =>
        sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
      )
    );
  }
  return left === right;
}

/** Whether the name of a field says that its value is never recorded, whatever document holds it. */
export function namesWithheldField(field: string): boolean {
  return namesSpecialCategory(field) || field.toLowerCase().includes("email");
}

const isPlainMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && !isFirestoreTimestamp(value);

/** A value with every nested field of a withheld name replaced by the marker. */
function scrubbed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubbed);
  if (!isPlainMap(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      namesWithheldField(key) ? AUDIT_WITHHELD_MARKER : scrubbed(child),
    ]),
  );
}

/** A value as the entry holds it: scrubbed, and replaced by its size and hash where it is large. */
function recorded(value: unknown): unknown {
  const clean = scrubbed(value);
  const serialised = JSON.stringify(clean, (_key, child: unknown) =>
    isFirestoreTimestamp(child) ? { seconds: child.seconds, nanoseconds: child.nanoseconds } : child,
  );
  if (serialised === undefined || Buffer.byteLength(serialised, "utf8") <= AUDIT_VALUE_MAX_BYTES) return clean;
  return {
    sizeBytes: Buffer.byteLength(serialised, "utf8"),
    sha256: createHash("sha256").update(serialised, "utf8").digest("hex"),
  };
}

/**
 * The fields that differ between two states of a document, in the order of their names.
 *
 * | Document                                             | The entry holds                          |
 * |------------------------------------------------------|------------------------------------------|
 * | Of the class `restricted` or `special`               | The names of the fields, and no value    |
 * | Any, for a field whose name is withheld              | The name of the field, and no value      |
 * | Of the class `member` or `public`                    | The name, the value before and the value after |
 */
export function auditChangesOf(
  entry: Pick<CollectionEntry, "dataClass">,
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>> | null,
): AuditChange[] {
  const withValues = entry.dataClass === "member" || entry.dataClass === "public";
  const fields = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])]
    .filter((field) => !STAMP_FIELDS.includes(field))
    .sort();
  const changes: AuditChange[] = [];
  for (const field of fields) {
    const previous = before?.[field];
    const next = after?.[field];
    if (sameValue(previous, next)) continue;
    if (!withValues || namesWithheldField(field)) {
      changes.push({ field, withheld: true });
      continue;
    }
    changes.push({
      field,
      ...(previous === undefined ? {} : { before: recorded(previous) }),
      ...(next === undefined ? {} : { after: recorded(next) }),
    });
  }
  return changes;
}

export interface AuditedActor {
  readonly actorKind: AuditActorKind;
  readonly actorUid: string | null;
  /** True when the platform and the document name different accounts as the writer. */
  readonly mismatch: boolean;
}

const originOf = (data: Readonly<Record<string, unknown>> | null): WriteOrigin | null => {
  const origin = (data?.writeContext as { origin?: unknown } | undefined)?.origin;
  return (WRITE_ORIGINS as readonly unknown[]).includes(origin) ? (origin as WriteOrigin) : null;
};

/**
 * Who made a write.
 *
 * The security rules bind `updatedBy` of a client write to the caller, so the document names
 * its writer. The platform names the principal as well, and where it names a person signed in
 * through Firebase Authentication, that account is the actor and a document that says otherwise
 * is reported as a mismatch. The emulator supplies placeholders in place of the principal, and
 * what production supplies is confirmed on staging, so the document remains the first source.
 * A deletion leaves no document: its actor is known from the platform alone.
 */
export function auditedActorOf(write: Pick<ObservedWrite, "after" | "authType" | "authId">): AuditedActor {
  const platformUid =
    write.authType === END_USER_AUTH_TYPE && write.authId !== null && write.authId !== "" ? write.authId : null;
  const written = typeof write.after?.updatedBy === "string" ? write.after.updatedBy : null;
  const origin = originOf(write.after);
  const writtenUid =
    written !== null && !isSystemActor(written) && (origin === "user" || origin === null) ? written : null;
  if (platformUid !== null) {
    return { actorKind: "user", actorUid: platformUid, mismatch: writtenUid !== null && writtenUid !== platformUid };
  }
  if (writtenUid !== null) return { actorKind: "user", actorUid: writtenUid, mismatch: false };
  return { actorKind: origin === null || origin === "user" ? "system" : origin, actorUid: null, mismatch: false };
}

const ACTION_OF = {
  created: "document.created",
  updated: "document.updated",
  deleted: "document.deleted",
} as const satisfies Record<string, AuditAction>;

/** The audit entry of a write without its standard fields, or null where the trigger records nothing. */
export interface PlannedAuditEntry {
  readonly actor: AuditedActor;
  readonly action: AuditAction;
  readonly documentPath: string;
  readonly entityType: EntityType | null;
  readonly entityId: string | null;
  readonly changes: AuditChange[];
  readonly origin: WriteOrigin;
  readonly depth: number;
  readonly correlationId: string | null;
  readonly causationId: string | null;
}

/**
 * Plans the audit entry of a write. Null for a path outside the registry, for a collection that
 * the trigger does not cover and for an event that carries no document at all.
 */
export function planAuditEntry(write: ObservedWrite): PlannedAuditEntry | null {
  const matched = entryOfDocumentPath(write.documentPath);
  if (matched === null || !coveredByAuditTrigger(matched.entry)) return null;
  if (write.before === null && write.after === null) return null;
  const operation = write.before === null ? "created" : write.after === null ? "deleted" : "updated";
  const actor = auditedActorOf(write);
  const entity = entityOfDocumentPath(write.documentPath);
  const context = (write.after ?? write.before)?.writeContext as
    | { depth?: unknown; correlationId?: unknown; causationId?: unknown }
    | undefined;
  const text = (value: unknown) => (typeof value === "string" && value !== "" ? value.slice(0, 200) : null);
  return {
    actor,
    action: ACTION_OF[operation],
    documentPath: write.documentPath,
    entityType: entity?.entityType ?? null,
    entityId: entity?.entityId ?? null,
    changes: auditChangesOf(matched.entry, write.before, write.after),
    origin: actor.actorKind,
    // A deletion is no part of the chain that the last stored state belongs to.
    depth: operation !== "deleted" && typeof context?.depth === "number" && context.depth >= 0 ? context.depth : 0,
    correlationId: operation === "deleted" ? null : text(context?.correlationId),
    causationId: operation === "deleted" ? null : text(context?.causationId),
  };
}
