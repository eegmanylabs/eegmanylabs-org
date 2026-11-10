import {
  accountClaimDocSchema,
  accountClaimReviewDocSchema,
  COLLECTIONS,
  type ListAccountClaimsOutput,
  listAccountClaimsContract,
  parseStoredDocument,
} from "@eegml/shared";
import { defineCallable, readAccessDocument, requireCapability } from "../framework";

/** The most candidates of one claim that the list describes. */
const CANDIDATES_MAX = 50;

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/**
 * Lists account claims for reviewers, oldest first. Capability: `claims.review`, with the
 * second factor wherever the caller's access document requires one.
 *
 * No security rule lets a reviewer list claims or read the profile of another account, so this
 * function is the review queue. For each claim it gives the verified address of the claimant,
 * which a reviewer needs to decide, the candidates with their names, and what the claimant
 * wrote. It changes nothing.
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
    const persons =
      candidateIds.length === 0
        ? []
        : await db.getAll(...candidateIds.map((id) => db.doc(COLLECTIONS.persons.docPath(id))));
    const personOf = new Map(candidateIds.map((id, index) => [id, persons[index]] as const));

    return {
      claims: claims.map((claim, index) => {
        const review = reviewOf[index] ?? null;
        const evidence = review?.evidence ?? {};
        const request =
          review?.matchBasis === "manual"
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
          emailLower: text(users[index]?.get("emailLower")) ?? "",
          displayName: text(users[index]?.get("displayName")),
          personId: claim.personId,
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
              },
            ];
          }),
          request,
        };
      }),
    };
  },
});
