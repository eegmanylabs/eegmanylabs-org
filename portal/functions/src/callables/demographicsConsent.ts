import {
  COLLECTIONS,
  CONSENT_HISTORY_MAX,
  CURRENT_DEMOGRAPHICS_CONSENT,
  consentInForce,
  DEMOGRAPHICS_CONSENT_DECISION,
  type PersonDemographicsConsentDoc,
  parseStoredDocument,
  personDemographicsConsentDocSchema,
  personDemographicsDocSchema,
  saveOwnDemographicsContract,
  setDemographicsConsentContract,
} from "@eegml/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  type AuthenticatedContext,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";
import { recordGovernance } from "../governance/ledger";
import { demographicCopies, transactionReader } from "../people/demographics-values";

const NOT_LINKED_MESSAGE = "Link your account to your member profile first. Consent is recorded for your own profile.";

/** The person of the caller: a member whose account the person's directory document names. */
async function ownPersonId(context: AuthenticatedContext): Promise<string> {
  const access = await readAccessDocument(context.db, context.uid);
  if (!access.member || access.personId === null) throw new AppError("failed-precondition", NOT_LINKED_MESSAGE);
  return access.personId;
}

function storedConsent(data: unknown): PersonDemographicsConsentDoc | null {
  if (data === undefined) return null;
  const parsed = parseStoredDocument(personDemographicsConsentDocSchema, data);
  if (!parsed.success) throw new Error("A stored record of consent does not fit its schema.");
  return parsed.data;
}

/**
 * Gives or withdraws the caller's consent to the portal holding their gender and ethnicity, as
 * the programme decided on 13 November 2026 (shared/src/governance/demographics-consent.ts).
 *
 * | Act        | What it writes, in one transaction                                                     |
 * |------------|----------------------------------------------------------------------------------------|
 * | Give       | The record of consent: status, time, the version of the wording read, and the decision behind it |
 * | Withdraw   | The record, and the deletion of the values with every copy that imports kept of them    |
 *
 * Consent is given only to the current wording. Giving it again to the same wording changes
 * nothing. A withdrawal is also written to the governance ledger, so that a restore of a backup
 * taken before it deletes the values again. Every act writes an audit entry with no value.
 */
export const setDemographicsConsent = defineCallable(setDemographicsConsentContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const giving = input.status === "given";
    if (giving && input.wordingVersion !== CURRENT_DEMOGRAPHICS_CONSENT.version) {
      throw new AppError(
        "failed-precondition",
        "The wording has changed since this page was loaded. Read it again, then give your consent.",
      );
    }
    const personId = await ownPersonId(context);
    const personReference = db.doc(COLLECTIONS.persons.docPath(personId));
    const consentReference = db.doc(COLLECTIONS.personDemographicsConsent.docPath(personId));

    const result = await db.runTransaction(async (transaction) => {
      const [person, consent] = await transaction.getAll(personReference, consentReference);
      if (person?.exists !== true || person.get("userId") !== uid) {
        throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      }
      const current = storedConsent(consent?.data());
      if (giving && consentInForce(current) && current?.wordingVersion === input.wordingVersion) {
        return { changed: false, valuesDeleted: false };
      }
      if (!giving && !consentInForce(current)) {
        throw new AppError("failed-precondition", "Your consent is not in force, so there is nothing to withdraw.");
      }
      const found = giving ? null : await demographicCopies(db, transactionReader(transaction), personId);
      const auditEventId = writeAudit(
        transaction,
        {
          action: giving ? "demographics.consentGiven" : "demographics.consentWithdrawn",
          actor: { kind: "user", uid },
          entityType: "person",
          entityId: personId,
          changes: [
            { field: "status", before: current?.status ?? null, after: input.status },
            { field: "wordingVersion", before: current?.wordingVersion ?? null, after: input.wordingVersion },
            ...(found === null
              ? []
              : [
                  { field: "valuesDeleted", after: found.values !== null },
                  { field: "copiesDeleted", after: found.copies.length },
                ]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const instant = Timestamp.fromDate(at);
      transaction.set(
        consentReference,
        personDemographicsConsentDocSchema.parse({
          ...(current === null ? createdFields("personDemographicsConsent", stamp) : current),
          ...touchedFields(stamp),
          personId,
          uid,
          status: input.status,
          wordingVersion: input.wordingVersion,
          givenAt: giving ? instant : (current?.givenAt ?? null),
          withdrawnAt: giving ? null : instant,
          history: [
            ...(current?.history ?? []),
            { status: input.status, at: instant, wordingVersion: input.wordingVersion, auditEventId },
          ].slice(-CONSENT_HISTORY_MAX),
          basis: DEMOGRAPHICS_CONSENT_DECISION,
        }),
      );
      if (found !== null) {
        for (const reference of [...(found.values === null ? [] : [found.values]), ...found.copies]) {
          transaction.delete(reference);
        }
      }
      return { changed: true, valuesDeleted: found !== null && found.values !== null };
    });
    if (result.changed && !giving) {
      recordGovernance(context.logger, { kind: "demographicsWithdrawn", at: at.toISOString(), personId });
    }
    return { personId, status: input.status, at: at.toISOString(), valuesDeleted: result.valuesDeleted };
  },
});

/** The fields of a person's own words, and the terms that a source recorded. */
const OWN_FIELDS = ["genderSelfDescribed", "ethnicitySelfDescribed"] as const;
const VALUE_FIELDS = [
  "genderSource",
  "genderCategory",
  "genderSelfDescribed",
  "ethnicitySource",
  "ethnicityCategory",
  "ethnicitySelfDescribed",
] as const;

/**
 * Saves the caller's gender and ethnicity in their own words and confirms the recorded terms,
 * while their consent is in force. Nobody else writes through this function, and it never
 * changes a recorded term: a source term stays verbatim, and the person's words stand beside it.
 * A document left with no value is deleted. The audit entry names the fields, never a value.
 */
export const saveOwnDemographics = defineCallable(saveOwnDemographicsContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const personId = await ownPersonId(context);
    const personReference = db.doc(COLLECTIONS.persons.docPath(personId));
    const consentReference = db.doc(COLLECTIONS.personDemographicsConsent.docPath(personId));
    const valuesReference = db.doc(COLLECTIONS.personDemographics.docPath(personId));

    return db.runTransaction(async (transaction) => {
      const [person, consent, values] = await transaction.getAll(personReference, consentReference, valuesReference);
      if (person?.exists !== true || person.get("userId") !== uid) {
        throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      }
      if (!consentInForce(consent?.data())) {
        throw new AppError(
          "failed-precondition",
          "Give your consent first. Without it the portal holds no gender or ethnicity.",
        );
      }
      const stored = values?.exists === true ? parseStoredDocument(personDemographicsDocSchema, values.data()) : null;
      if (stored !== null && !stored.success)
        throw new Error("A stored demographics document does not fit its schema.");
      const current = stored?.data ?? null;
      const recorded =
        current !== null && (current.genderSource !== undefined || current.ethnicitySource !== undefined);
      if (input.confirmRecorded && !recorded) {
        throw new AppError("failed-precondition", "No recorded term is held for you, so there is nothing to confirm.");
      }

      const next: Record<string, string | undefined> = {};
      for (const field of VALUE_FIELDS) next[field] = current?.[field];
      for (const field of OWN_FIELDS) {
        const text = input[field];
        next[field] = text === null || text === "" ? undefined : text;
      }
      const changed = OWN_FIELDS.filter((field) => next[field] !== current?.[field]);
      if (changed.length === 0 && !input.confirmRecorded) return { personId, held: current !== null };
      const held = VALUE_FIELDS.some((field) => next[field] !== undefined);

      const auditEventId = writeAudit(
        transaction,
        {
          action: "demographics.ownSaved",
          actor: { kind: "user", uid },
          entityType: "person",
          entityId: personId,
          changes: [
            ...withheldChanges(changed),
            ...(input.confirmRecorded ? [{ field: "confirmedAt", after: at.toISOString() }] : []),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      if (!held) {
        transaction.delete(valuesReference);
        return { personId, held: false };
      }
      if (current === null) {
        transaction.create(
          valuesReference,
          personDemographicsDocSchema.parse({
            ...createdFields("personDemographics", stamp),
            ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)),
            recordedAt: Timestamp.fromDate(at),
          }),
        );
      } else {
        const update: Record<string, unknown> = { ...touchedFields(stamp) };
        for (const field of changed) update[field] = next[field] ?? FieldValue.delete();
        if (input.confirmRecorded) update.confirmedAt = Timestamp.fromDate(at);
        transaction.update(valuesReference, update);
      }
      return { personId, held: true };
    });
  },
});
