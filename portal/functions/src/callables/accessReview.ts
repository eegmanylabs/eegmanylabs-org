import {
  accessReviewAttestationDocSchema,
  attestAccessReviewContract,
  COLLECTIONS,
  getAccessReviewContract,
  PROGRAMME_KEY,
  parseStoredDocument,
  reviewPeriodOf,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  type AuthenticatedContext,
  authentication,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  requireProgrammeAdministrator,
  writeAudit,
} from "../framework";
import { accessListing } from "../governance/access-review";

/** The access review is for programme administrators who hold `roles.manage`, with the second factor. */
async function requireReviewer(context: AuthenticatedContext): Promise<void> {
  const access = await readAccessDocument(context.db, context.uid);
  requireCapability(context, access, "roles.manage", "programme");
  requireProgrammeAdministrator(access);
}

/**
 * The periodic access review of the current quarter (docs/SECURITY.md, section 6): who holds
 * which roles and grants, their last sign-in, the grants that end within 30 days, and the
 * attestations recorded so far for the period. It decides nothing and changes nothing.
 */
export const getAccessReview = defineCallable(getAccessReviewContract, {
  handler: async (_input, context) => {
    const { db } = context;
    await requireReviewer(context);
    const now = context.clock.now();
    const period = reviewPeriodOf(now);
    const listing = await accessListing(db, authentication(), now);
    const stored = await db
      .collection(COLLECTIONS.accessReviewAttestations.collectionPath())
      .where("period", "==", period)
      .limit(100)
      .get();
    const attestations = stored.docs.flatMap((document) => {
      const attestation = parseStoredDocument(accessReviewAttestationDocSchema, document.data());
      if (!attestation.success) return [];
      return [
        {
          reviewerUid: attestation.data.reviewerUid,
          attestedAt: attestation.data.attestedAt.toDate().toISOString(),
          matchesCurrentListing: attestation.data.listingSha256 === listing.listingSha256,
          note: attestation.data.note,
        },
      ];
    });
    return { period, listingSha256: listing.listingSha256, accounts: listing.accounts, attestations };
  },
});

/**
 * Records that the caller has reviewed the listing of the current period. The hash the caller
 * names must be that of the listing as it stands, so an attestation never covers rights that
 * changed after the reviewer looked. A second attestation by the same reviewer replaces the first.
 */
export const attestAccessReview = defineCallable(attestAccessReviewContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    await requireReviewer(context);
    const at = context.clock.now();
    const period = reviewPeriodOf(at);
    if (input.period !== period) {
      throw new AppError("failed-precondition", "An attestation is recorded for the current quarter only.");
    }
    const listing = await accessListing(db, authentication(), at);
    if (listing.listingSha256 !== input.listingSha256) {
      throw new AppError(
        "failed-precondition",
        "The roles or grants have changed since the review was opened. Reload the review and check it again.",
      );
    }
    const batch = db.batch();
    const auditEventId = writeAudit(
      batch,
      {
        action: "accessReview.attested",
        actor: { kind: "user", uid },
        entityType: "programme",
        entityId: PROGRAMME_KEY,
        changes: [
          { field: "period", after: period },
          { field: "listingSha256", after: listing.listingSha256 },
        ],
        at,
      },
      db,
    );
    const grantCount = listing.accounts.reduce((total, account) => total + account.grants.length, 0);
    const expiringCount = listing.accounts.reduce(
      (total, account) => total + [...account.roles, ...account.grants].filter((right) => right.expiringSoon).length,
      0,
    );
    batch.set(
      db.doc(COLLECTIONS.accessReviewAttestations.docPath(`${period}__${uid}`)),
      accessReviewAttestationDocSchema.parse({
        ...createdFields("accessReviewAttestations", callerStamp(uid, at, auditEventId)),
        period,
        reviewerUid: uid,
        attestedAt: Timestamp.fromDate(at),
        listingSha256: listing.listingSha256,
        accountCount: listing.accounts.length,
        grantCount,
        expiringCount,
        note: input.note,
      }),
    );
    await batch.commit();
    return { period, attestedAt: at.toISOString() };
  },
});
