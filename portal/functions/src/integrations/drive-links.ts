// The target of a Drive link and the right to link to it: the same rule for creating a link and
// for checking it again. A dataset is read from the registry, which gives its replication and
// laboratory, and those who manage the dataset may link to it.
import {
  COLLECTIONS,
  type DriveLinkTarget,
  datasetDocSchema,
  laboratoryScopeKey,
  MEMBERS_SCOPE_KEY,
  manuscriptDocSchema,
  PROGRAMME_SCOPE_KEY,
  parseStoredDocument,
  type ResolvedAccess,
  replicationScopeKey,
} from "@eegml/shared";
import type { Firestore } from "firebase-admin/firestore";
import { AppError, type AuthenticatedContext, requireCapability } from "../framework";

export interface LinkTarget {
  readonly replicationId: string | null;
  readonly laboratoryId: string | null;
}

const MISSING = "The record to link to does not exist.";

/** Finds the scope of a target and refuses a caller who may not link to it. */
export async function authoriseLinkTarget(
  db: Firestore,
  context: AuthenticatedContext,
  access: ResolvedAccess,
  target: { readonly entityType: DriveLinkTarget; readonly entityId: string },
): Promise<LinkTarget> {
  switch (target.entityType) {
    case "replication": {
      if (!(await db.doc(COLLECTIONS.replications.docPath(target.entityId)).get()).exists)
        throw new AppError("not-found", MISSING);
      requireCapability(context, access, "replications.manage", { replicationId: target.entityId });
      return { replicationId: target.entityId, laboratoryId: null };
    }
    case "laboratory": {
      if (!(await db.doc(COLLECTIONS.laboratories.docPath(target.entityId)).get()).exists)
        throw new AppError("not-found", MISSING);
      requireCapability(context, access, "labs.manage", { laboratoryId: target.entityId });
      return { replicationId: null, laboratoryId: target.entityId };
    }
    case "manuscript": {
      const manuscript = parseStoredDocument(
        manuscriptDocSchema,
        (await db.doc(COLLECTIONS.manuscripts.docPath(target.entityId)).get()).data(),
      );
      if (!manuscript.success) throw new AppError("not-found", MISSING);
      const replicationId = manuscript.data.replicationId ?? null;
      requireCapability(
        context,
        access,
        "replications.manage",
        replicationId === null ? "programme" : { replicationId },
      );
      return { replicationId, laboratoryId: null };
    }
    case "dataset": {
      const dataset = parseStoredDocument(
        datasetDocSchema,
        (await db.doc(COLLECTIONS.datasets.docPath(target.entityId)).get()).data(),
      );
      if (!dataset.success) throw new AppError("not-found", MISSING);
      const { replicationId, laboratoryId } = dataset.data;
      requireCapability(
        context,
        access,
        "datasets.manage",
        laboratoryId === null ? { replicationId } : { replicationId, laboratoryId },
      );
      return { replicationId, laboratoryId };
    }
  }
}

/**
 * The audience of a link: the keys of its target, with every member beside them unless it is
 * restricted, and with programme staff beside a restricted one, who read it under the rules and
 * so find it in a list by the key they hold.
 */
export function linkScopeKeys(target: LinkTarget, restricted: boolean): string[] {
  const unit = [
    ...(target.replicationId === null ? [] : [replicationScopeKey(target.replicationId)]),
    ...(target.laboratoryId === null ? [] : [laboratoryScopeKey(target.laboratoryId)]),
  ];
  return restricted ? [...unit, PROGRAMME_SCOPE_KEY] : [...unit, MEMBERS_SCOPE_KEY];
}

/** What a person reads when Drive does not answer. */
export const DRIVE_SILENT_MESSAGE = "Google Drive did not answer. Try again in a few minutes.";

/** The message that names the account to share an item with, which the interface shows with the sharing step. */
export function shareMessage(identity: string): string {
  return `The portal cannot open this item. Ask its owner to share it with ${identity}, then check the link again.`;
}
