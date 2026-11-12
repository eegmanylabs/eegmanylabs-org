import { type AuditChange, changeStorageRefContract } from "@eegml/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  availabilityOf,
  isCurrent,
  REFERENCE_NOT_FOUND_MESSAGE,
  readDataset,
  readEndpoint,
  readRefs,
  requireActive,
  requireForDataset,
} from "../datasets/model";
import { createRef, placeCopy, requireOpenEndpoint } from "../datasets/refs";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  touchedFields,
  withheldChanges,
  writeAudit,
} from "../framework";

/**
 * Changes a copy of a dataset (docs/DATA_MODEL.md, section 10), for a holder of
 * `datasets.manage` for the dataset's replication or laboratory.
 *
 * | Action     | What it does                                                                     |
 * |------------|----------------------------------------------------------------------------------|
 * | `update`   | Sets the copy's role, the viewers it supports and its note. A viewer that is no longer supported loses its link |
 * | `retire`   | Closes the copy, which stays in the history with the time it was closed         |
 * | `relocate` | Closes the copy and opens a new one at the new place that names it, so the move is recorded as history. The portal moves nothing: the call records where people put the data |
 *
 * A closed copy changes no more. The audit entry names what changed and withholds every path.
 */
export const changeStorageRef = defineCallable(changeStorageRefContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const dataset = await readDataset(db, transaction, input.datasetKey);
      requireForDataset(context, access, "datasets.manage", dataset.data);
      requireActive(dataset);
      const refs = await readRefs(db, transaction, input.datasetKey);
      const ref = refs.find((candidate) => candidate.id === input.storageRefId);
      if (ref === undefined) throw new AppError("not-found", REFERENCE_NOT_FOUND_MESSAGE);
      if (!isCurrent(ref.data)) {
        throw new AppError("failed-precondition", "This copy has been closed and changes no more.");
      }
      const endpoint = input.action === "relocate" ? await readEndpoint(db, transaction, input.endpointKey) : null;
      if (endpoint !== null) requireOpenEndpoint(endpoint.data);
      const path =
        input.action === "relocate" && endpoint !== null
          ? await placeCopy(
              db,
              transaction,
              access,
              dataset,
              { key: input.endpointKey, connection: endpoint.connection },
              input.path,
              ref.id,
            )
          : null;

      const changes: AuditChange[] =
        input.action === "update"
          ? [
              { field: "role", before: ref.data.role, after: input.role },
              {
                field: "viewerSupport",
                before: ref.data.viewerSupport.join(", "),
                after: input.viewerSupport.join(", "),
              },
              ...withheldChanges(["note"]),
            ]
          : input.action === "retire"
            ? [
                { field: "validTo", after: at.toISOString() },
                { field: "reason", after: input.reason },
              ]
            : [
                { field: "validTo", after: at.toISOString() },
                { field: "endpointKey", before: ref.data.endpointKey, after: input.endpointKey },
                { field: "reason", after: input.reason },
                ...withheldChanges(["location.uri"]),
              ];
      const auditEventId = writeAudit(
        transaction,
        {
          action: "storageRef.changed",
          actor: { kind: "user", uid: context.uid },
          entityType: "dataset",
          entityId: input.datasetKey,
          changes: [{ field: "action", after: input.action }, { field: "storageRefId", after: ref.id }, ...changes],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      const now = Timestamp.fromDate(at);

      if (input.action === "update") {
        const supported = [...new Set(input.viewerSupport)];
        transaction.update(ref.reference, {
          role: input.role,
          viewerSupport: supported,
          viewerLinkTools: ref.data.viewerLinkTools.filter((tool) => supported.includes(tool)),
          note: input.note === "" ? FieldValue.delete() : input.note,
          ...touchedFields(stamp),
        });
        return { storageRefId: ref.id };
      }

      transaction.update(ref.reference, { validTo: now, ...touchedFields(stamp) });
      const closed = { ...ref.data, validTo: now };
      let storageRefId = ref.id;
      const remaining = refs.map((candidate) => (candidate.id === ref.id ? closed : candidate.data));
      if (input.action === "relocate" && endpoint !== null && path !== null) {
        storageRefId = createRef(
          db,
          transaction,
          dataset,
          {
            endpointKey: input.endpointKey,
            endpointReference: endpoint.reference,
            role: ref.data.role,
            uri: path,
            viewerSupport: ref.data.viewerSupport,
            note: ref.data.note ?? null,
            relocatedFromRefId: ref.id,
          },
          stamp,
        );
        remaining.push({ ...ref.data, availability: "unknown", lastSeenAt: null, validTo: null });
      }
      transaction.update(dataset.reference, { ...availabilityOf(remaining), ...touchedFields(stamp) });
      return { storageRefId };
    });
  },
});
