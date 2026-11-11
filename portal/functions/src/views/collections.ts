// What the functions of databases, custom properties, views and dashboards share: reading a
// database and deciding the level of a caller on it, deciding who may change a core record, and
// turning stored property definitions into the properties that values are checked against.
import {
  atLeast,
  COLLECTIONS,
  CORE_SOURCES,
  type CoreSource,
  type CoreSourceKey,
  collectionSchemaDocSchema,
  type DatabaseDoc,
  databaseDocSchema,
  definedProperties,
  isCoreSourceKey,
  type PageAccessLevel,
  type PropertyConfig,
  pageLevelFor,
  parseStoredDocument,
  type ResolvedAccess,
  type StoredPropertyDefinition,
  type ViewProperty,
} from "@eegml/shared";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { AppError, NOT_ALLOWED_MESSAGE, requireCapability } from "../framework";
import type { AuthenticatedContext } from "../framework/context";
import { levelOn, PAGE_NOT_FOUND_MESSAGE, readPage } from "../pages/pages";

export const DATABASE_NOT_FOUND_MESSAGE = "This database does not exist, or your account may not open it.";

export interface StoredDatabase {
  readonly id: string;
  readonly reference: DocumentReference;
  readonly data: DatabaseDoc;
}

export async function readDatabase(
  db: Firestore,
  transaction: Transaction,
  databaseId: string,
): Promise<StoredDatabase | null> {
  const reference = db.doc(COLLECTIONS.databases.docPath(databaseId));
  const snapshot = await transaction.get(reference);
  if (!snapshot.exists) return null;
  const parsed = parseStoredDocument(databaseDocSchema, snapshot.data());
  if (!parsed.success) throw parsed.error;
  return { id: databaseId, reference, data: parsed.data };
}

/** Whether the caller reads a database: its audience is the one it copied from its parent page. */
export function readsDatabase(access: ResolvedAccess, secondFactorVerified: boolean, database: DatabaseDoc): boolean {
  return (
    pageLevelFor(
      access,
      { secondFactorVerified },
      {
        accessMode: "restricted",
        replicationId: null,
        laboratoryId: null,
        scopeKeys: database.scopeKeys,
        levelKeys: database.levelKeys,
      },
    ) !== "none"
  );
}

/**
 * The level of the caller on a database, which is the level on its parent page. Refuses a
 * database the caller may not read as one that does not exist.
 */
export async function databaseLevel(
  db: Firestore,
  transaction: Transaction,
  context: Pick<AuthenticatedContext, "secondFactorVerified">,
  access: ResolvedAccess,
  database: StoredDatabase,
): Promise<PageAccessLevel> {
  if (!readsDatabase(access, context.secondFactorVerified, database.data)) {
    throw new AppError("not-found", DATABASE_NOT_FOUND_MESSAGE);
  }
  const page = await readPage(db, transaction, database.data.parentPageId);
  if (page === null) throw new AppError("not-found", PAGE_NOT_FOUND_MESSAGE);
  return levelOn(access, context.secondFactorVerified, page.data);
}

/** Refuses a caller who may not edit a database, or a database that is archived. */
export async function requireDatabaseEditor(
  db: Firestore,
  transaction: Transaction,
  context: Pick<AuthenticatedContext, "secondFactorVerified">,
  access: ResolvedAccess,
  database: StoredDatabase,
): Promise<void> {
  const level = await databaseLevel(db, transaction, context, access, database);
  if (!atLeast(level, "edit")) throw new AppError("permission-denied", "You may not change this database.");
  if (database.data.archivedAt !== null) {
    throw new AppError("failed-precondition", "This database is archived. Restore it before changing it.");
  }
}

/** The core source a collection key names, where it takes custom properties. */
export function customisableSource(collectionKey: string): CoreSource & { readonly customKey: string } {
  if (!isCoreSourceKey(collectionKey)) throw new AppError("not-found", "There is no such collection.");
  const source = CORE_SOURCES[collectionKey];
  if (source.customKey === null) throw new AppError("invalid-argument", "This collection takes no custom properties.");
  return { ...source, customKey: source.customKey };
}

/** The registry entry of the core documents of a source. */
export const CORE_ENTRIES = {
  "core:replications": "replications",
  "core:persons": "persons",
  "core:laboratories": "laboratories",
  "core:participations": "participations",
} as const satisfies Partial<Record<CoreSourceKey, string>>;
export type EditableCoreKey = keyof typeof CORE_ENTRIES;

/** The registry entry of the restricted custom values of each source. */
export const RESTRICTED_ENTRIES = {
  "core:replications": "replicationCustom",
  "core:persons": "personCustom",
  "core:laboratories": "laboratoryCustom",
  "core:participations": "participationCustom",
} as const satisfies Record<EditableCoreKey, string>;

export function isEditableCoreKey(key: string): key is EditableCoreKey {
  return key in CORE_ENTRIES;
}

/**
 * Refuses a caller who may not change a core record: the capability that changes the record
 * itself, in the scope of the record.
 */
export function requireCoreEditor(
  context: Pick<AuthenticatedContext, "secondFactorVerified">,
  access: ResolvedAccess,
  key: EditableCoreKey,
  id: string,
  document: Readonly<Record<string, unknown>>,
): void {
  switch (key) {
    case "core:replications":
      requireCapability(context, access, "replications.manage", { replicationId: id });
      return;
    case "core:laboratories":
      requireCapability(context, access, "labs.manage", { laboratoryId: id });
      return;
    case "core:participations": {
      const replicationId = typeof document.replicationId === "string" ? document.replicationId : null;
      const laboratoryId = typeof document.laboratoryId === "string" ? document.laboratoryId : null;
      if (replicationId === null || laboratoryId === null) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      requireCapability(context, access, "participations.manage", { replicationId, laboratoryId });
      return;
    }
    case "core:persons":
      requireCapability(context, access, "people.manage", "programme");
      return;
  }
}

/** The custom property definitions of a core source, as stored, or none. */
export async function readCustomDefinitions(
  db: Firestore,
  transaction: Transaction,
  customKey: string,
): Promise<Readonly<Record<string, StoredPropertyDefinition>>> {
  const snapshot = await transaction.get(db.doc(COLLECTIONS.collectionSchemas.docPath(customKey)));
  if (!snapshot.exists) return {};
  const parsed = parseStoredDocument(collectionSchemaDocSchema, snapshot.data());
  if (!parsed.success) throw parsed.error;
  return parsed.data.properties as Readonly<Record<string, StoredPropertyDefinition>>;
}

/** The properties of a database that take a value from a person, by identifier. */
export function databaseProperties(database: DatabaseDoc): ReadonlyMap<string, ViewProperty> {
  const properties = definedProperties(
    database.properties as Readonly<Record<string, StoredPropertyDefinition>>,
    () => "row",
  );
  return new Map(properties.map((property) => [property.id, property]));
}

/** A property config as it is stored: the fields that are set, and nothing undefined. */
export function storedConfig(config: PropertyConfig): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}
