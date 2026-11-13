import {
  COLLECTIONS,
  decideErasureContract,
  type ErasureRequestDoc,
  erasureRequestDocSchema,
  type ListedErasureRequest,
  listErasureRequestsContract,
  parseStoredDocument,
  requestErasureContract,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
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
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";
import { applyErasure } from "../governance/erasure";
import { recordGovernance } from "../governance/ledger";
import { APPOINTED_BY_REQUESTER_MESSAGE, tiedByAppointment } from "../roles/appointments";

/** Erasure is for programme administrators who hold `people.manage`, with the second factor. */
async function requireAdministrator(context: AuthenticatedContext): Promise<void> {
  const access = await readAccessDocument(context.db, context.uid);
  requireCapability(context, access, "people.manage", "programme");
  requireProgrammeAdministrator(access);
}

function parsed(data: unknown): ErasureRequestDoc {
  const stored = parseStoredDocument(erasureRequestDocSchema, data);
  if (!stored.success) throw new Error("A stored erasure request does not fit its schema.");
  return stored.data;
}

async function openRequestOf(db: Firestore, personId: string): Promise<boolean> {
  const requests = await db
    .collection(COLLECTIONS.erasureRequests.collectionPath())
    .where("personId", "==", personId)
    .limit(50)
    .get();
  return requests.docs.some((request) => {
    const data = parsed(request.data());
    return data.status === "pendingApproval" || (data.status === "approved" && data.appliedAt === null);
  });
}

/**
 * Asks for the erasure of one person (docs/SECURITY.md, section 6). Nothing is erased until a
 * second programme administrator approves. A person who is linked to an account is refused: the
 * account is unlinked first, so that nobody loses access to the portal by surprise. The reason
 * is kept on the request and withheld from the audit entry.
 */
export const requestErasure = defineCallable(requestErasureContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    await requireAdministrator(context);
    const person = await db.doc(COLLECTIONS.persons.docPath(input.personId)).get();
    if (!person.exists) throw new AppError("not-found", "This person does not exist.");
    if (person.get("userId") !== null && person.get("userId") !== undefined) {
      throw new AppError(
        "failed-precondition",
        "This person is linked to an account. Unlink the account first, then ask for the erasure again.",
      );
    }
    if (await openRequestOf(db, input.personId)) {
      throw new AppError("already-exists", "An erasure of this person is already waiting for a decision.");
    }
    const reference = db.collection(COLLECTIONS.erasureRequests.collectionPath()).doc();
    const batch = db.batch();
    const auditEventId = writeAudit(
      batch,
      {
        action: "erasure.requested",
        actor: { kind: "user", uid },
        entityType: "person",
        entityId: input.personId,
        changes: [{ field: "status", after: "pendingApproval" }, ...withheldChanges(["reason"])],
        at,
      },
      db,
    );
    batch.create(
      reference,
      erasureRequestDocSchema.parse({
        ...createdFields("erasureRequests", callerStamp(uid, at, auditEventId)),
        personId: input.personId,
        reason: input.reason,
        status: "pendingApproval",
        requestedBy: uid,
        requestedAt: Timestamp.fromDate(at),
        decidedBy: null,
        decidedAt: null,
        decisionNote: null,
        appliedAt: null,
        appliedCounts: {},
      }),
    );
    await batch.commit();
    return { requestId: reference.id };
  },
});

/**
 * Approves or rejects a request, as a programme administrator other than the one who made it and
 * not tied to them by a recent appointment in either direction (roles/appointments.ts).
 * Approval records the decision with its audit entry first and then erases (governance/erasure.ts).
 * A request that was approved and not completed is completed by approving it again.
 */
export const decideErasure = defineCallable(decideErasureContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    await requireAdministrator(context);
    const reference = db.doc(COLLECTIONS.erasureRequests.docPath(input.requestId));

    const decided = await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) throw new AppError("not-found", "This erasure request does not exist.");
      const request = parsed(snapshot.data());
      if (request.requestedBy === uid) {
        throw new AppError(
          "permission-denied",
          "An erasure is decided by a programme administrator other than the one who asked for it.",
        );
      }
      if (await tiedByAppointment(db, transaction, request.requestedBy, uid, at)) {
        throw new AppError("permission-denied", APPOINTED_BY_REQUESTER_MESSAGE);
      }
      const resumable = request.status === "approved" && request.appliedAt === null && input.decision === "approve";
      if (request.status !== "pendingApproval" && !resumable) {
        throw new AppError("failed-precondition", "This request has been decided already.");
      }
      if (resumable) return request;
      const auditEventId = writeAudit(
        transaction,
        {
          action: input.decision === "approve" ? "erasure.approved" : "erasure.rejected",
          actor: { kind: "user", uid },
          entityType: "person",
          entityId: request.personId,
          changes: [
            { field: "status", before: request.status, after: input.decision === "approve" ? "approved" : "rejected" },
            ...withheldChanges(input.note === null ? [] : ["decisionNote"]),
          ],
          at,
        },
        db,
      );
      transaction.update(reference, {
        ...touchedFields(callerStamp(uid, at, auditEventId)),
        status: input.decision === "approve" ? "approved" : "rejected",
        decidedBy: uid,
        decidedAt: Timestamp.fromDate(at),
        decisionNote: input.note,
      });
      return { ...request, status: input.decision === "approve" ? ("approved" as const) : ("rejected" as const) };
    });
    if (decided.status === "rejected") return { status: "rejected" as const, appliedCounts: {} };

    const person = await db.doc(COLLECTIONS.persons.docPath(decided.personId)).get();
    if (person.get("userId") !== null && person.get("userId") !== undefined) {
      throw new AppError(
        "failed-precondition",
        "The person has been linked to an account since the request. Unlink the account, then approve again.",
      );
    }
    const stamp = callerStamp(uid, at, decided.writeContext.auditEventId);
    const appliedCounts = await applyErasure(db, authentication(), decided.personId, stamp);
    await reference.update({
      ...touchedFields(stamp),
      status: "applied",
      appliedAt: Timestamp.fromDate(context.clock.now()),
      appliedCounts,
    });
    recordGovernance(context.logger, {
      kind: "erasureApplied",
      at: at.toISOString(),
      personId: decided.personId,
      requestId: input.requestId,
    });
    return { status: "applied" as const, appliedCounts };
  },
});

/** The erasure requests, newest first, for the console of programme administrators. */
export const listErasureRequests = defineCallable(listErasureRequestsContract, {
  handler: async (_input, context) => {
    const { db } = context;
    await requireAdministrator(context);
    const snapshot = await db
      .collection(COLLECTIONS.erasureRequests.collectionPath())
      .orderBy("requestedAt", "desc")
      .limit(200)
      .get();
    const requests = snapshot.docs.map((document) => ({ id: document.id, data: parsed(document.data()) }));
    const personIds = [...new Set(requests.map((request) => request.data.personId))];
    const persons =
      personIds.length === 0 ? [] : await db.getAll(...personIds.map((id) => db.doc(COLLECTIONS.persons.docPath(id))));
    const names = new Map(persons.map((person) => [person.id, person.get("displayName")] as const));
    const iso = (value: { toDate(): Date } | null) => (value === null ? null : value.toDate().toISOString());
    return {
      requests: requests.map(({ id, data }): ListedErasureRequest => {
        const name: unknown = names.get(data.personId);
        return {
          requestId: id,
          personId: data.personId,
          personName: typeof name === "string" ? name : null,
          reason: data.reason,
          status: data.status,
          requestedBy: data.requestedBy,
          requestedAt: data.requestedAt.toDate().toISOString(),
          decidedBy: data.decidedBy,
          decidedAt: iso(data.decidedAt),
          decisionNote: data.decisionNote,
          appliedAt: iso(data.appliedAt),
          appliedCounts: data.appliedCounts,
        };
      }),
    };
  },
});
