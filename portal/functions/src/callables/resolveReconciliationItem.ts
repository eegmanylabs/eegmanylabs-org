import {
  type AuditChange,
  type CallableInput,
  COLLECTIONS,
  type EntityRef,
  entityPath,
  entryOfDocumentPath,
  MEMBERS_SCOPE_KEY,
  membershipCounts,
  parseStoredDocument,
  type ReconciliationItemDoc,
  reconciliationItemDocSchema,
  replicationMembershipId,
  replicationScopeKey,
  resolveReconciliationItemContract,
  rolesOfMembership,
  statusDefinitionId,
  studyStatusDecision,
  withUnit,
} from "@eegml/shared";
import {
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
  Timestamp,
} from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  requireProgrammeAdministrator,
  touchedFields,
  writeAudit,
} from "../framework";
import { type AccountOfPerson, readAccountOfPerson, storedIds, writeAccountOfPerson } from "../people/confirmation";
import { planPersonMerge } from "../people/merge";

type Action = CallableInput<typeof resolveReconciliationItemContract>["action"];

/** The kinds of item each decision applies to. `dismiss` applies to every kind. */
const KINDS_OF: Readonly<Record<Exclude<Action, "dismiss">, ReconciliationItemDoc["kind"]>> = {
  decideLeads: "conflictingLead",
  chooseValue: "valueConflict",
  keepCurrent: "valueConflict",
  distinctPersons: "duplicatePerson",
  mergePersons: "duplicatePerson",
  applyProgrammeDecision: "statusQuestion",
};

const NO_DECISION_MESSAGE =
  "The programme has decided no status for the replication of this item. Decide it by changing the status, then dismiss the item.";
const STATUS_MOVED_MESSAGE =
  "The status of this replication was changed in the portal after the programme decided it. Look at it again and dismiss the item.";

const DECIDED_MESSAGE = "This item has been decided already, and a decided item is never reopened. Reload the queue.";
const OWN_RECORD_MESSAGE = "This decision concerns your own record, so another reviewer decides it.";
const LINKED_MERGE_MESSAGE =
  "The record to keep is linked to an account, so only a programme administrator merges another record into it.";

const refOf = (item: ReconciliationItemDoc, entityType: EntityRef["entityType"]): string | null =>
  item.entityRefs.find((ref) => ref.entityType === entityType)?.entityId ?? null;

/** One write of a decision, prepared after the reads and carried out after the audit entry. */
type Write = (stamp: ReturnType<typeof callerStamp>) => number;

/**
 * Decides an item of the reconciliation queue (docs/DATA_MODEL.md, section 12). Capability:
 * `reconciliation.resolve` for the programme, with the second factor wherever the access
 * document requires one.
 *
 * | Action            | Item kind         | Changes, in the transaction of the decision                         |
 * |-------------------|-------------------|---------------------------------------------------------------------|
 * | `dismiss`         | Any               | The item alone, closed as dismissed with the reviewer's note        |
 * | `decideLeads`     | `conflictingLead` | Each named lead membership is confirmed as current, former (no longer current) or wrong (archived), and `leadPersonIds` of the replication is recomputed from the confirmed current leads |
 * | `chooseValue`     | `valueConflict`   | The record takes the candidate's value as the source wrote it, if its schema accepts it, and `fieldSources` names the candidate's source record |
 * | `keepCurrent`     | `valueConflict`   | The item alone: the record keeps its value                           |
 * | `distinctPersons` | `duplicatePerson` | The item alone: the records are different people                     |
 * | `mergePersons`    | `duplicatePerson` | Everything that refers to the merged record moves to the kept one (`people/merge.ts`) |
 * | `applyProgrammeDecision` | `statusQuestion` | The replication takes the status that the programme decided (`STUDY_STATUS_DECISIONS`), with an entry of its status history whose source is `programmeDecision` and which names the decision, unless it holds that status already. Programme administrators alone apply it |
 *
 * The decision is stored on the item as its resolution, which later imports apply again. A
 * decided item never reopens: a second decision is refused, and so is a decision that does not
 * fit the kind of the item.
 *
 * Nobody decides about their own record: an item that names the caller's person, a lead
 * membership of the caller's person and a merge into or out of a record that the caller has
 * claimed are refused. A merge into a record that an account has claimed gives that account
 * whatever the merged record held, so it is left to programme administrators, and the entries
 * it copies await confirmation again (`people/merge.ts`). A decision about leads confirms each
 * membership the way `confirmReplicationMembership` does: the replication is put on the person
 * or taken off, and the account of the person, if any, gets the role it implies, which awaits
 * approval, and its access document, in the same transaction.
 */
export const resolveReconciliationItem = defineCallable(resolveReconciliationItemContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const itemReference = db.doc(COLLECTIONS.reconciliationItems.docPath(input.fingerprint));

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      requireCapability(context, access, "reconciliation.resolve", "programme");
      const snapshot = await transaction.get(itemReference);
      if (!snapshot.exists) throw new AppError("not-found", "This item of the review queue does not exist.");
      const parsed = parseStoredDocument(reconciliationItemDocSchema, snapshot.data());
      if (!parsed.success) throw parsed.error;
      const item = parsed.data;
      if (item.status !== "open") throw new AppError("failed-precondition", DECIDED_MESSAGE);
      if (input.action !== "dismiss" && KINDS_OF[input.action] !== item.kind) {
        throw new AppError("invalid-argument", "This decision does not apply to an item of this kind.");
      }
      // The persons of the item, and those a decision names, are read to tell whether one of
      // them is the caller.
      const ownPersonId = access.personId;
      const isCaller = (personId: string, record: DocumentSnapshot | undefined) =>
        personId === ownPersonId || (record?.exists === true && record.get("userId") === uid);
      const itemPersons = [
        ...new Set([
          ...item.entityRefs.filter((ref) => ref.entityType === "person").map((ref) => ref.entityId),
          ...(input.action === "decideLeads" ? input.memberships.map((membership) => membership.personId) : []),
        ]),
      ];
      const personRecords =
        itemPersons.length === 0
          ? []
          : await transaction.getAll(...itemPersons.map((personId) => db.doc(COLLECTIONS.persons.docPath(personId))));
      if (itemPersons.some((personId, index) => isCaller(personId, personRecords[index]))) {
        throw new AppError("permission-denied", OWN_RECORD_MESSAGE);
      }
      const personRecordOf = (personId: string) => personRecords[itemPersons.indexOf(personId)];

      let write: Write = () => 0;
      let mergeChanges: AuditChange[] = [];
      let subject: EntityRef = item.entityRefs[0] ?? { entityType: "importBatch", entityId: item.batchId };
      const resolution: Record<string, unknown> = { action: input.action };
      if (input.note !== undefined) resolution.note = input.note;

      if (input.action === "decideLeads") {
        const replicationId = refOf(item, "replication");
        if (replicationId === null) {
          throw new AppError("failed-precondition", "This item names no replication, so its leads cannot be decided.");
        }
        subject = { entityType: "replication", entityId: replicationId };
        const named = input.memberships.map((membership) => ({
          ...membership,
          reference: db.doc(
            COLLECTIONS.replicationMemberships.docPath(
              replicationId,
              replicationMembershipId(membership.personId, membership.role),
            ),
          ),
        }));
        if (new Set(named.map((membership) => membership.reference.path)).size !== named.length) {
          throw new AppError("invalid-argument", "Decide each membership once.");
        }
        const [stored, all] = await Promise.all([
          transaction.getAll(...named.map((membership) => membership.reference)),
          transaction.get(db.collection(COLLECTIONS.replicationMemberships.collectionPath(replicationId))),
        ]);
        if (stored.some((membership) => !membership.exists)) {
          throw new AppError("invalid-argument", "A membership of this decision does not exist. Reload the queue.");
        }
        if (named.some((membership) => membership.role !== "lead" && membership.role !== "coLead")) {
          throw new AppError("invalid-argument", "Only lead and co-lead memberships are decided here.");
        }
        const replicationReference = db.doc(COLLECTIONS.replications.docPath(replicationId));
        const replication = await transaction.get(replicationReference);
        if (!replication.exists) throw new AppError("not-found", "The replication of this item does not exist.");
        const decided = new Map(named.map((membership) => [membership.reference.path, membership.outcome]));
        /** A membership as the decision leaves it. */
        const afterDecision = (membership: QueryDocumentSnapshot): DocumentData => {
          const outcome = decided.get(membership.ref.path);
          if (outcome === undefined) return membership.data();
          return {
            ...membership.data(),
            reviewStatus: "confirmed",
            isCurrent: outcome === "current",
            ...(outcome === "wrong" ? { archivedAt: "archived" } : {}),
          };
        };
        // For each person the decision names: the replication on the person, and what the
        // person's account gains, as confirmReplicationMembership writes them.
        const people: { reference: DocumentReference; replicationIds: string[]; account: AccountOfPerson | null }[] =
          [];
        for (const personId of new Set(named.map((membership) => membership.personId))) {
          const person = personRecordOf(personId);
          if (person === undefined || !person.exists) {
            throw new AppError("invalid-argument", "A person of this decision does not exist. Reload the queue.");
          }
          const own = all.docs.filter((membership) => membership.get("personId") === personId).map(afterDecision);
          const counts = own.some((membership) => membershipCounts(membership));
          const implied = own.flatMap((membership) =>
            rolesOfMembership(replicationId, { ...membership, archivedAt: membership.archivedAt ?? null }),
          );
          people.push({
            reference: person.ref,
            replicationIds: withUnit(storedIds(person, "replicationIds"), replicationId, counts),
            account: await readAccountOfPerson(db, transaction, person, implied, at),
          });
        }
        // The confirmed current leads once the decision holds: a decided membership counts when it
        // is decided as current, and every other one as the stored record says.
        const leads = all.docs
          .filter((membership) => {
            const role: unknown = membership.get("role");
            if (role !== "lead" && role !== "coLead") return false;
            const outcome = decided.get(membership.ref.path);
            return outcome === undefined ? membershipCounts(membership.data()) : outcome === "current";
          })
          .map((membership) => String(membership.get("personId")));
        resolution.memberships = input.memberships;
        write = (stamp) => {
          const now = Timestamp.fromDate(stamp.at);
          for (const membership of named) {
            transaction.update(membership.reference, {
              reviewStatus: "confirmed",
              isCurrent: membership.outcome === "current",
              ...(membership.outcome === "wrong" ? { archivedAt: now } : {}),
              ...touchedFields(stamp),
            });
          }
          transaction.update(replicationReference, {
            leadPersonIds: [...new Set(leads)].sort(),
            ...touchedFields(stamp),
          });
          for (const person of people) {
            transaction.update(person.reference, { replicationIds: person.replicationIds, ...touchedFields(stamp) });
            if (person.account !== null) {
              writeAccountOfPerson(
                db,
                transaction,
                person.account,
                {
                  confirmedReplicationIds: person.replicationIds,
                  notification: {
                    entityType: "replication",
                    entityId: replicationId,
                    kind: "replicationMembershipConfirmed",
                  },
                },
                stamp,
              );
            }
          }
          return named.length + 1 + people.length;
        };
      } else if (input.action === "chooseValue") {
        const candidate = item.candidates.find((entry) => entry.key === input.candidateKey);
        const target = item.entityRefs[0];
        if (candidate === undefined)
          throw new AppError("invalid-argument", "This value is not a candidate of the item.");
        if (target === undefined || item.field === undefined || candidate.valueSource === undefined) {
          throw new AppError(
            "failed-precondition",
            "This item does not say which record and field to change. Correct the record and dismiss the item.",
          );
        }
        const path = entityPath(target.entityType, target.entityId);
        const matched = entryOfDocumentPath(path);
        const record = await transaction.get(db.doc(path));
        if (matched === null || !record.exists)
          throw new AppError("not-found", "The record of this item does not exist.");
        const field = item.field;
        const next: DocumentData = {
          ...record.data(),
          [field]: candidate.valueSource,
          ...(candidate.sourceRecordId === undefined
            ? {}
            : { fieldSources: { ...(record.get("fieldSources") ?? {}), [field]: candidate.sourceRecordId } }),
        };
        if (!parseStoredDocument(matched.entry.schema, next).success) {
          throw new AppError(
            "failed-precondition",
            "This value cannot be stored in the field as the source wrote it. Keep the current value, or correct the record and dismiss the item.",
          );
        }
        subject = target;
        resolution.candidateKey = candidate.key;
        const reference: DocumentReference = record.ref;
        const before: unknown = record.get(field);
        write = (stamp) => {
          transaction.update(reference, {
            [field]: candidate.valueSource,
            ...(candidate.sourceRecordId === undefined ? {} : { [`fieldSources.${field}`]: candidate.sourceRecordId }),
            ...touchedFields(stamp),
          });
          return 1;
        };
        resolution.before = before === undefined ? null : before;
      } else if (input.action === "mergePersons") {
        const persons = item.entityRefs.filter((ref) => ref.entityType === "person").map((ref) => ref.entityId);
        if (!persons.includes(input.keepPersonId) || !persons.includes(input.mergePersonId)) {
          throw new AppError("invalid-argument", "Both records must be among the records of this item.");
        }
        if (personRecordOf(input.keepPersonId)?.get("userId") != null) {
          requireProgrammeAdministrator(access, LINKED_MERGE_MESSAGE);
        }
        const merge = await planPersonMerge(db, transaction, input.keepPersonId, input.mergePersonId);
        subject = { entityType: "person", entityId: input.keepPersonId };
        resolution.keepPersonId = input.keepPersonId;
        resolution.mergePersonId = input.mergePersonId;
        mergeChanges = merge.auditChanges();
        write = (stamp) => merge.apply(stamp);
      }

      if (input.action === "applyProgrammeDecision") {
        // A decision of the programme answers a question about the status of a study. The candidates of the item,
        // the statuses that the sources stated, stay on it beside the decision as its provenance.
        requireProgrammeAdministrator(access);
        const replicationId = refOf(item, "replication");
        const decided = replicationId === null || item.field !== "status" ? null : studyStatusDecision(replicationId);
        if (replicationId === null || decided === null) throw new AppError("failed-precondition", NO_DECISION_MESSAGE);
        subject = { entityType: "replication", entityId: replicationId };
        const replicationReference = db.doc(COLLECTIONS.replications.docPath(replicationId));
        const [replication, definition] = await transaction.getAll(
          replicationReference,
          db.doc(COLLECTIONS.statusDefinitions.docPath(statusDefinitionId("replication", decided.statusKey))),
        );
        if (replication?.exists !== true)
          throw new AppError("not-found", "The replication of this item does not exist.");
        if (definition?.exists !== true) {
          throw new AppError(
            "failed-precondition",
            "The status that the programme decided is not set up. Install the lookups.",
          );
        }
        const current = (replication.get("statusKey") as string | null | undefined) ?? null;
        // A status that someone set in the portal since is a later decision, which this one does not overturn.
        if (current !== null && current !== decided.statusKey) {
          throw new AppError("failed-precondition", STATUS_MOVED_MESSAGE);
        }
        resolution.decision = decided.decision;
        resolution.decidedStatus = decided.decided;
        resolution.statusKey = decided.statusKey;
        if (current === null) {
          const historyReference = db.collection(COLLECTIONS.statusHistory.collectionPath()).doc();
          write = (stamp) => {
            const now = Timestamp.fromDate(stamp.at);
            transaction.create(
              historyReference,
              COLLECTIONS.statusHistory.schema.parse({
                schemaVersion: COLLECTIONS.statusHistory.schemaVersion,
                createdAt: now,
                createdBy: stamp.actor,
                writeContext: stamp.writeContext,
                entityType: "replication",
                entityId: replicationId,
                fromStatusKey: null,
                toStatusKey: decided.statusKey,
                // The programme lead decided on the day of the answers, which is when the status holds from.
                effectiveAt: Timestamp.fromDate(new Date(`${decided.decision.decidedOn}T00:00:00Z`)),
                recordedAt: now,
                changedBy: stamp.actor,
                reason: `The programme lead decided that the study is ${decided.decided} (${decided.decision.reference}).`,
                source: "programmeDecision",
                decision: decided.decision,
                replicationId,
                laboratoryId: null,
                scopeKeys: [replicationScopeKey(replicationId), MEMBERS_SCOPE_KEY],
              }),
            );
            transaction.update(replicationReference, {
              statusKey: decided.statusKey,
              statusHistoryId: historyReference.id,
              ...touchedFields(stamp),
            });
            return 2;
          };
        }
      }

      const status = input.action === "dismiss" ? ("dismissed" as const) : ("resolved" as const);
      const changes: AuditChange[] = [
        { field: "reconciliationItem", after: input.fingerprint },
        { field: "kind", after: item.kind },
        { field: "status", before: "open", after: status },
        { field: "action", after: input.action },
        ...(input.action === "applyProgrammeDecision" && typeof resolution.statusKey === "string"
          ? [{ field: "decidedStatusKey", after: resolution.statusKey }]
          : []),
      ];
      const auditEventId = writeAudit(
        transaction,
        {
          action: status === "dismissed" ? "reconciliation.dismissed" : "reconciliation.resolved",
          actor: { kind: "user", uid },
          entityType: subject.entityType,
          entityId: subject.entityId,
          changes,
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      if (input.action === "mergePersons") {
        writeAudit(
          transaction,
          {
            action: "person.merged",
            actor: { kind: "user", uid },
            entityType: "person",
            entityId: input.keepPersonId,
            changes: [{ field: "mergedPersonId", after: input.mergePersonId }, ...mergeChanges],
            at,
            context: { causationId: auditEventId },
          },
          db,
        );
      }
      const changedDocuments = write(stamp);
      transaction.update(itemReference, {
        status,
        resolution,
        resolvedBy: uid,
        resolvedAt: Timestamp.fromDate(at),
        ...touchedFields(stamp),
      });
      return { fingerprint: input.fingerprint, status, changedDocuments };
    });
  },
});
