import {
  COLLECTIONS,
  CORE_SOURCES,
  collectionSchemaDocSchema,
  compileFormula,
  DATABASE_TITLE_PROPERTY,
  databaseIdOf,
  FormulaError,
  isCoreSourceKey,
  orderBetween,
  PROGRAMME_KEY,
  type PropertyConfig,
  type PropertyType,
  type ResolvedAccess,
  type StoredPropertyDefinition,
  savePropertyContract,
} from "@eegml/shared";
import { type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";
import {
  CORE_ENTRIES,
  customisableSource,
  DATABASE_NOT_FOUND_MESSAGE,
  isEditableCoreKey,
  readCustomDefinitions,
  readDatabase,
  readsDatabase,
  requireDatabaseEditor,
  storedConfig,
} from "../views/collections";

/** The most properties a collection holds, which the schemas cap as well. */
const PROPERTIES_MAX = 200;

const OPTION_TYPES: readonly PropertyType[] = ["select", "multiSelect", "status"];
const NUMBER_TYPES: readonly PropertyType[] = ["number", "rollup", "formula"];
const DATE_TYPES: readonly PropertyType[] = ["date", "dateRange"];

/** Lookups that only the identifiers of the fields of a core source are read with. */
const NO_LOOKUPS = { laboratoryName: () => null, replicationStatuses: [] };

/** The identifiers of the properties of a collection, which a rollup may read. */
async function propertyIdsOf(
  db: Firestore,
  transaction: Transaction,
  access: ResolvedAccess,
  secondFactorVerified: boolean,
  collectionKey: string,
): Promise<ReadonlySet<string>> {
  if (isCoreSourceKey(collectionKey)) {
    const source = CORE_SOURCES[collectionKey];
    const custom = source.customKey === null ? {} : await readCustomDefinitions(db, transaction, source.customKey);
    return new Set([...source.fields(NO_LOOKUPS).map((field) => field.id), ...Object.keys(custom)]);
  }
  const databaseId = databaseIdOf(collectionKey);
  const database = databaseId === null ? null : await readDatabase(db, transaction, databaseId);
  if (database === null || !readsDatabase(access, secondFactorVerified, database.data)) {
    throw new AppError("invalid-argument", "The collection that the property refers to does not exist.");
  }
  return new Set([DATABASE_TITLE_PROPERTY, ...Object.keys(database.data.properties)]);
}

/**
 * The configuration a property of a type keeps, checked: unique options, a relation to a
 * collection that exists, a rollup of a property that exists, and a formula that parses.
 */
async function checkedConfig(
  db: Firestore,
  transaction: Transaction,
  access: ResolvedAccess,
  secondFactorVerified: boolean,
  type: PropertyType,
  config: PropertyConfig,
  siblings: Readonly<Record<string, { readonly type: string; readonly config: Readonly<Record<string, unknown>> }>>,
): Promise<PropertyConfig> {
  const kept: PropertyConfig = {};
  if (OPTION_TYPES.includes(type)) {
    const options = config.options ?? [];
    if (new Set(options.map((option) => option.id)).size !== options.length) {
      throw new AppError("invalid-argument", "Two options have the same identifier.");
    }
    kept.options = options;
  }
  if (NUMBER_TYPES.includes(type) && config.numberFormat !== undefined) kept.numberFormat = config.numberFormat;
  if (DATE_TYPES.includes(type) && config.includeTime !== undefined) kept.includeTime = config.includeTime;
  if (type === "relation") {
    const target = config.relation?.target;
    if (target === undefined) throw new AppError("invalid-argument", "A relation names the collection it links to.");
    if (isCoreSourceKey(target) ? !CORE_SOURCES[target].selectable : false) {
      throw new AppError("invalid-argument", "A relation cannot link to that collection.");
    }
    await propertyIdsOf(db, transaction, access, secondFactorVerified, target);
    kept.relation = { target };
  }
  if (type === "rollup") {
    const rollup = config.rollup;
    if (rollup === undefined) throw new AppError("invalid-argument", "A rollup names what it rolls up.");
    let targetCollection: string;
    if ("relation" in rollup.source) {
      const relation = siblings[rollup.source.relation];
      const target = (relation?.config.relation as { target?: unknown } | undefined)?.target;
      if (relation?.type !== "relation" || typeof target !== "string") {
        throw new AppError("invalid-argument", "A rollup goes through a relation property of the same collection.");
      }
      targetCollection = target;
    } else {
      targetCollection = rollup.source.backlink.collection;
      const backlinkProperties = await propertyIdsOf(db, transaction, access, secondFactorVerified, targetCollection);
      if (!backlinkProperties.has(rollup.source.backlink.property)) {
        throw new AppError("invalid-argument", "The collection of the backlink has no such relation.");
      }
    }
    const targetProperties = await propertyIdsOf(db, transaction, access, secondFactorVerified, targetCollection);
    if (!targetProperties.has(rollup.property)) {
      throw new AppError("invalid-argument", "The related collection has no such property.");
    }
    kept.rollup = rollup;
  }
  if (type === "formula") {
    const expression = config.formula?.expression ?? "";
    try {
      compileFormula(expression);
    } catch (error) {
      if (error instanceof FormulaError)
        throw new AppError("invalid-argument", `The formula cannot be used: ${error.message}`);
      throw error;
    }
    kept.formula = { expression };
  }
  return kept;
}

/** The position after the last of a set of definitions. */
function orderAfter(definitions: Readonly<Record<string, { readonly order: string }>>): string {
  const last = Object.values(definitions)
    .map((definition) => definition.order)
    .sort()
    .at(-1);
  return orderBetween(last ?? null, null);
}

/**
 * Adds, changes or archives a property. For a database: the level `edit` on its parent page.
 * For a core collection: `lookups.manage` for the programme, and a property never takes the
 * identifier of a core field, so a custom value never overwrites one. The type and the audience
 * of a property are fixed once it exists, so no value ever changes its meaning. The definition
 * and its audit entry are written in one transaction.
 */
export const saveProperty = defineCallable(savePropertyContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      const databaseId = databaseIdOf(input.collectionKey);

      let definitions: Readonly<Record<string, StoredPropertyDefinition>>;
      let reserved: ReadonlySet<string>;
      let write: (propertyId: string, definition: Record<string, unknown>, auditEventId: string) => void;
      let audited: { readonly entityType: "database" | "programme"; readonly entityId: string };

      if (databaseId !== null) {
        const database = await readDatabase(db, transaction, databaseId);
        if (database === null) throw new AppError("not-found", DATABASE_NOT_FOUND_MESSAGE);
        await requireDatabaseEditor(db, transaction, context, access, database);
        definitions = database.data.properties as Readonly<Record<string, StoredPropertyDefinition>>;
        reserved = new Set([DATABASE_TITLE_PROPERTY]);
        audited = { entityType: "database", entityId: databaseId };
        write = (propertyId, definition, auditEventId) =>
          transaction.update(database.reference, {
            [`properties.${propertyId}`]: definition,
            ...touchedFields(callerStamp(uid, at, auditEventId)),
          });
      } else {
        const source = customisableSource(input.collectionKey);
        requireCapability(context, access, "lookups.manage", "programme");
        if (input.audience === undefined) {
          throw new AppError("invalid-argument", "A custom property states who may read its values.");
        }
        definitions = await readCustomDefinitions(db, transaction, source.customKey);
        const entryKey = isEditableCoreKey(source.key) ? CORE_ENTRIES[source.key] : null;
        reserved = new Set([
          ...source.fields(NO_LOOKUPS).map((field) => field.id),
          ...(entryKey === null ? [] : Object.keys(COLLECTIONS[entryKey].schema.shape)),
        ]);
        audited = { entityType: "programme", entityId: PROGRAMME_KEY };
        const reference = db.doc(COLLECTIONS.collectionSchemas.docPath(source.customKey));
        const exists = Object.keys(definitions).length > 0 || (await transaction.get(reference)).exists;
        write = (propertyId, definition, auditEventId) => {
          const stamp = callerStamp(uid, at, auditEventId);
          if (exists) {
            transaction.update(reference, { [`properties.${propertyId}`]: definition, ...touchedFields(stamp) });
          } else {
            transaction.set(
              reference,
              collectionSchemaDocSchema.parse({
                ...createdFields("collectionSchemas", stamp),
                collectionKey: source.customKey,
                properties: { [propertyId]: definition },
              }),
            );
          }
        };
      }

      const existing = input.propertyId === undefined ? undefined : definitions[input.propertyId];
      if (input.propertyId !== undefined && (existing === undefined || reserved.has(input.propertyId))) {
        throw new AppError("not-found", "This property does not exist.");
      }
      if (existing !== undefined && existing.type !== input.type) {
        throw new AppError(
          "failed-precondition",
          "The type of a property does not change. Add a new property instead.",
        );
      }
      if (existing !== undefined && databaseId === null && existing.audience !== input.audience) {
        throw new AppError(
          "failed-precondition",
          "Who may read a property does not change. Add a new property instead.",
        );
      }
      if (existing === undefined && Object.keys(definitions).length >= PROPERTIES_MAX) {
        throw new AppError("resource-exhausted", `A collection holds at most ${PROPERTIES_MAX} properties.`);
      }
      const config = await checkedConfig(
        db,
        transaction,
        access,
        context.secondFactorVerified,
        input.type,
        input.config,
        definitions,
      );
      const propertyId =
        input.propertyId ?? `p${db.collection(COLLECTIONS.databases.collectionPath()).doc().id.slice(0, 12)}`;
      const definition: Record<string, unknown> = {
        key: propertyId,
        name: input.name,
        type: input.type,
        config: storedConfig(config),
        order: existing?.order ?? orderAfter(definitions),
        archivedAt: input.archived === true ? (existing?.archivedAt ?? Timestamp.fromDate(at)) : null,
        ...(databaseId === null ? { audience: input.audience } : {}),
      };
      const auditEventId = writeAudit(
        transaction,
        {
          action: "property.saved",
          actor: { kind: "user", uid },
          entityType: audited.entityType,
          entityId: audited.entityId,
          changes: [
            { field: "collectionKey", after: input.collectionKey },
            { field: "propertyId", after: propertyId },
            { field: "name", after: input.name },
            { field: "type", after: input.type },
            { field: "archived", after: input.archived === true },
          ],
          at,
        },
        db,
      );
      write(propertyId, definition, auditEventId);
      return { propertyId };
    });
  },
});
