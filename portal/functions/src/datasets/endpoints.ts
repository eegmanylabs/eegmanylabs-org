// The health of a storage server (docs/INTEGRATIONS.md, sections 7 and 9). A check or a scan
// that reaches the server makes it active and records when it was last seen. One that finds it
// down or too slow makes it unreachable with the time and the reason, and the first time it
// does, one notification goes to the endpoint's owner and to those who manage the integrations.
// A check carries the outage to the copies held there and to their datasets, and back again.
// A refusal of the account leaves the server's state alone: the server answered.
import {
  COLLECTIONS,
  datasetStorageRefDocSchema,
  parseStoredDocument,
  personDocSchema,
  type StorageEndpointDoc,
  storageEndpointDocSchema,
  systemActor,
  systemWriteContext,
} from "@eegml/shared";
import {
  type DocumentReference,
  FieldValue,
  type Firestore,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import { AppError, writeAudit } from "../framework";
import { callerStamp, touchedFields, type WriteStamp } from "../framework/documents";
import { SCANS_NOT_ENABLED_MESSAGE, storageRuntime } from "../integrations/storage/adapters";
import { checkTarget } from "../integrations/storage/scan";
import type { StorageFailureKind, StorageRuntime } from "../integrations/storage/types";
import { holdersOf, notifyAll } from "../notifications/notify";
import { availabilityOf, isCurrent, readEndpoint, readRefs, targetOf } from "./model";

/** What the transaction read to record the health of an endpoint. */
export interface EndpointReads {
  readonly key: string;
  readonly reference: DocumentReference;
  readonly data: StorageEndpointDoc;
  /** Who is told when the endpoint becomes unreachable. */
  readonly tell: readonly string[];
}

/** Reads, before the first write, whom a change of the endpoint's health concerns. */
export async function readForHealth(
  db: Firestore,
  transaction: Transaction,
  key: string,
  reference: DocumentReference,
  data: StorageEndpointDoc,
): Promise<EndpointReads> {
  const managers = await holdersOf(db, transaction, "integrations.manage");
  let owner: string[] = [];
  if (data.ownerPersonId !== undefined) {
    const person = parseStoredDocument(
      personDocSchema,
      (await transaction.get(db.doc(COLLECTIONS.persons.docPath(data.ownerPersonId)))).data(),
    );
    owner = person.success && person.data.userId !== null ? [person.data.userId] : [];
  }
  return { key, reference, data, tell: [...owner, ...managers] };
}

/** Whether a failure says the server itself is out of reach, rather than refusing the account or the path. */
export const isOutage = (kind: StorageFailureKind) => kind === "unreachable" || kind === "timeout";

/** Records what a check or a scan found of the server, and tells people when it has become unreachable. */
export function recordHealth(
  db: Firestore,
  transaction: Transaction,
  endpoint: EndpointReads,
  outcome:
    | { readonly reached: true }
    | { readonly reached: false; readonly kind: StorageFailureKind; readonly message: string },
  auditEventId: string,
  stamp: WriteStamp,
): StorageEndpointDoc["status"] {
  const now = Timestamp.fromDate(stamp.at);
  const retired = endpoint.data.status === "retired";
  if (outcome.reached) {
    transaction.update(endpoint.reference, {
      ...(retired ? {} : { status: "active" }),
      statusReason: FieldValue.delete(),
      lastCheckedAt: now,
      lastSeenAt: now,
      ...touchedFields(stamp),
    });
    transaction.update(db.doc(COLLECTIONS.storageEndpointConnection.docPath(endpoint.key)), {
      lastCheckResult: "The server answered.",
      ...touchedFields(stamp),
    });
    return retired ? "retired" : "active";
  }
  if (!isOutage(outcome.kind)) {
    transaction.update(endpoint.reference, { lastCheckedAt: now, ...touchedFields(stamp) });
    return endpoint.data.status;
  }
  const becomesUnreachable = endpoint.data.status === "active";
  transaction.update(endpoint.reference, {
    ...(retired ? {} : { status: "unreachable" }),
    statusReason: outcome.message,
    lastCheckedAt: now,
    ...touchedFields(stamp),
  });
  transaction.update(db.doc(COLLECTIONS.storageEndpointConnection.docPath(endpoint.key)), {
    lastCheckResult: outcome.message,
    ...touchedFields(stamp),
  });
  if (becomesUnreachable) {
    notifyAll(
      db,
      transaction,
      endpoint.tell,
      {
        type: "integrationFailure",
        entityType: "storageEndpoint",
        entityId: endpoint.key,
        eventId: auditEventId,
        payload: { kind: "storageUnreachable", title: endpoint.data.name, endpointKey: endpoint.key },
      },
      stamp,
    );
  }
  return retired ? "retired" : "unreachable";
}

/** The most copies of one server whose availability a check changes at once. */
const COPIES_PER_CHECK = 2_000;

/**
 * Reads, before the first write, what a check means for the copies held on a server, and gives
 * the writes. A server out of reach makes each of its current copies unavailable, keeping the
 * last listing and the time it was last seen, and the availability of each dataset follows. A
 * server that answers again restores the copies that only its outage had made unavailable: one
 * whose last scan was refused or found no path stays as it is until it is scanned again.
 */
export async function readCopiesForHealth(
  db: Firestore,
  transaction: Transaction,
  key: string,
  reached: boolean,
): Promise<(stamp: WriteStamp) => void> {
  const found = await transaction.get(
    db
      .collectionGroup(COLLECTIONS.datasetStorageRefs.collectionId)
      .where("endpointKey", "==", key)
      .limit(COPIES_PER_CHECK),
  );
  const changed = new Map<string, { id: string; availability: "available" | "unavailable" | "unknown" }[]>();
  for (const snapshot of found.docs) {
    const ref = parseStoredDocument(datasetStorageRefDocSchema, snapshot.data());
    if (!ref.success || !isCurrent(ref.data)) continue;
    const next = reached
      ? ref.data.availability === "unavailable" && RESTORED_AFTER_OUTAGE.has(ref.data.lastScanStatus)
        ? ref.data.latestManifestId === null
          ? "unknown"
          : "available"
        : null
      : ref.data.availability === "unavailable"
        ? null
        : "unavailable";
    if (next === null) continue;
    changed.set(ref.data.datasetId, [
      ...(changed.get(ref.data.datasetId) ?? []),
      { id: snapshot.id, availability: next },
    ]);
  }
  const datasets = await Promise.all(
    [...changed.keys()].map(async (datasetKey) => {
      const reference = db.doc(COLLECTIONS.datasets.docPath(datasetKey));
      const exists = (await transaction.get(reference)).exists;
      return { datasetKey, reference, exists, refs: exists ? await readRefs(db, transaction, datasetKey) : [] };
    }),
  );
  return (stamp) => {
    for (const dataset of datasets) {
      const updates = new Map((changed.get(dataset.datasetKey) ?? []).map((ref) => [ref.id, ref.availability]));
      for (const ref of dataset.refs) {
        const availability = updates.get(ref.id);
        if (availability !== undefined) transaction.update(ref.reference, { availability, ...touchedFields(stamp) });
      }
      if (!dataset.exists) continue;
      const next = dataset.refs.map((ref) => ({
        ...ref.data,
        availability: updates.get(ref.id) ?? ref.data.availability,
      }));
      transaction.update(dataset.reference, { ...availabilityOf(next), ...touchedFields(stamp) });
    }
  };
}

/** The scans after which a copy is unavailable only because its server was out of reach. */
const RESTORED_AFTER_OUTAGE: ReadonlySet<string> = new Set(["never", "ok", "unreachable", "timeout"]);

/** The outcome of a check of one endpoint. */
export interface EndpointCheck {
  readonly status: StorageEndpointDoc["status"];
  readonly reachable: boolean;
  readonly message: string;
}

/**
 * Checks one endpoint and records what was found, for a person or for the daily sweep. An
 * endpoint described by uploaded manifests, and one whose protocol has no adapter, is not
 * reached at all and the answer says why.
 */
export async function runEndpointCheck(
  db: Firestore,
  key: string,
  actor: { readonly kind: "user"; readonly uid: string } | { readonly kind: "system" },
  at: Date,
  runtime: StorageRuntime | null = storageRuntime(),
): Promise<EndpointCheck> {
  const endpoint = await db.runTransaction((transaction) => readEndpoint(db, transaction, key));
  if (endpoint.data.scanMode === "uploadedManifest") {
    throw new AppError(
      "failed-precondition",
      "This server is described by manifests made inside the institution, so the portal does not reach it.",
    );
  }
  if (runtime === null) throw new AppError("failed-precondition", SCANS_NOT_ENABLED_MESSAGE);
  const adapter = runtime.adapterFor(endpoint.data.protocol);
  const target = targetOf(endpoint.data, endpoint.connection, "");
  if (adapter === null || target === null) {
    throw new AppError("failed-precondition", "The portal has no way to reach a server of this protocol.");
  }
  const outcome = await checkTarget(adapter, target, runtime.requestTimeoutMs);
  return db.runTransaction(async (transaction) => {
    const current = await readEndpoint(db, transaction, key);
    const reads = await readForHealth(db, transaction, key, current.reference, current.data);
    // A refusal of the account says nothing about the copies: the server answered.
    const copies =
      outcome.ok || isOutage(outcome.kind) ? await readCopiesForHealth(db, transaction, key, outcome.ok) : null;
    const auditEventId = writeAudit(
      transaction,
      {
        action: "storageEndpoint.checked",
        actor,
        entityType: "storageEndpoint",
        entityId: key,
        changes: [{ field: "outcome", after: outcome.ok ? "reached" : outcome.kind }],
        at,
      },
      db,
    );
    const stamp: WriteStamp =
      actor.kind === "user"
        ? callerStamp(actor.uid, at, auditEventId)
        : { at, actor: systemActor("storageSweep"), writeContext: systemWriteContext("system", auditEventId) };
    const status = recordHealth(
      db,
      transaction,
      reads,
      outcome.ok ? { reached: true } : { reached: false, kind: outcome.kind, message: outcome.message },
      auditEventId,
      stamp,
    );
    copies?.(stamp);
    return { status, reachable: outcome.ok, message: outcome.message };
  });
}

/** What the daily sweep found. */
export interface StorageSweep {
  readonly checked: number;
  readonly reachable: number;
  readonly unreachable: number;
}

/**
 * Checks every server that the portal scans, as the daily sweep does: not those described by
 * uploaded manifests, nor retired ones. A server that the sweep finds down becomes unreachable,
 * with one notification, and one that has come back becomes active again, so the registry
 * recovers without anyone asking.
 */
export async function sweepEndpoints(
  db: Firestore,
  at: Date,
  runtime: StorageRuntime | null = storageRuntime(),
): Promise<StorageSweep> {
  if (runtime === null) return { checked: 0, reachable: 0, unreachable: 0 };
  const found = await db.collection(COLLECTIONS.storageEndpoints.collectionPath()).limit(1_000).get();
  let checked = 0;
  let reachable = 0;
  for (const snapshot of found.docs) {
    const endpoint = parseStoredDocument(storageEndpointDocSchema, snapshot.data());
    if (!endpoint.success || endpoint.data.scanMode !== "remote" || endpoint.data.status === "retired") continue;
    const outcome = await runEndpointCheck(db, snapshot.id, { kind: "system" }, at, runtime);
    checked += 1;
    if (outcome.reachable) reachable += 1;
  }
  return { checked, reachable, unreachable: checked - reachable };
}
