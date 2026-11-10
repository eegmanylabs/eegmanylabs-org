import {
  COLLECTIONS,
  capabilityGrantDocSchema,
  capabilityGrantId,
  getPersonDemographicsContract,
  type PersonDemographics,
  parseStoredDocument,
  personDemographicsDocSchema,
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
        const grant = grantSnapshot?.exists
          ? parseStoredDocument(capabilityGrantDocSchema, grantSnapshot.data())
          : null;
        const inForce =
          grant?.success === true &&
          grant.data.revokedAt === null &&
          grant.data.expiresAt !== null &&
          grant.data.expiresAt.toMillis() > at.getTime();
        if (!inForce) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
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
