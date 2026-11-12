import { COLLECTIONS, controlSyncMappingContract, parseStoredDocument, syncMappingDocSchema } from "@eegml/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  requireProgrammeAdministrator,
  touchedFields,
  writeAudit,
} from "../framework";
import { recordHealth } from "../integrations/jobs/health";
import { requireIntegrationsManager } from "../integrations/support";

const ACTIONS = {
  pause: "syncMapping.paused",
  resume: "syncMapping.resumed",
  approveLive: "syncMapping.liveApproved",
  withdrawLive: "syncMapping.liveWithdrawn",
} as const;

/**
 * Pauses or resumes a mapping, or moves it between dry run and live (docs/INTEGRATIONS.md,
 * section 1). Holders of `integrations.manage` pause, resume and withdraw live approval, which
 * returns the mapping to a dry run. Approving live writes is a separate act of a programme
 * administrator, recorded with the approver, the time and the mapping it covers. Resuming
 * clears a state of `needsAttention` once a person has dealt with its cause.
 */
export const controlSyncMapping = defineCallable(controlSyncMappingContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const reference = db.doc(COLLECTIONS.syncMappings.docPath(input.mappingId));
    const at = context.clock.now();
    const result = await db.runTransaction(async (transaction) => {
      const access = await requireIntegrationsManager(db, context, transaction);
      if (input.action === "approveLive") {
        requireProgrammeAdministrator(access, "Only a programme administrator approves live writes to a sheet.");
      }
      const mapping = parseStoredDocument(syncMappingDocSchema, (await transaction.get(reference)).data());
      if (!mapping.success) throw new AppError("not-found", "This mapping does not exist.");
      const current = mapping.data;
      const status = input.action === "pause" ? "paused" : input.action === "resume" ? "active" : current.status;
      const mode = input.action === "approveLive" ? "live" : input.action === "withdrawLive" ? "dryRun" : current.mode;
      const auditEventId = writeAudit(
        transaction,
        {
          action: ACTIONS[input.action],
          actor: { kind: "user", uid },
          entityType: "syncMapping",
          entityId: input.mappingId,
          changes: [
            ...(status === current.status ? [] : [{ field: "status", before: current.status, after: status }]),
            ...(mode === current.mode ? [] : [{ field: "mode", before: current.mode, after: mode }]),
            ...(input.reason === undefined ? [] : [{ field: "reason", after: input.reason }]),
          ],
          at,
        },
        db,
      );
      transaction.update(reference, {
        status,
        mode,
        ...(input.action === "pause"
          ? { statusReason: input.reason ?? "Paused by an administrator." }
          : input.action === "resume"
            ? { statusReason: FieldValue.delete() }
            : {}),
        ...(input.action === "approveLive" ? { approvedBy: uid, approvedAt: Timestamp.fromDate(at) } : {}),
        ...(input.action === "withdrawLive" ? { approvedBy: null, approvedAt: null } : {}),
        ...touchedFields(callerStamp(uid, at, auditEventId)),
      });
      return { status, mode };
    });
    // Whether Sheets writes anywhere has changed with the mode of this mapping.
    if (input.action === "approveLive" || input.action === "withdrawLive") {
      await recordHealth(db, "googleSheets", { kind: "success" }, at);
    }
    return result;
  },
});
