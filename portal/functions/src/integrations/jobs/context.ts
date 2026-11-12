// What every job of an integration receives, and how it reports a failure.
import {
  type SyncErrorKind,
  type SyncJobKind,
  type SyncPlanEntry,
  systemActor,
  type WriteContext,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import type { Clock, Logger } from "../../framework";
import type { WriteStamp } from "../../framework/documents";
import type { WorkspaceAdapters } from "../google/types";

export interface JobDependencies {
  readonly db: Firestore;
  /** The adapters, or null where no credential exists. A job then fails as not configured. */
  readonly adapters: WorkspaceAdapters | null;
  readonly clock: Clock;
  readonly logger: Logger;
  sleep(milliseconds: number): Promise<void>;
  random(): number;
  /** The address of the portal, from which generated documents link back to records. */
  readonly portalUrl: string;
}

/**
 * A failed attempt. A retryable failure is tried again by the queue with backoff, and the run
 * is dead-lettered when its attempts are spent. Any other failure ends the run at once.
 */
export class JobFailure extends Error {
  constructor(
    readonly kind: SyncErrorKind,
    readonly retryable: boolean,
    message: string,
    /** The earliest the queue may try again, where the failure names one, such as a lease. */
    readonly notBefore: Date | null = null,
  ) {
    super(message);
    this.name = "JobFailure";
  }
}

/** What a job tells the queue when it ends without failing. */
export interface JobOutcome {
  readonly status: "succeeded" | "partial" | "skipped";
  readonly stats: Readonly<Record<string, number>>;
  readonly plan?: readonly SyncPlanEntry[];
  readonly planOmitted?: number;
  readonly driveVersion?: string;
  /** Why a skipped run was skipped, in words. */
  readonly note?: string;
}

/** The actor of every write a synchronisation makes. */
export const SYNC_ACTOR = systemActor("sync");

/**
 * The stamp of a write the engine makes to a portal record: origin `sync`, so that the trigger
 * that starts synchronisation ignores it, with the mapping as the correlation and the run as the
 * cause, and the audit entry written in the same transaction.
 */
export function syncStamp(at: Date, mappingOrDocumentId: string, runId: string, auditEventId: string): WriteStamp {
  const writeContext: WriteContext = {
    origin: "sync",
    depth: 1,
    correlationId: mappingOrDocumentId,
    causationId: runId,
    auditEventId,
  };
  return { at, actor: SYNC_ACTOR, writeContext };
}

/** The connection that serves each kind of job. */
export const JOB_SYSTEM: Readonly<Record<SyncJobKind, "googleSheets" | "googleDocs" | "googleDrive">> = {
  sheetSync: "googleSheets",
  documentUpdate: "googleDocs",
  driveChanges: "googleDrive",
};
