import {
  COLLECTIONS,
  capabilityGrantId,
  getDemographicAggregatesContract,
  getPersonDemographicsContract,
  type PersonDemographics,
  parseStoredDocument,
  personDemographicsDocSchema,
  releaseDemographicCounts,
  SMALL_CELL_THRESHOLD,
  SPECIAL_CATEGORY_FIELDS,
} from "@eegml/shared";
import {
  AppError,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  requireCapability,
  withheldChanges,
  writeAudit,
} from "../framework";
import { grantInForce } from "../people/demographics-grant";

/**
 * Serves the special-category data of one person: gender and ethnicity (decision D-006 and
 * docs/SECURITY.md, section 2). No security rule lets any client read the document, so this
 * function is the only route to it.
 *
 * | Caller                    | Is served when                                                       |
 * |---------------------------|----------------------------------------------------------------------|
 * | The person concerned      | Their account is the one linked to the person                        |
 * | Anybody else              | The access document confers `demographics.read`, a named grant of it to the caller is neither revoked nor expired, and the second factor is satisfied |
 *
 * Every other reader needs the named grant, programme administrators included. Each call
 * writes an audit entry in the transaction that reads the data: who read whose record, and
 * which fields were served, never a value. Nothing of the data is logged.
 */
export const getPersonDemographics = defineCallable(getPersonDemographicsContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const personReference = db.doc(COLLECTIONS.persons.docPath(input.personId));
    const demographicsReference = db.doc(COLLECTIONS.personDemographics.docPath(input.personId));
    const grantReference = db.doc(COLLECTIONS.capabilityGrants.docPath(capabilityGrantId(uid, "demographics.read")));

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      const [person, grantSnapshot] = await transaction.getAll(personReference, grantReference);
      const own = person?.exists === true && person.get("userId") === uid && !access.suspended;
      if (!own) {
        requireCapability(context, access, "demographics.read", "programme");
        if (!grantInForce(grantSnapshot, at)) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
        if (person?.exists !== true) throw new AppError("not-found", "This person does not exist.");
      }

      const snapshot = await transaction.get(demographicsReference);
      const stored = snapshot.exists ? parseStoredDocument(personDemographicsDocSchema, snapshot.data()) : null;
      if (stored !== null && !stored.success)
        throw new Error("A stored demographics document does not fit its schema.");
      let demographics: PersonDemographics | null = null;
      if (stored !== null) {
        const values: Record<string, string> = {};
        for (const field of SPECIAL_CATEGORY_FIELDS) {
          const value = stored.data[field];
          if (value !== undefined) values[field] = value;
        }
        demographics = { ...values, recordedAt: stored.data.recordedAt.toDate().toISOString() };
      }

      writeAudit(
        transaction,
        {
          action: "demographics.read",
          actor: { kind: "user", uid },
          entityType: "person",
          entityId: input.personId,
          changes: withheldChanges(
            demographics === null ? [] : Object.keys(demographics).filter((field) => field !== "recordedAt"),
          ),
          at,
        },
        db,
      );
      return { personId: input.personId, demographics };
    });
  },
});

/** The text that stands for a person with nothing recorded in a field. */
const NOT_RECORDED = "Not recorded";

/**
 * Serves counts of one special-category field for the people of a scope, for the analysis views
 * (requirement R15.10). It is the second route of this audited function and takes the same
 * authorisation as the reading of another person's data: `demographics.read`, a named grant of
 * it that is neither revoked nor expired, and the second factor, programme administrators
 * included. Nobody is served their own record this way. What is released follows
 * `releaseDemographicCounts`: nothing for a scope of fewer people than `SMALL_CELL_THRESHOLD`,
 * suppressed groups folded into one unnamed cell, no value named unless two values reach the
 * threshold, and neither the people nor the total wherever a group is suppressed, so that no
 * person's value can be read from the reply. Every call writes an audit entry that names the reader, the
 * scope and the field, never a value or a count. Nothing of the data is logged.
 */
export const getDemographicAggregates = defineCallable(getDemographicAggregatesContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const grantReference = db.doc(COLLECTIONS.capabilityGrants.docPath(capabilityGrantId(uid, "demographics.read")));
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "demographics.read", "programme");
    if (!grantInForce(await grantReference.get(), at)) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);

    const persons = db.collection(COLLECTIONS.persons.collectionPath());
    const query =
      input.scopeType === "replication"
        ? persons.where("replicationIds", "array-contains", input.scopeId)
        : input.scopeType === "laboratory"
          ? persons.where("laboratoryIds", "array-contains", input.scopeId)
          : persons;
    const people = (await query.limit(5_000).get()).docs.filter((document) => document.get("archivedAt") === null);
    const counts: Record<string, number> = {};
    for (let start = 0; start < people.length; start += 300) {
      const chunk = people.slice(start, start + 300);
      if (chunk.length === 0) continue;
      const special = await db.getAll(
        ...chunk.map((document) => db.doc(COLLECTIONS.personDemographics.docPath(document.id))),
      );
      for (const snapshot of special) {
        const parsed = snapshot.exists ? parseStoredDocument(personDemographicsDocSchema, snapshot.data()) : null;
        const value = parsed?.success === true ? parsed.data[input.field] : undefined;
        const category = value === undefined || value === "" ? NOT_RECORDED : value.slice(0, 100);
        counts[category] = (counts[category] ?? 0) + 1;
      }
    }
    const release = releaseDemographicCounts(counts, new Set([NOT_RECORDED]));
    await db.runTransaction(async (transaction) => {
      writeAudit(
        transaction,
        {
          action: "demographics.aggregateRead",
          actor: { kind: "user", uid },
          entityType: input.scopeType,
          entityId: input.scopeId,
          changes: withheldChanges([input.field]),
          at,
        },
        db,
      );
    });
    return {
      threshold: SMALL_CELL_THRESHOLD,
      people: release.people,
      cells: release.cells.slice(0, 100),
      total: release.total,
    };
  },
});
