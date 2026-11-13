import {
  COLLECTIONS,
  getRetentionContract,
  MIGRATION_RETENTION_DECISION,
  type MigrationRetention,
  markMigrationVerifiedContract,
  outreachRetentionCutoff,
  PROGRAMME_KEY,
  parseStoredDocument,
  RETENTION_TARGETS,
  type RetentionRun,
  type RetentionTarget,
  retentionRunDocSchema,
  runRetentionSweepContract,
  setRetentionPeriodContract,
  systemSettingsDocSchema,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  type AuthenticatedContext,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  requireProgrammeAdministrator,
  touchedFields,
  writeAudit,
} from "../framework";
import { type RetentionSettings, retentionSettings, runAndRecordSweep } from "../governance/retention";

/** Retention is for programme administrators who hold `audit.read`, with the second factor. */
async function requireAdministrator(context: AuthenticatedContext): Promise<void> {
  const access = await readAccessDocument(context.db, context.uid);
  requireCapability(context, access, "audit.read", "programme");
  requireProgrammeAdministrator(access);
}

function periodsOf(retention: Readonly<Record<string, number>>): Record<RetentionTarget, number | null> {
  return Object.fromEntries(RETENTION_TARGETS.map((target) => [target, retention[target] ?? null])) as Record<
    RetentionTarget,
    number | null
  >;
}

/** What the retention of the migration stands at. */
function migrationOf(
  settings: Pick<RetentionSettings, "migrationVerifiedAt" | "migrationVerifiedBy">,
): MigrationRetention {
  const verifiedAt = settings.migrationVerifiedAt;
  return {
    verifiedAt: verifiedAt?.toISOString() ?? null,
    verifiedBy: verifiedAt === null ? null : settings.migrationVerifiedBy,
    deletableFrom: outreachRetentionCutoff(verifiedAt)?.toISOString() ?? null,
    decision: MIGRATION_RETENTION_DECISION,
  };
}

/** The configured periods, null where none is, the retention of the migration, and the latest twenty sweeps. */
export const getRetention = defineCallable(getRetentionContract, {
  handler: async (_input, context) => {
    const { db } = context;
    await requireAdministrator(context);
    const runs = await db
      .collection(COLLECTIONS.retentionRuns.collectionPath())
      .orderBy("startedAt", "desc")
      .limit(20)
      .get();
    const settings = await retentionSettings(db);
    return {
      periods: periodsOf(settings.retention),
      migration: migrationOf(settings),
      runs: runs.docs.flatMap((document): RetentionRun[] => {
        const run = parseStoredDocument(retentionRunDocSchema, document.data());
        if (!run.success) return [];
        return [
          {
            runId: document.id,
            trigger: run.data.trigger,
            dryRun: run.data.dryRun,
            startedAt: run.data.startedAt.toDate().toISOString(),
            outcomes: run.data.outcomes,
          },
        ];
      }),
    };
  },
});

/**
 * Sets or clears the retention period of one target. The period itself is the programme's
 * decision (docs/SECURITY.md, section 6): the portal holds no default, and a cleared period
 * means that the target is never swept.
 */
export const setRetentionPeriod = defineCallable(setRetentionPeriodContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    await requireAdministrator(context);
    const at = context.clock.now();
    const reference = db.doc(COLLECTIONS.systemSettings.docPath());
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const settings = snapshot.exists ? parseStoredDocument(systemSettingsDocSchema, snapshot.data()) : null;
      if (settings === null) {
        throw new AppError("failed-precondition", "The settings of the portal have not been created yet.");
      }
      if (!settings.success) throw new Error("The stored settings do not fit their schema.");
      const before = settings.data.retention[input.target] ?? null;
      const retention = { ...settings.data.retention };
      if (input.days === null) delete retention[input.target];
      else retention[input.target] = input.days;
      if (before !== input.days) {
        const auditEventId = writeAudit(
          transaction,
          {
            action: "retention.settingsChanged",
            actor: { kind: "user", uid },
            entityType: "programme",
            entityId: PROGRAMME_KEY,
            changes: [{ field: `retention.${input.target}`, before, after: input.days }],
            at,
          },
          db,
        );
        transaction.update(reference, { ...touchedFields(callerStamp(uid, at, auditEventId)), retention });
      }
      return { periods: periodsOf(retention) };
    });
  },
});

/**
 * Marks the migration verified (docs/MIGRATION_PLAN.md, section 11, question 20). Raw source
 * material is kept until then and for one year after, when the retention sweep deletes the
 * outreach records of people who never joined. A programme administrator with the second factor
 * marks it, with an audit entry that names the decision. A later mark, with its reason, moves the
 * start of the year to the moment it is made: a mark made by mistake or too early can only make
 * the programme keep the records longer, never shorter.
 */
export const markMigrationVerified = defineCallable(markMigrationVerifiedContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    await requireAdministrator(context);
    const at = context.clock.now();
    const reference = db.doc(COLLECTIONS.systemSettings.docPath());
    return db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const settings = snapshot.exists ? parseStoredDocument(systemSettingsDocSchema, snapshot.data()) : null;
      if (settings === null) {
        throw new AppError("failed-precondition", "The settings of the portal have not been created yet.");
      }
      if (!settings.success) throw new Error("The stored settings do not fit their schema.");
      const earlier = settings.data.migrationVerifiedAt?.toDate() ?? null;
      if (earlier !== null && at.getTime() <= earlier.getTime()) {
        throw new AppError("failed-precondition", "The mark can move later and never earlier.");
      }
      const auditEventId = writeAudit(
        transaction,
        {
          action: "migration.verified",
          actor: { kind: "user", uid },
          entityType: "programme",
          entityId: PROGRAMME_KEY,
          changes: [
            { field: "migrationVerifiedAt", before: earlier?.toISOString() ?? null, after: at.toISOString() },
            { field: "note", after: input.note },
            { field: "decision", after: MIGRATION_RETENTION_DECISION.reference },
          ],
          at,
        },
        db,
      );
      transaction.update(reference, {
        ...touchedFields(callerStamp(uid, at, auditEventId)),
        migrationVerifiedAt: Timestamp.fromDate(at),
        migrationVerifiedBy: uid,
      });
      return migrationOf({ migrationVerifiedAt: at, migrationVerifiedBy: uid });
    });
  },
});

/**
 * Runs a sweep now, or a dry run that counts and deletes nothing. The sweep resolves the address
 * of an outreach contact through the keyed email index, so it needs the key.
 */
export const runRetentionSweep = defineCallable(runRetentionSweepContract, {
  usesIdentityHashKey: true,
  handler: async (input, context) => {
    const { db, uid } = context;
    await requireAdministrator(context);
    const at = context.clock.now();
    const { runId, outcomes } = await runAndRecordSweep(db, {
      trigger: "manual",
      dryRun: input.dryRun,
      actor: { kind: "user", uid },
      at,
    });
    return { runId, trigger: "manual" as const, dryRun: input.dryRun, startedAt: at.toISOString(), outcomes };
  },
});
