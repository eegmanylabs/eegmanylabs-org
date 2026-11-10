// Maintenance of `access/{uid}`: the one document about an account that the security rules
// read (decision D-006).
//
// A callable function that changes what an access document is resolved from writes the new
// access document in its own transaction, so a revoked role or a suspension holds from the
// next request. The triggers of `triggers/access.ts` bring the document in line after every
// other change, such as an import or a tool. Both go through this file, and both write only
// when the resolved set differs from what is stored.
import {
  type AccessInputs,
  type AccessSources,
  COLLECTIONS,
  planAccessOf,
  type ResolvedAccess,
  readAccessSources,
  type StoredDocument,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import { type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import type { Logger } from "../framework/context";
import type { WriteStamp } from "../framework/documents";
import { adminReader } from "../framework/reader";

/** The actor recorded on an access document that a trigger or a tool brought in line. */
export const ACCESS_MAINTENANCE_ACTOR = systemActor("accessMaintenance");

/**
 * The access document of one account inside a transaction, between its reads and its write.
 * The transaction does not see its own pending writes, so a function that changes an input
 * says so here, with `inputs`, before it commits the draft.
 */
export interface AccessDraft {
  readonly uid: string;
  /** What the document is resolved from. Replace it to take a pending change into account. */
  inputs: AccessInputs;
  readonly stored: StoredDocument | null;
  readonly unreadable: readonly string[];
}

/**
 * Reads what the access document of an account is resolved from. Null for an account that has
 * no profile. Every read goes through the transaction, so call it before the first write.
 */
export async function draftAccess(
  db: Firestore,
  transaction: Transaction,
  uid: string,
  at: Date,
): Promise<AccessDraft | null> {
  const sources: AccessSources | null = await readAccessSources(adminReader(db, transaction), uid, at);
  return sources === null
    ? null
    : { uid, inputs: sources.inputs, stored: sources.stored, unreadable: sources.unreadable };
}

export type AccessOutcome = "created" | "updated" | "unchanged";

/** Resolves a draft and writes the access document where it differs from what is stored. */
export function commitAccess(
  db: Firestore,
  transaction: Transaction,
  draft: AccessDraft,
  stamp: WriteStamp,
): { readonly resolved: ResolvedAccess; readonly outcome: AccessOutcome } {
  const { resolved, write } = planAccessOf(
    { inputs: draft.inputs, stored: draft.stored, unreadable: draft.unreadable },
    { now: Timestamp.fromDate(stamp.at), actor: stamp.actor, writeContext: stamp.writeContext },
  );
  const reference = db.doc(COLLECTIONS.access.docPath(draft.uid));
  if (write.kind === "create") transaction.create(reference, write.document);
  else if (write.kind === "update") transaction.update(reference, write.changes);
  return { resolved, outcome: write.kind === "none" ? "unchanged" : write.kind === "create" ? "created" : "updated" };
}

/** An assignment as the resolver reads it. */
type AssignmentInput = AccessInputs["roleAssignments"][number];

/** The inputs with one role assignment added, or put in place of the stored one for the same role and scope. */
export function withAssignment(inputs: AccessInputs, assignment: AssignmentInput): AccessInputs {
  const others = inputs.roleAssignments.filter(
    (stored) =>
      !(
        stored.uid === assignment.uid &&
        stored.role === assignment.role &&
        stored.scopeType === assignment.scopeType &&
        stored.scopeId === assignment.scopeId
      ),
  );
  return { ...inputs, roleAssignments: [...others, assignment] };
}

/**
 * Brings the access document of one account in line with its sources, in a transaction of its
 * own. Used by the triggers. `absent` means that the account has no profile, and nothing is
 * written for it.
 */
export async function rebuildAccess(
  db: Firestore,
  uid: string,
  options: { readonly at: Date; readonly logger: Logger; readonly causationId?: string },
): Promise<AccessOutcome | "absent"> {
  const outcome = await db.runTransaction(async (transaction) => {
    const draft = await draftAccess(db, transaction, uid, options.at);
    if (draft === null) return "absent" as const;
    if (draft.unreadable.length > 0) {
      options.logger.warn("documents that do not fit their schema confer nothing", {
        uid,
        paths: draft.unreadable,
      });
    }
    return commitAccess(db, transaction, draft, {
      at: options.at,
      actor: ACCESS_MAINTENANCE_ACTOR,
      writeContext: { ...systemWriteContext(), causationId: options.causationId ?? null },
    }).outcome;
  });
  return outcome;
}

/** How many accounts a pass over every account brings in line at a time. */
const REBUILD_CONCURRENCY = 10;

/** Brings the access document of every account in line. Used when the matrix or the system setting changes. */
export async function rebuildAllAccess(
  db: Firestore,
  options: { readonly at: Date; readonly logger: Logger; readonly causationId?: string },
): Promise<Record<AccessOutcome | "absent", number>> {
  const counts = { created: 0, updated: 0, unchanged: 0, absent: 0 };
  const accounts = await db.collection(COLLECTIONS.users.collectionPath()).select().get();
  const uids = accounts.docs.map((document) => document.id);
  for (let start = 0; start < uids.length; start += REBUILD_CONCURRENCY) {
    const outcomes = await Promise.all(
      uids.slice(start, start + REBUILD_CONCURRENCY).map((uid) => rebuildAccess(db, uid, options)),
    );
    for (const outcome of outcomes) counts[outcome] += 1;
  }
  return counts;
}
