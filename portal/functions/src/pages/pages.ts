// Reading pages and resolving their audience in trusted code (docs/DATA_MODEL.md, section 9).
//
// The audience of a page that inherits is the audience of the page above it, or, at the top,
// that of the record it is the body of or of the programme's workspace. The callable functions
// that create, move and share pages resolve it with the builders of the shared package and
// write it onto the page and onto every page beneath it that inherits, in one transaction, so
// that the rules never walk a chain.
import {
  COLLECTIONS,
  type EntityPageType,
  laboratoryPageAudience,
  type PageAccessLevel,
  type PageAudience,
  type PageDoc,
  pageDocSchema,
  pageLevelFor,
  parseStoredDocument,
  personDocSchema,
  personPageAudience,
  type ResolvedAccess,
  replicationPageAudience,
  taskDocSchema,
  taskPageAudience,
  workspacePageAudience,
} from "@eegml/shared";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { touchedFields, type WriteStamp } from "../framework/documents";
import { AppError } from "../framework/errors";

export const PAGE_NOT_FOUND_MESSAGE = "This page does not exist, or your account may not open it.";

/** The most pages one move or one change of sharing rewrites: the page and those beneath it. */
export const PAGE_TREE_MAX = 400;

export interface StoredPage {
  readonly id: string;
  readonly reference: DocumentReference;
  readonly data: PageDoc;
}

/** A page, read in the transaction, or null where it does not exist. */
export async function readPage(db: Firestore, transaction: Transaction, pageId: string): Promise<StoredPage | null> {
  const reference = db.doc(COLLECTIONS.pages.docPath(pageId));
  const snapshot = await transaction.get(reference);
  if (!snapshot.exists) return null;
  const parsed = parseStoredDocument(pageDocSchema, snapshot.data());
  if (!parsed.success) throw parsed.error;
  return { id: pageId, reference, data: parsed.data };
}

/** The level of a caller on a page, from the caller's access document and the session's second factor. */
export function levelOn(access: ResolvedAccess, secondFactorVerified: boolean, page: PageDoc): PageAccessLevel {
  return pageLevelFor(access, { secondFactorVerified }, page);
}

/** The audience a page stores, as one value. */
export function audienceOf(page: PageDoc): PageAudience {
  return {
    replicationId: page.replicationId,
    laboratoryId: page.laboratoryId,
    scopeKeys: [...page.scopeKeys],
    levelKeys: {
      comment: [...page.levelKeys.comment],
      edit: [...page.levelKeys.edit],
      full: [...page.levelKeys.full],
    },
  };
}

/** Whether two audiences are the same. */
export function sameAudience(a: PageAudience, b: PageAudience): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The audience of the body page of a record, read in the transaction. A replication and a
 * laboratory must exist. The page of a member follows the account that claimed the person.
 */
export async function entityAudience(
  db: Firestore,
  transaction: Transaction,
  entityType: EntityPageType,
  entityId: string,
): Promise<{ readonly audience: PageAudience; readonly title: string }> {
  switch (entityType) {
    case "replication": {
      const replication = await transaction.get(db.doc(COLLECTIONS.replications.docPath(entityId)));
      if (!replication.exists) throw new AppError("not-found", "This replication does not exist.");
      return { audience: replicationPageAudience(entityId), title: `Notes on ${entityId}` };
    }
    case "laboratory": {
      const laboratory = await transaction.get(db.doc(COLLECTIONS.laboratories.docPath(entityId)));
      if (!laboratory.exists) throw new AppError("not-found", "This laboratory does not exist.");
      const name = laboratory.get("name");
      return {
        audience: laboratoryPageAudience(entityId),
        title: `Notes on ${typeof name === "string" ? name : "the laboratory"}`,
      };
    }
    case "person": {
      const snapshot = await transaction.get(db.doc(COLLECTIONS.persons.docPath(entityId)));
      const person = parseStoredDocument(personDocSchema, snapshot.data());
      if (!snapshot.exists || !person.success) throw new AppError("not-found", "This member does not exist.");
      return { audience: personPageAudience(person.data.userId), title: `Notes on ${person.data.displayName}` };
    }
    case "task": {
      const snapshot = await transaction.get(db.doc(COLLECTIONS.tasks.docPath(entityId)));
      const task = parseStoredDocument(taskDocSchema, snapshot.data());
      if (!snapshot.exists || !task.success) throw new AppError("not-found", "This task does not exist.");
      return { audience: taskPageAudience(task.data), title: `Description of ${task.data.title}`.slice(0, 300) };
    }
  }
}

/**
 * The audience that a page that inherits takes: that of its parent, of its record, or of the
 * workspace, where its creator holds full access.
 */
export async function inheritedAudience(
  db: Firestore,
  transaction: Transaction,
  page: PageDoc,
  parent: PageDoc | null,
): Promise<PageAudience> {
  if (parent !== null) return audienceOf(parent);
  if (
    page.entityType === "replication" ||
    page.entityType === "laboratory" ||
    page.entityType === "person" ||
    page.entityType === "task"
  ) {
    if (page.entityId === undefined) throw new Error("A body page names its record.");
    return (await entityAudience(db, transaction, page.entityType, page.entityId)).audience;
  }
  return workspacePageAudience(page.createdBy);
}

/**
 * The pages beneath a page, nearest first, read in the transaction. Refuses a tree larger than
 * one transaction may rewrite.
 */
export async function descendantsOf(db: Firestore, transaction: Transaction, pageId: string): Promise<StoredPage[]> {
  const found = await transaction.get(
    db
      .collection(COLLECTIONS.pages.collectionPath())
      .where("ancestorPageIds", "array-contains", pageId)
      .limit(PAGE_TREE_MAX),
  );
  if (found.size >= PAGE_TREE_MAX) {
    throw new AppError("resource-exhausted", "This page holds too many pages beneath it to change them at once.");
  }
  return found.docs
    .map((snapshot) => {
      const parsed = parseStoredDocument(pageDocSchema, snapshot.data());
      if (!parsed.success) throw parsed.error;
      return { id: snapshot.id, reference: snapshot.ref, data: parsed.data };
    })
    .sort((a, b) => a.data.ancestorPageIds.length - b.data.ancestorPageIds.length);
}

/**
 * The new place and audience of every page beneath a page whose place or audience changes. A
 * page that inherits takes the audience of its parent as it will be, and a restricted one keeps
 * its own. `ancestors` is the chain of the changed page as it will be, itself included.
 */
export function cascade(
  changed: { readonly id: string; readonly ancestors: readonly string[]; readonly audience: PageAudience },
  descendants: readonly StoredPage[],
): Map<string, { readonly ancestorPageIds: string[]; readonly audience: PageAudience }> {
  const resolved = new Map<string, { readonly ancestorPageIds: string[]; readonly audience: PageAudience }>();
  const audienceOfParent = (parentId: string | null): PageAudience | null =>
    parentId === changed.id ? changed.audience : parentId === null ? null : (resolved.get(parentId)?.audience ?? null);
  for (const descendant of descendants) {
    const at = descendant.data.ancestorPageIds.indexOf(changed.id);
    const ancestorPageIds = [...changed.ancestors, ...descendant.data.ancestorPageIds.slice(at + 1)];
    const parentAudience = audienceOfParent(descendant.data.parentPageId);
    const audience =
      descendant.data.accessMode === "inherit" && parentAudience !== null
        ? parentAudience
        : audienceOf(descendant.data);
    resolved.set(descendant.id, { ancestorPageIds, audience });
  }
  return resolved;
}

/** A database beneath one of the pages of a tree, as it copies the audience of its parent page. */
export interface StoredDatabaseCopy {
  readonly reference: DocumentReference;
  readonly parentPageId: string;
  readonly audience: { readonly scopeKeys: unknown; readonly levelKeys: unknown };
}

/** How many parent pages one query of databases names, the most an `in` filter takes. */
const IN_FILTER_MAX = 30;

/**
 * The databases beneath a set of pages, read in the transaction, so that a move or a change of
 * sharing rewrites their copy of the audience together with the pages.
 */
export async function databasesOf(
  db: Firestore,
  transaction: Transaction,
  pageIds: readonly string[],
): Promise<StoredDatabaseCopy[]> {
  const found: StoredDatabaseCopy[] = [];
  for (let start = 0; start < pageIds.length; start += IN_FILTER_MAX) {
    const snapshot = await transaction.get(
      db
        .collection(COLLECTIONS.databases.collectionPath())
        .where("parentPageId", "in", pageIds.slice(start, start + IN_FILTER_MAX)),
    );
    for (const database of snapshot.docs) {
      found.push({
        reference: database.ref,
        parentPageId: database.get("parentPageId") as string,
        audience: { scopeKeys: database.get("scopeKeys"), levelKeys: database.get("levelKeys") },
      });
    }
  }
  return found;
}

/**
 * Whether giving a page a new audience changes the audience of any page beneath it: those that
 * inherit follow it, which is a change of who may open them.
 */
export function treeAudienceChanges(
  page: StoredPage,
  audience: PageAudience,
  descendants: readonly StoredPage[],
): boolean {
  const resolved = cascade({ id: page.id, ancestors: [...page.data.ancestorPageIds, page.id], audience }, descendants);
  return descendants.some((descendant) => {
    const next = resolved.get(descendant.id);
    return next !== undefined && !sameAudience(next.audience, audienceOf(descendant.data));
  });
}

/**
 * Writes the new place and audience of a page, with any other fields that change, and those of
 * every page beneath it whose place or audience changes as a result, and the copy of the
 * audience that each database beneath those pages holds. Call after the last read of the
 * transaction. The trigger that follows pages stays as a backstop for the databases.
 */
export function rewriteTree(
  transaction: Transaction,
  stamp: WriteStamp,
  page: StoredPage,
  next: {
    readonly ancestorPageIds: readonly string[];
    readonly audience: PageAudience;
    readonly fields?: Readonly<Record<string, unknown>>;
  },
  descendants: readonly StoredPage[],
  databases: readonly StoredDatabaseCopy[] = [],
): void {
  transaction.update(page.reference, {
    ...next.fields,
    ancestorPageIds: [...next.ancestorPageIds],
    ...next.audience,
    ...touchedFields(stamp),
  });
  const resolved = cascade(
    { id: page.id, ancestors: [...next.ancestorPageIds, page.id], audience: next.audience },
    descendants,
  );
  for (const descendant of descendants) {
    const update = resolved.get(descendant.id);
    if (update === undefined) continue;
    const moved = update.ancestorPageIds.join("/") !== descendant.data.ancestorPageIds.join("/");
    if (!moved && sameAudience(update.audience, audienceOf(descendant.data))) continue;
    transaction.update(descendant.reference, {
      ancestorPageIds: update.ancestorPageIds,
      ...update.audience,
      ...touchedFields(stamp),
    });
  }
  for (const database of databases) {
    const audience = database.parentPageId === page.id ? next.audience : resolved.get(database.parentPageId)?.audience;
    if (audience === undefined) continue;
    const copy = { scopeKeys: audience.scopeKeys, levelKeys: audience.levelKeys };
    if (JSON.stringify(copy) === JSON.stringify(database.audience)) continue;
    transaction.update(database.reference, { ...copy, ...touchedFields(stamp) });
  }
}
