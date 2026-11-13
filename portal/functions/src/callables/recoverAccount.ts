import {
  COLLECTIONS,
  type PersonContactDoc,
  parseStoredDocument,
  personContactDocSchema,
  personEmailIndexDocSchema,
  personEmailIndexId,
  recoverAccountContract,
} from "@eegml/shared";
import { type DocumentReference, Timestamp } from "firebase-admin/firestore";
import { commitAccess, draftAccess, withAssignment } from "../access/maintain";
import { readLink, writeLink } from "../claims/link";
import { createdAssignmentIdsOf, readClaim, writeClaim } from "../claims/records";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  identityHashKey,
  readAccessDocument,
  requireCapability,
  requireProgrammeAdministrator,
  SECOND_FACTOR_REQUIRED_MESSAGE,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";
import { writeNotification } from "../notifications/notify";
import { applyAccountStatus } from "../people/account-status";
import { readAssignments, revokedAssignment } from "../roles/assignments";

const NOT_PENDING_MESSAGE =
  "This account has no request waiting for review. Ask the member to sign in with the address they hold now and send a request for access.";
const NOT_LINKED_MESSAGE =
  "This person is not linked to an account, so nothing needs recovering. Decide the request in the review queue instead.";
const OWN_ACCOUNT_MESSAGE = "You cannot recover an account of your own. Ask another programme administrator.";
const REASON = "Account recovered: the member lost access to the address of this account.";

/**
 * Moves a member's profile from an account whose address they have lost to an account they hold
 * now (docs/SECURITY.md, section 4). Capability: `claims.review`, held by a programme
 * administrator who has presented the second factor in this session, whatever the access
 * document waives. There is no self-service route: the new account must have sent a request for
 * access that waits for review, the caller must have verified the member's identity outside the
 * portal and says how, and nobody recovers an account of their own.
 *
 * One transaction, with an audit entry that names both accounts and the statement of
 * verification:
 *
 * | Account or record | What happens                                                                      |
 * |-------------------|-----------------------------------------------------------------------------------|
 * | The old account   | Unlinked and suspended; the role assignments its claim created are revoked, each audited; its claim ends as `rejected` |
 * | The person        | Linked to the new account, which receives the roles the records imply, as any link does |
 * | Its addresses     | The lost ones become `historical` and stop being usable by a claim; the new account's verified address becomes the primary one |
 * | The new account   | Its request is approved, and it is told so                                        |
 *
 * After the transaction the old Authentication account is disabled and its refresh tokens are
 * revoked, as a suspension does, so whoever holds the lost address cannot sign in with it.
 */
export const recoverAccount = defineCallable(recoverAccountContract, {
  handler: async (input, context) => {
    const { db } = context;
    const actor = context.uid;
    const at = context.clock.now();

    const outcome = await db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, actor, transaction);
      requireCapability(context, access, "claims.review", "programme");
      requireProgrammeAdministrator(access);
      if (!context.secondFactorVerified) {
        throw new AppError("failed-precondition", SECOND_FACTOR_REQUIRED_MESSAGE, "secondFactorRequired");
      }
      if (input.uid === actor) throw new AppError("permission-denied", OWN_ACCOUNT_MESSAGE);

      const records = await readClaim(db, transaction, input.uid);
      if (records.claim === null || records.review === null || records.claim.status !== "pendingReview") {
        throw new AppError("failed-precondition", NOT_PENDING_MESSAGE);
      }
      const link = await readLink(db, transaction, input.uid, input.personId, at);
      if (link.person === null) throw new AppError("not-found", "This person does not exist.");
      if (link.person.archivedAt != null) {
        throw new AppError("failed-precondition", "This person is archived. Restore the record first.");
      }
      const previousUid = link.person.userId;
      if (typeof previousUid !== "string" || previousUid === "") {
        throw new AppError("failed-precondition", NOT_LINKED_MESSAGE);
      }
      if (previousUid === input.uid) throw new AppError("failed-precondition", "This account is linked already.");
      if (previousUid === actor) throw new AppError("permission-denied", OWN_ACCOUNT_MESSAGE);
      const emailLower = link.user?.emailLower;
      if (link.user === null || link.access === null || typeof emailLower !== "string") {
        throw new AppError("failed-precondition", "This account has not started the portal yet.");
      }
      if (typeof link.user.personId === "string" && link.user.personId !== "") {
        throw new AppError("failed-precondition", "This account is linked to another person already.");
      }

      const previous = await readClaim(db, transaction, previousUid);
      const [previousAccess, previousAssignments] = await Promise.all([
        draftAccess(db, transaction, previousUid, at),
        readAssignments(db, transaction, createdAssignmentIdsOf(previous.review)),
      ]);
      const contactReference = db.doc(COLLECTIONS.personContact.docPath(input.personId));
      const contactSnapshot = await transaction.get(contactReference);
      const parsedContact = contactSnapshot.exists
        ? parseStoredDocument(personContactDocSchema, contactSnapshot.data())
        : null;
      if (parsedContact !== null && !parsedContact.success) throw parsedContact.error;
      const contact: PersonContactDoc | null = parsedContact?.data ?? null;
      const lost = (contact?.emails ?? []).filter((entry) => entry.email !== emailLower && entry.kind !== "historical");
      const key = identityHashKey();
      const indexOf = (email: string): DocumentReference =>
        db.doc(COLLECTIONS.personEmailIndex.docPath(personEmailIndexId(email, key)));
      const indexReferences = [emailLower, ...lost.map((entry) => entry.email)].map(indexOf);
      const indexSnapshots = await transaction.getAll(...indexReferences);

      const auditEventId = writeAudit(
        transaction,
        {
          action: "account.recovered",
          actor: { kind: "user", uid: actor },
          entityType: "person",
          entityId: input.personId,
          changes: [
            { field: "userId", before: previousUid, after: input.uid },
            { field: "verification", after: input.verification },
            ...withheldChanges(["emails"]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(actor, at, auditEventId);

      // The old account: unlinked, suspended, and stripped of the roles its claim gave it.
      transaction.update(db.doc(COLLECTIONS.users.docPath(previousUid)), {
        personId: null,
        status: "suspended",
        ...touchedFields(stamp),
      });
      let revoked = 0;
      if (previousAccess !== null) {
        let inputs = previousAccess.inputs;
        for (const stored of previousAssignments.values()) {
          const next = stored.data === null ? null : revokedAssignment(stored.data, REASON, stamp);
          if (next === null) continue;
          transaction.set(stored.reference, next);
          inputs = withAssignment(inputs, next);
          revoked += 1;
          writeAudit(
            transaction,
            {
              action: "role.revoked",
              actor: { kind: "user", uid: actor },
              entityType: "user",
              entityId: previousUid,
              changes: [
                { field: "role", before: next.role },
                { field: "scopeType", before: next.scopeType },
                { field: "scopeId", before: next.scopeId },
                { field: "status", after: "revoked" },
              ],
              at,
              context: { causationId: auditEventId },
            },
            db,
          );
        }
        previousAccess.inputs = {
          ...inputs,
          personId: null,
          confirmedReplicationIds: [],
          user: { ...inputs.user, status: "suspended" },
        };
        commitAccess(db, transaction, previousAccess, stamp);
      }
      if (previous.claim !== null && previous.review !== null) {
        writeClaim(
          transaction,
          previous,
          "reversal",
          {
            status: "rejected",
            personId: null,
            candidatePersonIds: previous.review.candidatePersonIds,
            matchBasis: previous.review.matchBasis,
            evidence: { ...previous.review.evidence, createdRoleAssignmentIds: [], recoveredTo: input.uid },
            reviewedBy: actor,
            decisionNote: REASON,
          },
          stamp,
        );
      }

      // The addresses: the lost ones are kept as history and can no longer be claimed with; the
      // address the member holds now is verified and primary.
      const now = Timestamp.fromDate(at);
      const emails = [
        { email: emailLower, kind: "primary" as const, verifiedAt: now, claimEligible: true },
        ...(contact?.emails ?? [])
          .filter((entry) => entry.email !== emailLower)
          .map((entry) => ({ ...entry, kind: "historical" as const, claimEligible: false })),
      ];
      transaction.set(
        contactReference,
        personContactDocSchema.parse({
          ...(contact ?? createdFields("personContact", stamp)),
          ...touchedFields(stamp),
          emails,
        }),
      );
      indexReferences.forEach((reference, position) => {
        const stored = indexSnapshots[position];
        const parsed = stored?.exists === true ? personEmailIndexDocSchema.safeParse(stored.data()) : null;
        const personIds = parsed?.success === true ? parsed.data.personIds : [];
        const eligible = parsed?.success === true ? parsed.data.claimEligiblePersonIds : [];
        const isNew = position === 0;
        transaction.set(
          reference,
          personEmailIndexDocSchema.parse({
            ...createdFields("personEmailIndex", stamp),
            ...(parsed?.success === true ? { createdAt: parsed.data.createdAt, createdBy: parsed.data.createdBy } : {}),
            personIds: [...new Set([...personIds, input.personId])].sort(),
            claimEligiblePersonIds: isNew
              ? [...new Set([...eligible, input.personId])].sort()
              : eligible.filter((id) => id !== input.personId),
          }),
        );
      });

      // The new account: linked, with the roles the records imply, and its request approved.
      const linked = writeLink(db, transaction, link, stamp);
      writeClaim(
        transaction,
        records,
        "decision",
        {
          status: "approved",
          personId: input.personId,
          candidatePersonIds: [...new Set([...records.review.candidatePersonIds, input.personId])],
          matchBasis: records.review.matchBasis,
          evidence: {
            ...records.review.evidence,
            automatic: false,
            candidate: false,
            recoveredFrom: previousUid,
            createdRoleAssignmentIds: linked.createdAssignmentIds,
          },
          reviewedBy: actor,
          decisionNote: "Recovered after the identity of the member was verified.",
        },
        stamp,
      );
      writeNotification(
        db,
        transaction,
        {
          uid: input.uid,
          type: "claimDecision",
          entityType: "person",
          entityId: input.personId,
          eventId: auditEventId,
          payload: { kind: "accountClaimApproved" },
        },
        stamp,
      );
      return { personId: input.personId, previousUid, revokedRoleAssignments: revoked };
    });

    if ((await applyAccountStatus(outcome.previousUid, "suspended")) === "noAccount") {
      context.logger.warn("the recovered account has no Authentication record", { uid: outcome.previousUid });
    }
    return outcome;
  },
});
