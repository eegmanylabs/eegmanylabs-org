import {
  COLLECTIONS,
  dashboardDocSchema,
  defaultDashboardWidgets,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  openDashboardContract,
  PROGRAMME_KEY,
  replicationScopeKey,
  scopeDashboardId,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  writeAudit,
} from "../framework";

const SCOPE_NOT_FOUND_MESSAGE = "There is no such programme, replication or laboratory.";

/**
 * The dashboard of the programme, a replication or a laboratory. Capability: membership, which
 * reads every one of these records and their dashboards. It is created on first use, under the
 * identifier `scopeType__scopeId`, with its default widgets and an audit entry, and a repeated
 * call, or one that loses a race to another, creates nothing.
 */
export const openDashboard = defineCallable(openDashboardContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const dashboardId = scopeDashboardId(input.scopeType, input.scopeId);
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      const reference = db.doc(COLLECTIONS.dashboards.docPath(dashboardId));
      if ((await transaction.get(reference)).exists) return { dashboardId, created: false };

      let name: string;
      let scope: { replicationId: string | null; laboratoryId: string | null; scopeKeys: string[] };
      if (input.scopeType === "programme") {
        if (input.scopeId !== PROGRAMME_KEY) throw new AppError("not-found", SCOPE_NOT_FOUND_MESSAGE);
        name = "Programme dashboard";
        scope = { replicationId: null, laboratoryId: null, scopeKeys: [MEMBERS_SCOPE_KEY] };
      } else if (input.scopeType === "replication") {
        const replication = await transaction.get(db.doc(COLLECTIONS.replications.docPath(input.scopeId)));
        if (!replication.exists) throw new AppError("not-found", SCOPE_NOT_FOUND_MESSAGE);
        name = `${input.scopeId} dashboard`;
        scope = {
          replicationId: input.scopeId,
          laboratoryId: null,
          scopeKeys: [MEMBERS_SCOPE_KEY, replicationScopeKey(input.scopeId)],
        };
      } else {
        const laboratory = await transaction.get(db.doc(COLLECTIONS.laboratories.docPath(input.scopeId)));
        const labName = laboratory.get("name");
        if (!laboratory.exists || typeof labName !== "string") throw new AppError("not-found", SCOPE_NOT_FOUND_MESSAGE);
        name = `${labName} dashboard`.slice(0, 300);
        scope = {
          replicationId: null,
          laboratoryId: input.scopeId,
          scopeKeys: [MEMBERS_SCOPE_KEY, laboratoryScopeKey(input.scopeId)],
        };
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "dashboard.saved",
          actor: { kind: "user", uid },
          entityType: "dashboard",
          entityId: dashboardId,
          changes: [
            { field: "scopeType", after: input.scopeType },
            { field: "scopeId", after: input.scopeId },
          ],
          at,
        },
        db,
      );
      transaction.set(
        reference,
        dashboardDocSchema.parse({
          ...createdFields("dashboards", callerStamp(uid, at, auditEventId)),
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          ownerUid: null,
          name,
          widgets: JSON.parse(JSON.stringify(defaultDashboardWidgets(input.scopeType, input.scopeId))),
          ...scope,
        }),
      );
      return { dashboardId, created: true };
    });
  },
});
