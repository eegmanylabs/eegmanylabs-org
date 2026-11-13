// Records of consent to holding a person's gender and ethnicity, written as `setDemographicsConsent`
// writes them, for tests that need a person whose consent is in force before an import or a
// count. The accounts and people are synthetic.
import {
  COLLECTIONS,
  CURRENT_DEMOGRAPHICS_CONSENT,
  DEMOGRAPHICS_CONSENT_DECISION,
  personDemographicsConsentDocSchema,
  systemWriteContext,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./admin";

/** Records that a person has given consent, through the account named, at the current wording. */
export async function recordConsent(personId: string, uid = `uid-consent-${personId}`.slice(0, 128)): Promise<void> {
  const now = Timestamp.now();
  await adminDb.doc(COLLECTIONS.personDemographicsConsent.docPath(personId)).set(
    personDemographicsConsentDocSchema.parse({
      schemaVersion: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: uid,
      updatedBy: uid,
      archivedAt: null,
      writeContext: systemWriteContext(),
      personId,
      uid,
      status: "given",
      wordingVersion: CURRENT_DEMOGRAPHICS_CONSENT.version,
      givenAt: now,
      withdrawnAt: null,
      history: [
        {
          status: "given",
          at: now,
          wordingVersion: CURRENT_DEMOGRAPHICS_CONSENT.version,
          auditEventId: "audit-synthetic",
        },
      ],
      basis: DEMOGRAPHICS_CONSENT_DECISION,
    }),
  );
}

/** Records consent for several people. */
export async function recordConsents(personIds: readonly string[]): Promise<void> {
  for (const personId of personIds) await recordConsent(personId);
}
