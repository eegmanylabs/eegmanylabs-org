import {
  type AccountClaimReviewDoc,
  accountClaimDocSchema,
  accountClaimReviewDocSchema,
  type ClaimReviewReason,
  COLLECTIONS,
  claimReviewReasonSchema,
  emailKindSchema,
  type ListAccountClaimsOutput,
  listAccountClaimsContract,
  normaliseEmail,
  parseStoredDocument,
} from "@eegml/shared";
import { defineCallable, readAccessDocument, requireCapability } from "../framework";

/** The most candidates of one claim that the list describes. */
const CANDIDATES_MAX = 50;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((element): element is string => typeof element === "string") : [];

/** Why a claim waits for a reviewer: the reason the claim function recorded, or a request for access. */
function reviewReasonOf(status: string, review: AccountClaimReviewDoc | null): ClaimReviewReason | null {
  if (status !== "pendingReview" || review === null) return null;
  if (review.matchBasis === "manual") return "requestedAccess";
  const parsed = claimReviewReasonSchema.safeParse(review.evidence.reason);
  return parsed.success ? parsed.data : "personUnavailable";
}

/** How a contact document holds an address: the kind of the entry, or null where it holds none. */
function addressKindOf(contact: Readonly<Record<string, unknown>> | undefined, emailLower: string) {
  const emails = Array.isArray(contact?.emails) ? (contact.emails as unknown[]) : [];
  for (const entry of emails) {
    if (typeof entry !== "object" || entry === null) continue;
    const { email, kind } = entry as { email?: unknown; kind?: unknown };
    if (typeof email === "string" && emailLower !== "" && normaliseEmail(email) === emailLower) {
      const parsed = emailKindSchema.safeParse(kind);
      return parsed.success ? parsed.data : null;
    }
  }
  return null;
}

/**
 * Lists account claims for reviewers, oldest first. Capability: `claims.review`, with the
 * second factor wherever the caller's access document requires one.
 *
 * No security rule lets a reviewer list claims or read the profile of another account, so this
 * function is the review queue. For each claim it gives the verified address of the claimant,
 * which a reviewer needs to decide, why the claim waits for review, the candidates with what
 * tells them apart (affiliation, institution, laboratories, replications and how each record
 * holds the address, never the address book itself), and what the claimant wrote. It changes
 * nothing.
 */
export const listAccountClaims = defineCallable(listAccountClaimsContract, {
  handler: async (input, context): Promise<ListAccountClaimsOutput> => {
    const { db } = context;
    requireCapability(context, await readAccessDocument(db, context.uid), "claims.review", "programme");

    const found = await db
      .collection(COLLECTIONS.accountClaims.collectionPath())
      .where("status", "==", input.status)
      .get();
    const claims = found.docs
      .flatMap((document) => {
        const parsed = parseStoredDocument(accountClaimDocSchema, document.data());
        return parsed.success ? [parsed.data] : [];
      })
      .sort((a, b) => a.submittedAt.toMillis() - b.submittedAt.toMillis() || (a.uid < b.uid ? -1 : 1))
      .slice(0, input.limit);
    if (claims.length === 0) return { claims: [] };

    const [reviews, users] = await Promise.all([
      db.getAll(...claims.map((claim) => db.doc(COLLECTIONS.accountClaimReview.docPath(claim.uid)))),
      db.getAll(...claims.map((claim) => db.doc(COLLECTIONS.users.docPath(claim.uid)))),
    ]);
    const reviewOf = claims.map((_claim, index) => {
      const parsed = parseStoredDocument(accountClaimReviewDocSchema, reviews[index]?.data());
      return parsed.success ? parsed.data : null;
    });
    const candidateIds = [
      ...new Set(reviewOf.flatMap((review) => review?.candidatePersonIds.slice(0, CANDIDATES_MAX) ?? [])),
    ];
    const [persons, contacts] =
      candidateIds.length === 0
        ? [[], []]
        : await Promise.all([
            db.getAll(...candidateIds.map((id) => db.doc(COLLECTIONS.persons.docPath(id)))),
            db.getAll(...candidateIds.map((id) => db.doc(COLLECTIONS.personContact.docPath(id)))),
          ]);
    const personOf = new Map(candidateIds.map((id, index) => [id, persons[index]] as const));
    const contactOf = new Map(candidateIds.map((id, index) => [id, contacts[index]?.data()] as const));

    return {
      claims: claims.map((claim, index) => {
        const review = reviewOf[index] ?? null;
        const evidence = review?.evidence ?? {};
        const emailLower = text(users[index]?.get("emailLower")) ?? "";
        const request =
          text(evidence.statedName) !== null
            ? {
                statedName: text(evidence.statedName) ?? "",
                affiliation: text(evidence.affiliation) ?? "",
                message: text(evidence.message) ?? "",
              }
            : null;
        return {
          uid: claim.uid,
          status: claim.status,
          submittedAt: claim.submittedAt.toDate().toISOString(),
          matchBasis: review?.matchBasis ?? "manual",
          emailLower,
          displayName: text(users[index]?.get("displayName")),
          personId: claim.personId,
          reviewReason: reviewReasonOf(claim.status, review),
          candidates: (review?.candidatePersonIds ?? []).slice(0, CANDIDATES_MAX).flatMap((personId) => {
            const person = personOf.get(personId);
            const displayName = text(person?.get("displayName"));
            if (person?.exists !== true || displayName === null) return [];
            const holder = text(person.get("userId"));
            return [
              {
                personId,
                displayName,
                affiliationSummary: text(person.get("affiliationSummary")),
                claimed: holder !== null && holder !== claim.uid,
                addressKind: addressKindOf(contactOf.get(personId), emailLower),
                institutionId: text(person.get("institutionId")),
                laboratoryIds: texts(person.get("laboratoryIds")),
                replicationIds: texts(person.get("replicationIds")),
              },
            ];
          }),
          request,
        };
      }),
    };
  },
});
