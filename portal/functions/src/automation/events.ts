// The events that start automations, read from the writes that Firestore delivers and from the
// schedule (requirement R16.9). Each handler decides whether a write is the event, builds its
// facts and passes it to the dispatch. The identifier of each event names what happened once,
// such as "the laboratory became active", so a write that is delivered twice, and a status that
// goes back and forth, start a rule once.
import { COLLECTIONS, parseStoredDocument, replicationDocSchema, type WriteContext } from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { dataArrivalEventId, QC_RULE_ID } from "../datasets/listing";
import { chainOf, dispatchEvent, plainEvent } from "./dispatch";

type Data = Readonly<Record<string, unknown>> | undefined;

function contextOf(data: Data): Partial<WriteContext> | undefined {
  const context = data?.writeContext;
  return typeof context === "object" && context !== null ? (context as Partial<WriteContext>) : undefined;
}

function depthOf(data: Data): number {
  const depth = contextOf(data)?.depth;
  return typeof depth === "number" ? depth : 0;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** A laboratory that becomes active: its registration was approved, or an administrator created it active. */
export async function onLaboratoryWritten(
  db: Firestore,
  laboratoryId: string,
  before: Data,
  after: Data,
  at: Date,
): Promise<number> {
  if (after === undefined || after.status !== "active" || before?.status === "active") return 0;
  const dispatched = await dispatchEvent(
    db,
    {
      id: `laboratory.activated:${laboratoryId}`,
      event: "laboratory.activated",
      facts: { laboratoryId, status: "active" },
      depth: depthOf(after),
      chain: await chainOf(db, contextOf(after)),
    },
    { entityType: "laboratory", entityId: laboratoryId },
    at,
  );
  return dispatched.queued.length;
}

/** The first arrival of the data of a dataset, for the rules other than the built-in one that acts in the listing itself. */
export async function onDatasetWritten(
  db: Firestore,
  datasetId: string,
  before: Data,
  after: Data,
  at: Date,
): Promise<number> {
  if (after === undefined || after.receivedAt === undefined || before?.receivedAt !== undefined) return 0;
  const dispatched = await dispatchEvent(
    db,
    {
      id: dataArrivalEventId(datasetId),
      event: "dataset.dataArrived",
      facts: { replicationId: text(after.replicationId), laboratoryId: text(after.laboratoryId) },
      depth: depthOf(after),
      chain: await chainOf(db, contextOf(after)),
    },
    { entityType: "dataset", entityId: datasetId },
    at,
    { handledElsewhere: [QC_RULE_ID] },
  );
  return dispatched.queued.length;
}

/** The usable participants of a summary: centrally verified where stated, and otherwise as the laboratories report them. */
export function usableParticipants(data: Data): number | null {
  const totals = data?.totals;
  if (typeof totals !== "object" || totals === null) return null;
  for (const basis of ["centrallyVerified", "labReported"] as const) {
    const usable = (totals as Record<string, Record<string, Record<string, unknown>> | undefined>)[basis]?.participants
      ?.usable;
    if (typeof usable === "number") return usable;
  }
  return null;
}

/** The usable participants of a replication reaching its target, as the summary of its recruitment states them. */
export async function onSummaryWritten(
  db: Firestore,
  replicationId: string,
  before: Data,
  after: Data,
  at: Date,
): Promise<number> {
  const now = usableParticipants(after);
  if (now === null) return 0;
  const replication = parseStoredDocument(
    replicationDocSchema,
    (await db.doc(COLLECTIONS.replications.docPath(replicationId)).get()).data(),
  );
  const target = replication.success ? replication.data.targetN : undefined;
  if (target === undefined || target <= 0) return 0;
  const previous = usableParticipants(before);
  if (now < target || (previous !== null && previous >= target)) return 0;
  const dispatched = await dispatchEvent(
    db,
    {
      id: `recruitment.targetMet:${replicationId}`,
      event: "recruitment.targetMet",
      facts: { replicationId, modality: "participants" },
      depth: depthOf(after),
      chain: [],
    },
    { entityType: "replication", entityId: replicationId },
    at,
  );
  return dispatched.queued.length;
}

/** The events of the schedule at a time: every day, and on Monday the weekly one too. */
export async function onSchedule(db: Firestore, at: Date): Promise<number> {
  const day = at.toISOString().slice(0, 10);
  let queued = (
    await dispatchEvent(
      db,
      plainEvent("schedule.daily", `schedule.daily:${day}`),
      { entityType: null, entityId: null },
      at,
    )
  ).queued.length;
  if (at.getUTCDay() === 1) {
    queued += (
      await dispatchEvent(
        db,
        plainEvent("schedule.weekly", `schedule.weekly:${day}`),
        { entityType: null, entityId: null },
        at,
      )
    ).queued.length;
  }
  return queued;
}
