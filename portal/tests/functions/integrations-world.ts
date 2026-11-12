// The Google Workspace world of the integration tests: the laboratories, equipment, sources,
// mappings and templates of the demonstration world, and the fake that the emulator's functions
// use, over the same state file, so a test and a function see one Drive.
// Everything here is synthetic: invented laboratories and files on the example.org domain.
import { COLLECTIONS, DOCUMENT_TEMPLATES, type SyncJobKind, sourceTabKey, syncMappingId } from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import { initialFakeState } from "../../functions/src/integrations/google/fake/fixtures";
import { FileStore, fakeStatePath, resetFakeState } from "../../functions/src/integrations/google/fake/store";
import { FakeWorkspace } from "../../functions/src/integrations/google/fake/workspace";
import type { WorkspaceAdapters } from "../../functions/src/integrations/google/types";
import type { JobDependencies } from "../../functions/src/integrations/jobs/context";
import { enqueueRun } from "../../functions/src/integrations/jobs/queue";
import { executeRun } from "../../functions/src/integrations/jobs/runner";
import {
  DEMO_DOCUMENT_TEMPLATES,
  DEMO_EQUIPMENT,
  DEMO_LABORATORIES,
  DEMO_SYNC_MAPPINGS,
  DEMO_SYNC_SOURCES,
  DEMO_WORKSPACE,
} from "../../tools/src/fixtures/demo-world";
import { adminDb } from "../support/admin";
import { standard } from "./support";

/** The cities of the demonstration laboratories, as the fake's directory holds them. */
const CITIES: Readonly<Record<string, string>> = {
  "demo-lab-attention": "Northfield",
  "demo-lab-memory": "Northfield",
  "demo-lab-signal": "Harbourtown",
  "demo-lab-cognition": "Ridgeway",
};

export const EQUIPMENT_MAPPING = syncMappingId("demo-equipment-register", sourceTabKey("Equipment"), "core:equipment");
export const DIRECTORY_MAPPING = syncMappingId(
  "demo-laboratory-directory",
  sourceTabKey("Laboratories"),
  "core:laboratories",
);

/** A clock a test moves by hand. */
export class TestClock {
  constructor(private instant: number = Date.UTC(2026, 10, 11, 10, 0, 0)) {}
  now(): Date {
    return new Date(this.instant);
  }
  advance(milliseconds: number): void {
    this.instant += milliseconds;
  }
}

/** The fake of this emulator run, over the state file the functions read, with an optional clock. */
export function workspaceFake(clock?: TestClock): FakeWorkspace {
  return new FakeWorkspace(
    new FileStore(fakeStatePath(), initialFakeState),
    clock === undefined ? Date.now : () => clock.now().getTime(),
  );
}

/** Starts the fake again from its fixtures. */
export function resetWorkspace(): void {
  resetFakeState();
}

/** The dependencies of a job run in the test's own process, with waits that are recorded and never slept. */
export function jobDependencies(
  adapters: WorkspaceAdapters | null,
  clock: TestClock = new TestClock(),
): JobDependencies & { readonly waits: number[] } {
  const waits: number[] = [];
  const quiet = () => undefined;
  return {
    db: adminDb,
    adapters,
    clock,
    logger: { info: quiet, warn: quiet, error: quiet },
    sleep: async (milliseconds) => {
      waits.push(milliseconds);
    },
    random: () => 0,
    portalUrl: "https://portal.example.org/",
    waits,
  };
}

/** Enqueues a run and runs it at once, in the test's own process. Answers the run and how it ended. */
export async function runJob(
  dependencies: JobDependencies,
  request: {
    readonly kind: SyncJobKind;
    readonly mappingId?: string;
    readonly generatedDocumentId?: string;
    readonly mode?: "dryRun" | "live";
    readonly trigger?: "event" | "schedule" | "manual";
  },
  eventKey = `test:${Math.random().toString(36).slice(2)}`,
): Promise<{ readonly runId: string; readonly status: string | null }> {
  const { runId } = await enqueueRun(dependencies.db, {
    kind: request.kind,
    ...(request.mappingId === undefined ? {} : { mappingId: request.mappingId }),
    ...(request.generatedDocumentId === undefined ? {} : { generatedDocumentId: request.generatedDocumentId }),
    mode: request.mode ?? "live",
    trigger: request.trigger ?? "manual",
    eventKey,
    requestedBy: "system:test",
    at: dependencies.clock.now(),
  });
  return { runId, status: await executeRun(runId, dependencies) };
}

export interface WorldOptions {
  /** The mode of the laboratory directory. The demonstration world starts it as a dry run. */
  readonly directoryMode?: "dryRun" | "live";
}

/** Writes the laboratories, equipment, sources, mappings, templates and connections of the demonstration workspace. */
export async function seedWorkspaceWorld(options: WorldOptions = {}): Promise<void> {
  const now = Timestamp.now();
  const batch = adminDb.batch();
  for (const laboratory of DEMO_LABORATORIES) {
    batch.set(adminDb.doc(COLLECTIONS.laboratories.docPath(laboratory.id)), {
      ...standard(now),
      slug: laboratory.slug,
      name: laboratory.name,
      city: CITIES[laboratory.id],
      status: "active",
      custom: {},
      dataOrigin: "demo",
    });
  }
  for (const configuration of DEMO_EQUIPMENT) {
    const { id, ...fields } = configuration;
    batch.set(adminDb.doc(COLLECTIONS.laboratoryEquipment.docPath(configuration.laboratoryId, id)), {
      ...standard(now),
      ...fields,
      validFrom: now,
      validTo: configuration.isCurrent ? null : now,
    });
  }
  for (const system of ["googleDrive", "googleSheets", "googleDocs"] as const) {
    batch.set(adminDb.doc(COLLECTIONS.integrationConnections.docPath(system)), {
      ...standard(now),
      system,
      status: "live",
      adapter: "fake",
      identity: DEMO_WORKSPACE.account,
      config: {},
      lastSuccessAt: null,
      lastErrorAt: null,
    });
  }
  for (const source of DEMO_SYNC_SOURCES) {
    batch.set(adminDb.doc(COLLECTIONS.sources.docPath(source.key)), {
      ...standard(now),
      key: source.key,
      title: source.title,
      kind: "googleSheet",
      authority: "live",
      syncPolicy: "twoWay",
      accessStatus: "shared",
      lastFetchedAt: null,
    });
    batch.set(adminDb.doc(COLLECTIONS.sourceLocation.docPath(source.key)), {
      ...standard(now),
      externalId: source.fileId,
    });
    const tabKey = sourceTabKey(source.tabTitle);
    batch.set(adminDb.doc(COLLECTIONS.sourceTabs.docPath(source.key, tabKey)), {
      ...standard(now),
      sourceKey: source.key,
      tabKey,
      name: source.tabTitle,
      sheetId: source.sheetId,
      visibility: "visible",
      lastSeenAt: now,
    });
  }
  for (const mapping of DEMO_SYNC_MAPPINGS) {
    const tabKey = sourceTabKey(mapping.tabTitle);
    const mode = mapping.collectionKey === "core:laboratories" ? (options.directoryMode ?? "live") : mapping.mode;
    batch.set(
      adminDb.doc(COLLECTIONS.syncMappings.docPath(syncMappingId(mapping.sourceKey, tabKey, mapping.collectionKey))),
      {
        ...standard(now),
        name: mapping.name,
        connectionId: "googleSheets",
        sourceKey: mapping.sourceKey,
        tabKey,
        collectionKey: mapping.collectionKey,
        keyStrategy: "keyColumn",
        keyColumn: mapping.keyColumn,
        columnMap: mapping.columns.map((column) => ({ ...column })),
        sheetOnlyRows: "propose",
        appOnlyRecords: "append",
        cellCeiling: 200,
        mode,
        status: "active",
        approvedBy: mode === "live" ? "system:test" : null,
        approvedAt: mode === "live" ? now : null,
        lastRunId: null,
        lastRunAt: null,
        lastSuccessAt: null,
      },
    );
  }
  for (const template of DEMO_DOCUMENT_TEMPLATES) {
    batch.set(adminDb.doc(COLLECTIONS.documentTemplates.docPath(template.key)), {
      ...standard(now),
      key: template.key,
      name: template.name,
      kind: template.kind,
      entityType: template.entityType,
      externalDocumentId: template.templateFileId,
      targetFolderId: DEMO_WORKSPACE.generatedFolder,
      managedSections: DOCUMENT_TEMPLATES[template.kind].sections.map((section) => section.name),
      enabled: true,
      mode: "live",
      approvedBy: "system:test",
      approvedAt: now,
    });
  }
  await batch.commit();
}
