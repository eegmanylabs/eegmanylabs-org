// The two documents of an account claim (docs/DATA_MODEL.md, section 3): `accountClaims/{uid}`,
// which tells the account the status of its own claim and nothing else, and
// `accountClaims/{uid}/private/review`, which holds the candidates, the evidence and the
// decision for reviewers and keeps the earlier attempts of the same account.
import {
  type AccountClaimDoc,
  type AccountClaimReviewDoc,
  accountClaimDocSchema,
  accountClaimReviewDocSchema,
  type ClaimStatus,
  COLLECTIONS,
  LIMITS,
  parseStoredDocument,
} from "@eegml/shared";
import { type DocumentReference, type Firestore, Timestamp, type Transaction } from "firebase-admin/firestore";
import { createdFields, type WriteStamp } from "../framework/documents";

type MatchBasis = AccountClaimReviewDoc["matchBasis"];

export interface ClaimRecords {
  readonly uid: string;
  readonly claimReference: DocumentReference;
  readonly reviewReference: DocumentReference;
  readonly claim: AccountClaimDoc | null;
  readonly review: AccountClaimReviewDoc | null;
}

/** Reads the claim of an account and its review document, inside the transaction. */
export async function readClaim(db: Firestore, transaction: Transaction, uid: string): Promise<ClaimRecords> {
  const claimReference = db.doc(COLLECTIONS.accountClaims.docPath(uid));
  const reviewReference = db.doc(COLLECTIONS.accountClaimReview.docPath(uid));
  const [claimSnapshot, reviewSnapshot] = await transaction.getAll(claimReference, reviewReference);
  const read = <T>(schema: Parameters<typeof parseStoredDocument>[0], data: unknown): T => {
    const parsed = parseStoredDocument(schema, data);
    if (!parsed.success) throw parsed.error;
    return parsed.data as T;
  };
  return {
    uid,
    claimReference,
    reviewReference,
    claim: claimSnapshot?.exists ? read<AccountClaimDoc>(accountClaimDocSchema, claimSnapshot.data()) : null,
    review: reviewSnapshot?.exists
      ? read<AccountClaimReviewDoc>(accountClaimReviewDocSchema, reviewSnapshot.data())
      : null,
  };
}

/** The earlier attempt that the stored documents describe, for `history`. */
function earlierAttempt(records: ClaimRecords): AccountClaimReviewDoc["history"] {
  const { claim, review } = records;
  if (claim === null || review === null) return [];
  return [
    {
      status: claim.status,
      matchBasis: review.matchBasis,
      reviewedBy: review.reviewedBy,
      reviewedAt: review.reviewedAt,
      ...(review.decisionNote === undefined ? {} : { decisionNote: review.decisionNote }),
    },
  ];
}

export interface ClaimState {
  readonly status: ClaimStatus;
  /** The person the account is linked to. Set on approval only. */
  readonly personId: string | null;
  readonly candidatePersonIds: readonly string[];
  readonly matchBasis: MatchBasis;
  readonly evidence: Readonly<Record<string, unknown>>;
  /** The reviewer who decided, or null for an attempt that nobody has decided. */
  readonly reviewedBy: string | null;
  readonly decisionNote?: string | undefined;
}

/**
 * Writes both documents of a claim.
 *
 * | Kind       | Meaning                                                                         |
 * |------------|---------------------------------------------------------------------------------|
 * | `attempt`  | A new attempt of the account. What was stored before moves to `history`         |
 * | `decision` | A decision about the stored attempt, which keeps its time of submission         |
 * | `reversal` | The stored, approved attempt moves to `history`, and the claim takes the new state |
 */
export function writeClaim(
  transaction: Transaction,
  records: ClaimRecords,
  kind: "attempt" | "decision" | "reversal",
  state: ClaimState,
  stamp: WriteStamp,
): void {
  const now = Timestamp.fromDate(stamp.at);
  const { claim, review } = records;
  const standard = (
    stored: { createdAt: unknown; createdBy: unknown } | null,
    key: "accountClaims" | "accountClaimReview",
  ) =>
    stored === null
      ? createdFields(key, stamp)
      : { ...createdFields(key, stamp), createdAt: stored.createdAt, createdBy: stored.createdBy };
  transaction.set(
    records.claimReference,
    accountClaimDocSchema.parse({
      ...standard(claim, "accountClaims"),
      uid: records.uid,
      status: state.status,
      personId: state.personId,
      submittedAt: kind === "attempt" || claim === null ? now : claim.submittedAt,
    }),
  );
  const history = [...(review?.history ?? []), ...(kind === "decision" ? [] : earlierAttempt(records))];
  transaction.set(
    records.reviewReference,
    accountClaimReviewDocSchema.parse({
      ...standard(review, "accountClaimReview"),
      uid: records.uid,
      candidatePersonIds: [...new Set(state.candidatePersonIds)].sort().slice(0, LIMITS.list),
      matchBasis: state.matchBasis,
      evidence: state.evidence,
      reviewedBy: state.reviewedBy,
      reviewedAt: state.reviewedBy === null ? null : now,
      ...(state.decisionNote === undefined ? {} : { decisionNote: state.decisionNote }),
      history: history.slice(-LIMITS.list),
    }),
  );
}

/** The role assignments that the stored link created, as its review document records them. */
export function createdAssignmentIdsOf(review: AccountClaimReviewDoc | null): string[] {
  const ids = review?.evidence.createdRoleAssignmentIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
}
