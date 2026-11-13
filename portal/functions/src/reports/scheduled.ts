// Scheduled progress reports (requirement R15.7). A report names a template of the generated
// documents of phase 6 and the record it is about, and on its schedule the sweep asks for the
// document to be updated through the same queue as every other generated document, then tells
// the recipients in the portal. A period, a week or a month, runs once: the report records the
// period it last ran for, and the job takes its identifier from the report and the period.
import {
  COLLECTIONS,
  documentTemplateDocSchema,
  isoWeek,
  localDay,
  parseStoredDocument,
  type ScheduledReportDoc,
  scheduledReportDocSchema,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { requestGeneration } from "../integrations/jobs/generation";
import { notifyAll } from "../notifications/notify";
import { reportEntityExists, sortRecipients } from "./recipients";

const REPORTS_ACTOR = systemActor("scheduledReports");

/** The period of a schedule at an instant, on the clock of London. A monthly report runs on the first day of a month. */
export function reportPeriod(schedule: ScheduledReportDoc["schedule"], at: Date): string | null {
  const day = localDay(at, "Europe/London");
  if (schedule === "monthly") return day.endsWith("-01") ? day.slice(0, 7) : null;
  return new Date(`${day}T00:00:00Z`).getUTCDay() === 1 ? isoWeek(day) : null;
}

/** The address in the portal of the documents of a record. */
function documentsPath(report: ScheduledReportDoc): string {
  const { entityType, entityId } = report.definition;
  if (entityType === "replication") return `/replications/${entityId}?tab=documents`;
  if (entityType === "laboratory") return `/labs/${entityId}?tab=documents`;
  return "/dashboards";
}

/** Runs every report whose period has come and has not run yet. Answers how many ran. */
export async function runDueReports(db: Firestore, at: Date): Promise<number> {
  const found = await db
    .collection(COLLECTIONS.scheduledReports.collectionPath())
    .where("enabled", "==", true)
    .limit(200)
    .get();
  let ran = 0;
  for (const document of found.docs) {
    const parsed = parseStoredDocument(scheduledReportDocSchema, document.data());
    if (!parsed.success || parsed.data.archivedAt !== null) continue;
    const report = parsed.data;
    const period = reportPeriod(report.schedule, at);
    if (period === null || period === report.lastPeriod) continue;
    const template = parseStoredDocument(
      documentTemplateDocSchema,
      (await db.doc(COLLECTIONS.documentTemplates.docPath(report.definition.templateKey)).get()).data(),
    );
    if (!template.success || !template.data.enabled) continue;
    const { entityType, entityId } = report.definition;
    if (entityType !== "programme" && entityType !== "replication" && entityType !== "laboratory") continue;
    if (!(await reportEntityExists(db, entityType, entityId))) continue;
    // An account suspended or moved out of the record's audience since the report was saved is
    // no longer told about it.
    const { qualified } = await sortRecipients(db, report.recipients, template.data, entityType, entityId);
    const writeContext = systemWriteContext();
    await requestGeneration(db, {
      template: { key: report.definition.templateKey, data: template.data },
      entityType,
      entityId,
      name: report.name,
      actor: { kind: "system" },
      trigger: "schedule",
      eventKey: `scheduledReport:${document.id}:${period}`,
      at,
      writeContext,
    });
    await db.runTransaction(async (transaction) => {
      const current = await transaction.get(document.ref);
      if (current.get("lastPeriod") === period) return;
      transaction.update(document.ref, {
        lastPeriod: period,
        lastRunAt: Timestamp.fromDate(at),
        updatedAt: Timestamp.fromDate(at),
        updatedBy: REPORTS_ACTOR,
        writeContext,
      });
      notifyAll(
        db,
        transaction,
        qualified,
        {
          type: "progressUpdate",
          entityType,
          entityId,
          eventId: `scheduledReport:${document.id}:${period}`,
          payload: { kind: "scheduledReportQueued", title: report.name, to: documentsPath(report) },
        },
        { at, actor: REPORTS_ACTOR, writeContext },
      );
    });
    ran += 1;
  }
  return ran;
}
