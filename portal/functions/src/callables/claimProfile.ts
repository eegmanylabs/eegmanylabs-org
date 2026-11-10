import {
  type ClaimProfileOutput,
  COLLECTIONS,
  claimProfileContract,
  normaliseEmail,
  personEmailIndexId,
} from "@eegml/shared";
import type { Firestore, Transaction } from "firebase-admin/firestore";
import { type LinkReads, linkObstacle, readLink, writeLink } from "../claims/link";
import { type ClaimRecords, readClaim, writeClaim } from "../claims/records";
import {
  AppError,
  callerStamp,
  defineCallable,
  identityHashKey,
  requireVerifiedEmail,
  withheldChanges,
  writeAudit,
} from "../framework";
import { holdersOf, notifyAll } from "../notifications/notify";

/** The most candidates whose contact documents a claim reads to learn how the address is held. */
const CONTACTS_READ_MAX = 10;

type Stored = Readonly<Record<string, unknown>>;

const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((element): element is string => typeof element === "string") : [];

/** How the contact document of a person holds an address: its kind and whether a claim may rest on it. */
function heldAs(contact: Stored | null, emailLower: string): { kind: string; claimEligible: boolean } | null {
  const emails = Array.isArray(contact?.emails) ? (contact.emails as unknown[]) : [];
  for (const entry of emails) {
    if (typeof entry !== "object" || entry === null) continue;
    const { email, kind, claimEligible } = entry as { email?: unknown; kind?: unknown; claimEligible?: unknown };
    if (typeof email === "string" && normaliseEmail(email) === emailLower) {
      return { kind: typeof kind === "string" ? kind : "", claimEligible: claimEligible === true };
    }
  }
  return null;
}

async function contactsOf(db: Firestore, transaction: Transaction, personIds: readonly string[]) {
  const ids = personIds.slice(0, CONTACTS_READ_MAX);
  if (ids.length === 0) return new Map<string, Stored | null>();
  const snapshots = await transaction.getAll(...ids.map((id) => db.doc(COLLECTIONS.personContact.docPath(id))));
  return new Map(ids.map((id, index) => [id, snapshots[index]?.data() ?? null] as const));
}

/**
 * What a reviewer is told about a claim that could not be decided by the match alone. The
 * caller is told none of it.
 *
 * | Reason              | The address                                                             |
 * |---------------------|-------------------------------------------------------------------------|
 * | `severalCandidates` | Is held by more than one person, which is a data error                  |
 * | `notClaimEligible`  | Is held by one person in a way that no claim may rest on                |
 * | `addressNotOnRecord`| Is in the index, and the contact document of the person does not hold it |
 * | `personUnavailable` | Belongs to a person who is missing or archived                          |
 * | `alreadyClaimed`    | Belongs to a person whom another account has claimed                    |
 */
type ReviewReason =
  | "severalCandidates"
  | "notClaimEligible"
  | "addressNotOnRecord"
  | "personUnavailable"
  | "alreadyClaimed";

/**
 * Links the caller's account to the person whose record carries the caller's verified email
 * address (decision D-005 and docs/SECURITY.md, section 4).
 *
 * The function takes no arguments, and the contract refuses a call that carries any. The one
 * address it looks up is the verified address of the caller's own sign-in token, through an
 * index keyed by a keyed hash, so nobody can ask about anybody else. Everything it changes is
 * written in one transaction.
 *
 * | The address is held by                               | The call                                    |
 * |------------------------------------------------------|---------------------------------------------|
 * | Nobody                                               | Answers `noMatch` and changes nothing       |
 * | One person, unclaimed, in a way a claim may rest on  | Links the account and answers `linked`      |
 * | Several persons, or a person whom another account has claimed, or anything else in doubt | Opens one review record, notifies the reviewers and answers `pendingReview`, with no detail |
 *
 * A repeated call changes nothing: it answers from the stored claim. When two accounts reach
 * for one person at the same moment, the transaction of one of them commits, and the other
 * runs again, finds the person claimed and goes to review.
 */
export const claimProfile = defineCallable(claimProfileContract, {
  usesIdentityHashKey: true,
  handler: async (_input, context): Promise<ClaimProfileOutput> => {
    const { uid, db } = context;
    const emailLower = requireVerifiedEmail(context);
    const indexReference = db.doc(
      COLLECTIONS.personEmailIndex.docPath(personEmailIndexId(emailLower, identityHashKey())),
    );
    const at = context.clock.now();

    return db.runTransaction(async (transaction) => {
      const records = await readClaim(db, transaction, uid);
      const answered = answerOf(records);
      if (answered !== null) return answered;

      const index = (await transaction.get(indexReference)).data() ?? null;
      const candidates = [...new Set(texts(index?.personIds))].sort();
      if (candidates.length === 0) return { status: "noMatch" };

      const contacts = await contactsOf(db, transaction, candidates);
      const holdings = candidates.map((id) => heldAs(contacts.get(id) ?? null, emailLower));
      const matchBasis = holdings.some((held) => held?.kind === "primary") ? "primaryEmail" : "secondaryEmail";
      const [only] = candidates;
      let reason: ReviewReason | null = null;
      let link: LinkReads | null = null;
      if (candidates.length > 1 || only === undefined) reason = "severalCandidates";
      else {
        const [held] = holdings;
        if (held == null) reason = "addressNotOnRecord";
        else if (!held.claimEligible || !texts(index?.claimEligiblePersonIds).includes(only))
          reason = "notClaimEligible";
        else {
          link = await readLink(db, transaction, uid, only, at);
          const obstacle = linkObstacle(link);
          if (obstacle === "claimed") reason = "alreadyClaimed";
          else if (obstacle !== null) reason = "personUnavailable";
        }
      }
      if (link?.user == null && reason === null) {
        throw new AppError("failed-precondition", "Start the portal before you claim a profile.");
      }

      if (reason !== null || link === null || only === undefined) {
        const reviewers = await holdersOf(db, transaction, "claims.review");
        const auditEventId = writeAudit(
          transaction,
          {
            action: "claim.sentToReview",
            actor: { kind: "user", uid },
            entityType: "user",
            entityId: uid,
            changes: withheldChanges(["status", "candidatePersonIds", "matchBasis"]),
            at,
          },
          db,
        );
        const stamp = callerStamp(uid, at, auditEventId);
        writeClaim(
          transaction,
          records,
          "attempt",
          {
            status: "pendingReview",
            personId: null,
            candidatePersonIds: candidates,
            matchBasis,
            evidence: { reason: reason ?? "personUnavailable" },
            reviewedBy: null,
          },
          stamp,
        );
        notifyAll(
          db,
          transaction,
          reviewers.filter((reviewer) => reviewer !== uid),
          {
            type: "claimDecision",
            entityType: "user",
            entityId: uid,
            eventId: auditEventId,
            payload: { kind: "accountClaimAwaitsReview" },
          },
          stamp,
        );
        return { status: "pendingReview" };
      }

      const roleManagers = link.implied.some((role) => role.status === "pendingApproval")
        ? await holdersOf(db, transaction, "roles.manage")
        : [];
      const auditEventId = writeAudit(
        transaction,
        {
          action: "claim.approved",
          actor: { kind: "user", uid },
          entityType: "person",
          entityId: only,
          changes: [{ field: "userId", before: null, after: uid }],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const linked = writeLink(db, transaction, link, stamp);
      writeClaim(
        transaction,
        records,
        "attempt",
        {
          status: "approved",
          personId: only,
          candidatePersonIds: [only],
          matchBasis,
          evidence: { automatic: true, createdRoleAssignmentIds: linked.createdAssignmentIds },
          reviewedBy: null,
        },
        stamp,
      );
      if (linked.pendingRoles.length > 0) {
        notifyAll(
          db,
          transaction,
          roleManagers.filter((manager) => manager !== uid),
          {
            type: "roleDecision",
            entityType: "user",
            entityId: uid,
            eventId: auditEventId,
            payload: { kind: "rolesAwaitApproval", count: linked.pendingRoles.length },
          },
          stamp,
        );
      }
      return { status: "linked", personId: only };
    });
  },
});

/** The answer that a stored claim gives by itself, or null where the address has to be looked up. */
function answerOf(records: ClaimRecords): ClaimProfileOutput | null {
  const { claim } = records;
  if (claim === null) return null;
  if (claim.status === "approved" && claim.personId !== null) return { status: "linked", personId: claim.personId };
  if (claim.status === "pendingReview") return { status: "pendingReview" };
  if (claim.status === "rejected") return { status: "rejected" };
  return null;
}
