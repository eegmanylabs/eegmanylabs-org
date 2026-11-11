import {
  COLLECTIONS,
  type DashboardDoc,
  dashboardDocSchema,
  parseStoredDocument,
  saveDashboardContract,
  userScopeKey,
} from "@eegml/shared";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  requireCapability,
  touchedFields,
  writeAudit,
} from "../framework";

const DASHBOARD_NOT_FOUND_MESSAGE = "This dashboard does not exist, or your account may not open it.";
/** The most widgets a dashboard holds, which its schema caps as well. */
const WIDGETS_MAX = 100;

/**
 * Creates a personal dashboard for the caller, or changes a dashboard. Capability: membership,
 * and, to change a dashboard that is not the caller's own, `pages.manage` for its programme,
 * replication or laboratory. The widgets named are replaced whole or removed, so that two people
 * who change different widgets at once both keep their change. The dashboard and its audit entry
 * are written in one transaction.
 */
export const saveDashboard = defineCallable(saveDashboardContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      if (!access.member) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
      const dashboards = COLLECTIONS.dashboards;
      let existing: DashboardDoc | null = null;
      if (input.dashboardId !== undefined) {
        const snapshot = await transaction.get(db.doc(dashboards.docPath(input.dashboardId)));
        const parsed = snapshot.exists ? parseStoredDocument(dashboardDocSchema, snapshot.data()) : null;
        if (parsed !== null && !parsed.success) throw parsed.error;
        existing = parsed?.data ?? null;
        if (existing === null || (existing.ownerUid !== null && existing.ownerUid !== uid)) {
          throw new AppError("not-found", DASHBOARD_NOT_FOUND_MESSAGE);
        }
        switch (existing.scopeType) {
          case "user":
            break;
          case "programme":
            requireCapability(context, access, "pages.manage", "programme");
            break;
          case "replication":
            requireCapability(context, access, "pages.manage", { replicationId: existing.scopeId });
            break;
          case "laboratory":
            requireCapability(context, access, "pages.manage", { laboratoryId: existing.scopeId });
            break;
          case "group":
            throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
        }
      }
      const widgets = { ...(existing?.widgets ?? {}) };
      for (const [widgetId, widget] of Object.entries(input.widgets)) {
        if (widget === null) delete widgets[widgetId];
        else widgets[widgetId] = widget;
      }
      if (Object.keys(widgets).length > WIDGETS_MAX) {
        throw new AppError("resource-exhausted", `A dashboard holds at most ${WIDGETS_MAX} widgets.`);
      }
      const dashboardId = input.dashboardId ?? db.collection(dashboards.collectionPath()).doc().id;
      const auditEventId = writeAudit(
        transaction,
        {
          action: "dashboard.saved",
          actor: { kind: "user", uid },
          entityType: "dashboard",
          entityId: dashboardId,
          changes: [
            ...(input.name === undefined ? [] : [{ field: "name", after: input.name }]),
            { field: "widgets", after: Object.keys(input.widgets).sort() },
            ...(input.archived === undefined ? [] : [{ field: "archived", after: input.archived }]),
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(uid, at, auditEventId);
      const reference = db.doc(dashboards.docPath(dashboardId));
      if (existing === null) {
        transaction.set(
          reference,
          dashboardDocSchema.parse({
            ...createdFields("dashboards", stamp),
            scopeType: "user",
            scopeId: uid,
            ownerUid: uid,
            name: input.name ?? "My dashboard",
            widgets: JSON.parse(JSON.stringify(widgets)),
            replicationId: null,
            laboratoryId: null,
            scopeKeys: [userScopeKey(uid)],
            ...(input.archived === true ? { archivedAt: Timestamp.fromDate(at) } : {}),
          }),
        );
      } else {
        transaction.update(reference, {
          ...(input.name === undefined ? {} : { name: input.name }),
          ...Object.fromEntries(
            Object.entries(input.widgets).map(([widgetId, widget]) => [
              `widgets.${widgetId}`,
              widget === null ? FieldValue.delete() : JSON.parse(JSON.stringify(widget)),
            ]),
          ),
          ...(input.archived === undefined ? {} : { archivedAt: input.archived ? Timestamp.fromDate(at) : null }),
          ...touchedFields(stamp),
        });
      }
      return { dashboardId };
    });
  },
});
