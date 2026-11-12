// The recorded state of each Google connection (docs/INTEGRATIONS.md, section 9). Functions keep
// it, and the administration page reads it, so the page works during an outage and shows the
// last known state with its time. A move to `needsAttention` tells the holders of
// `integrations.manage` in the portal.
import {
  COLLECTIONS,
  GOOGLE_SYSTEMS,
  type GoogleSystem,
  type IntegrationConnectionStatus,
  integrationConnectionDocSchema,
  parseStoredDocument,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import { FieldValue, type Firestore, Timestamp } from "firebase-admin/firestore";
import { createdFields } from "../../framework/documents";
import { holdersOf, notifyAll } from "../../notifications/notify";
import type { WorkspaceRuntime } from "../google/adapters";

const HEALTH_ACTOR = systemActor("integrations");

/** Whether a connection writes externally anywhere: a live mapping for Sheets, a live template for Docs. Drive only reads. */
export async function connectionMode(db: Firestore, system: GoogleSystem): Promise<"dryRun" | "live"> {
  if (system === "googleDrive") return "live";
  const collection = system === "googleSheets" ? COLLECTIONS.syncMappings : COLLECTIONS.documentTemplates;
  const live = await db.collection(collection.collectionPath()).where("mode", "==", "live").limit(1).get();
  return live.empty ? "dryRun" : "live";
}

/** Creates the record of each connection that has none, and keeps its adapter and identity current. */
export async function ensureConnections(db: Firestore, runtime: WorkspaceRuntime, at: Date): Promise<void> {
  for (const system of GOOGLE_SYSTEMS) {
    const reference = db.doc(COLLECTIONS.integrationConnections.docPath(system));
    const mode = runtime.kind === "none" ? null : await connectionMode(db, system);
    await db.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const identity = runtime.kind === "none" ? undefined : runtime.identity;
      if (!snapshot.exists) {
        transaction.create(
          reference,
          integrationConnectionDocSchema.parse({
            ...createdFields("integrationConnections", { at, actor: HEALTH_ACTOR, writeContext: systemWriteContext() }),
            system,
            status: mode ?? "notConfigured",
            adapter: runtime.kind,
            ...(identity === undefined ? {} : { identity }),
            config: {},
            ...(runtime.kind === "none" ? { statusReason: runtime.reason } : {}),
            lastSuccessAt: null,
            lastErrorAt: null,
          }),
        );
        return;
      }
      if (snapshot.get("adapter") === runtime.kind && snapshot.get("identity") === identity) return;
      transaction.update(reference, {
        adapter: runtime.kind,
        ...(identity === undefined ? {} : { identity }),
        ...(runtime.kind === "none" ? { status: "notConfigured", statusReason: runtime.reason } : {}),
        updatedAt: Timestamp.fromDate(at),
        updatedBy: HEALTH_ACTOR,
        writeContext: systemWriteContext(),
      });
    });
  }
}

export type HealthOutcome =
  | { readonly kind: "success" }
  | { readonly kind: "degraded" | "needsAttention"; readonly message: string };

/**
 * Records the outcome of a job on its connection. A paused connection stays paused and keeps
 * its times. A move to `needsAttention` notifies whoever manages the integrations.
 */
export async function recordHealth(
  db: Firestore,
  system: GoogleSystem,
  outcome: HealthOutcome,
  at: Date,
): Promise<void> {
  const reference = db.doc(COLLECTIONS.integrationConnections.docPath(system));
  const mode = outcome.kind === "success" ? await connectionMode(db, system) : null;
  await db.runTransaction(async (transaction) => {
    const parsed = parseStoredDocument(integrationConnectionDocSchema, (await transaction.get(reference)).data());
    if (!parsed.success) return;
    const current = parsed.data;
    const notify =
      outcome.kind === "needsAttention" && current.status !== "needsAttention" && current.status !== "paused"
        ? await holdersOf(db, transaction, "integrations.manage")
        : [];
    const now = Timestamp.fromDate(at);
    const status: IntegrationConnectionStatus =
      current.status === "paused" || current.status === "notConfigured"
        ? current.status
        : outcome.kind === "success"
          ? (mode ?? "dryRun")
          : outcome.kind;
    transaction.update(reference, {
      status,
      ...(outcome.kind === "success"
        ? { lastSuccessAt: now, statusReason: FieldValue.delete() }
        : { lastError: outcome.message, lastErrorAt: now, statusReason: outcome.message }),
      updatedAt: now,
      updatedBy: HEALTH_ACTOR,
      writeContext: systemWriteContext(),
    });
    if (notify.length > 0) {
      notifyAll(
        db,
        transaction,
        notify,
        {
          type: "integrationFailure",
          entityType: "integrationConnection",
          entityId: system,
          eventId: `${system}-${at.getTime()}`,
          payload: {
            kind: "integrationNeedsAttention",
            system,
            message: outcome.kind === "success" ? "" : outcome.message,
          },
        },
        { at, actor: HEALTH_ACTOR, writeContext: systemWriteContext() },
      );
    }
  });
}

/** Whether the connection of a system has been paused by an administrator. */
export async function connectionPaused(db: Firestore, system: GoogleSystem): Promise<boolean> {
  return (await db.doc(COLLECTIONS.integrationConnections.docPath(system)).get()).get("status") === "paused";
}
