import {
  COLLECTIONS,
  controlIntegrationConnectionContract,
  type GoogleSystem,
  integrationConnectionDocSchema,
  parseStoredDocument,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  defineCallable,
  readAccessDocument,
  requireCapability,
  runningInEmulator,
  touchedFields,
  writeAudit,
} from "../framework";
import { NOT_CONFIGURED_MESSAGE, workspaceRuntime } from "../integrations/google/adapters";
import type { WorkspaceAdapters } from "../integrations/google/types";
import { connectionMode, ensureConnections, recordHealth } from "../integrations/jobs/health";
import { liveDependencies, receiverUrl } from "../integrations/jobs/live";
import { renewDriveChannel } from "../integrations/jobs/runner";
import { googleNameOf } from "../integrations/jobs/sheet-sync";

const SYSTEM_NAMES = { googleDrive: "Drive", googleSheets: "Sheets", googleDocs: "Docs" } as const;

type Probe =
  | { readonly kind: "answered"; readonly message: string }
  | { readonly kind: "failed" }
  | { readonly kind: "nothingToProbe"; readonly message: string };

/**
 * Tests one service with a read of its own: Drive names the account it acts as, Sheets reads the
 * metadata of a registered spreadsheet, and Docs reads a template. The outcome is that service's
 * alone, so a test of Docs during an outage of Docs never reports it as working.
 */
async function probe(db: Firestore, adapters: WorkspaceAdapters, system: GoogleSystem): Promise<Probe> {
  try {
    if (system === "googleDrive") {
      const about = await adapters.drive.about();
      return { kind: "answered", message: `Drive answered as ${about.emailAddress}.` };
    }
    if (system === "googleSheets") {
      const sources = await db
        .collection(COLLECTIONS.sources.collectionPath())
        .where("kind", "==", "googleSheet")
        .limit(20)
        .get();
      const locations = sources.empty
        ? []
        : await db.getAll(...sources.docs.map((source) => db.doc(COLLECTIONS.sourceLocation.docPath(source.id))));
      const spreadsheetId = locations
        .map((location) => location.get("externalId"))
        .find((id): id is string => typeof id === "string");
      if (spreadsheetId === undefined) {
        return {
          kind: "nothingToProbe",
          message: "No synchronised spreadsheet is registered, so Sheets was not tested.",
        };
      }
      const spreadsheet = await adapters.sheets.getSpreadsheet(spreadsheetId);
      return { kind: "answered", message: `Sheets answered with ${spreadsheet.title}.` };
    }
    const templates = await db.collection(COLLECTIONS.documentTemplates.collectionPath()).limit(20).get();
    const documentId = templates.docs
      .map((template) => template.get("externalDocumentId"))
      .find((id): id is string => typeof id === "string");
    if (documentId === undefined) {
      return { kind: "nothingToProbe", message: "No document template is registered, so Docs was not tested." };
    }
    await adapters.docs.getDocument(documentId);
    return { kind: "answered", message: "Docs answered with a template document." };
  } catch {
    return { kind: "failed" };
  }
}

/** The address the fake's channels name in the emulator, where nothing is ever delivered over the network. */
const EMULATOR_RECEIVER = "https://receiver.emulator.example.org/driveNotifications";

/**
 * Acts on one Google connection (docs/INTEGRATIONS.md, section 9), for holders of
 * `integrations.manage`.
 *
 * | Action             | Effect                                                                  |
 * |--------------------|-------------------------------------------------------------------------|
 * | `test`             | Reads from the service itself (`probe`) and records the outcome on that service alone |
 * | `pause`, `resume`  | Stops or restarts every job of the connection                          |
 * | `renewChannel`     | Opens a new Drive push channel and stops the old ones                  |
 * | `setCredentialRef` | Names the secret that holds a credential, for `integrations.credentials`. Only the name is stored |
 */
export const controlIntegrationConnection = defineCallable(controlIntegrationConnectionContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const access = await readAccessDocument(db, uid);
    requireCapability(
      context,
      access,
      input.action === "setCredentialRef" ? "integrations.credentials" : "integrations.manage",
      "programme",
    );
    const runtime = workspaceRuntime();
    const at = context.clock.now();
    await ensureConnections(db, runtime, at);
    const reference = db.doc(COLLECTIONS.integrationConnections.docPath(input.system));
    let message: string;
    switch (input.action) {
      case "test": {
        if (runtime.kind === "none") {
          message = NOT_CONFIGURED_MESSAGE;
          break;
        }
        const probed = await probe(db, runtime.adapters, input.system);
        if (probed.kind === "nothingToProbe") {
          message = probed.message;
          break;
        }
        const { name } = googleNameOf(runtime.adapters.kind);
        if (probed.kind === "answered") {
          await recordHealth(db, input.system, { kind: "success" }, at);
          message = probed.message;
        } else {
          const failed = `The connection test failed: ${name} did not answer for ${SYSTEM_NAMES[input.system]}.`;
          await recordHealth(db, input.system, { kind: "degraded", message: failed }, at);
          message = failed;
        }
        break;
      }
      case "renewChannel": {
        if (input.system !== "googleDrive") throw new AppError("invalid-argument", "Only Drive has push channels.");
        const address = receiverUrl() ?? (runningInEmulator() ? EMULATOR_RECEIVER : null);
        if (address === null) {
          throw new AppError(
            "failed-precondition",
            "No public address for Drive notifications is configured, so polling is the only route.",
          );
        }
        if (runtime.kind === "none") throw new AppError("failed-precondition", NOT_CONFIGURED_MESSAGE);
        await renewDriveChannel(liveDependencies(runtime), address);
        message = "A new push channel is open, and the older ones were stopped.";
        break;
      }
      case "pause":
      case "resume":
      case "setCredentialRef": {
        if (input.action === "setCredentialRef" && input.credentialRef === undefined) {
          throw new AppError("invalid-argument", "Name the secret.");
        }
        const mode = runtime.kind === "none" ? "notConfigured" : await connectionMode(db, input.system);
        await db.runTransaction(async (transaction) => {
          const connection = parseStoredDocument(
            integrationConnectionDocSchema,
            (await transaction.get(reference)).data(),
          );
          if (!connection.success) throw new AppError("not-found", "This connection does not exist.");
          const status =
            input.action === "pause" ? "paused" : input.action === "resume" ? mode : connection.data.status;
          const auditEventId = writeAudit(
            transaction,
            {
              action:
                input.action === "pause"
                  ? "integration.paused"
                  : input.action === "resume"
                    ? "integration.resumed"
                    : "integration.credentialNamed",
              actor: { kind: "user", uid },
              entityType: "integrationConnection",
              entityId: input.system,
              changes:
                input.action === "setCredentialRef"
                  ? [
                      {
                        field: "credentialRef",
                        before: connection.data.credentialRef ?? null,
                        after: input.credentialRef ?? null,
                      },
                    ]
                  : [{ field: "status", before: connection.data.status, after: status }],
              at,
            },
            db,
          );
          transaction.update(reference, {
            status,
            ...(input.action === "setCredentialRef" ? { credentialRef: input.credentialRef } : {}),
            ...(input.action === "pause" ? { statusReason: "Paused by an administrator." } : {}),
            ...touchedFields(callerStamp(uid, at, auditEventId)),
          });
        });
        message =
          input.action === "pause"
            ? "The connection is paused. No job of it runs until it is resumed."
            : input.action === "resume"
              ? "The connection is running again."
              : "The secret is named. Its value stays in the secret store.";
        break;
      }
    }
    if (input.action === "test" || input.action === "renewChannel") {
      const batch = db.batch();
      writeAudit(
        batch,
        {
          action: input.action === "test" ? "integration.tested" : "integration.channelRenewed",
          actor: { kind: "user", uid },
          entityType: "integrationConnection",
          entityId: input.system,
          at,
        },
        db,
      );
      await batch.commit();
    }
    const status = parseStoredDocument(integrationConnectionDocSchema, (await reference.get()).data());
    return { status: status.success ? status.data.status : "notConfigured", message };
  },
});
