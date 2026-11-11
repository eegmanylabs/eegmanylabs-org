// The few writes a browser makes directly, under the security rules. Each one sets exactly the
// fields the rules allow, with the caller as its author and the server's time as its instant.
// Everything else that changes state goes through a callable function.
import {
  COLLECTIONS,
  correctableFieldSchema,
  type EntityType,
  entityRefId,
  lookupFold,
  tagId,
  unitScopeKeys,
  userWriteContext,
} from "@eegml/shared";
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db } from "./firebase";

/** Marks a notification of the signed-in account as read. The rules let its owner set `readAt` and nothing else. */
export async function markNotificationRead(uid: string, notificationId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.userNotifications.docPath(uid, notificationId)), {
    readAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
    writeContext: userWriteContext(),
  });
}

export interface CorrectionRequestInput {
  readonly entityType: EntityType;
  readonly entityId: string;
  /** The field that is wrong, as the schemas spell it. Never a special-category field. */
  readonly field: string;
  /** What the value should be, in the member's words. */
  readonly proposedValue: string;
  readonly message?: string;
}

/**
 * Reports that a detail of a record is wrong. Any approved member may, and an administrator
 * resolves the request. Returns the identifier of the new request, which Firestore generates.
 */
export async function createCorrectionRequest(uid: string, input: CorrectionRequestInput): Promise<string> {
  const field = correctableFieldSchema.parse(input.field);
  const reference = doc(collection(db, COLLECTIONS.correctionRequests.collectionPath()));
  await setDoc(reference, {
    schemaVersion: COLLECTIONS.correctionRequests.schemaVersion,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid,
    archivedAt: null,
    writeContext: userWriteContext(),
    uid,
    entityType: input.entityType,
    entityId: input.entityId,
    field,
    proposedValue: input.proposedValue,
    ...(input.message === undefined ? {} : { message: input.message }),
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
  });
  return reference.id;
}

/** The standard fields of a change that the signed-in account makes directly. */
const touched = (uid: string) => ({ updatedAt: serverTimestamp(), updatedBy: uid, writeContext: userWriteContext() });

/** A field value to set, or null to remove an optional field. */
export type FieldPatch = Readonly<Record<string, string | number | boolean | null>>;

const toStored = (patch: FieldPatch) =>
  Object.fromEntries(Object.entries(patch).map(([field, value]) => [field, value === null ? deleteField() : value]));

/**
 * Changes descriptive fields of a replication. The security rules accept the change from the
 * leads of the replication, the core team and programme administrators, for the fields they
 * allow, and refuse it from anyone else. The caller validates the values first.
 */
export async function updateReplicationFields(uid: string, studyKey: string, patch: FieldPatch): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.replications.docPath(studyKey)), { ...toStored(patch), ...touched(uid) });
}

/**
 * Puts a person forward as a member of a laboratory. The security rules accept it from the
 * coordinators of the laboratory, the core team and administrators, as a proposed entry only:
 * the person, or an administrator, confirms it through a callable function.
 */
export async function proposeLaboratoryMember(
  uid: string,
  entry: {
    readonly laboratoryId: string;
    readonly personId: string;
    readonly role: "pi" | "coordinator" | "representative" | "member";
    readonly isAuthorisedRepresentative: boolean;
  },
): Promise<void> {
  await setDoc(doc(db, COLLECTIONS.laboratoryMembers.docPath(entry.laboratoryId, entry.personId)), {
    schemaVersion: COLLECTIONS.laboratoryMembers.schemaVersion,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid,
    archivedAt: null,
    writeContext: userWriteContext(),
    laboratoryId: entry.laboratoryId,
    personId: entry.personId,
    role: entry.role,
    isAuthorisedRepresentative: entry.isAuthorisedRepresentative,
    earlierPeriods: [],
    status: "proposed",
  });
}

/** Ends a member entry of a laboratory, which the rules let its coordinators and the programme do. */
export async function endLaboratoryMember(uid: string, laboratoryId: string, personId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.laboratoryMembers.docPath(laboratoryId, personId)), {
    status: "ended",
    ...touched(uid),
  });
}

/** Changes the profile addresses of the signed-in account's own person, which the rules let a person edit. */
export async function updateOwnPersonLinks(uid: string, personId: string, patch: FieldPatch): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.persons.docPath(personId)), { ...toStored(patch), ...touched(uid) });
}

/** Stars a record for the signed-in account, or removes the star. */
export async function setFavourite(uid: string, entityType: EntityType, entityId: string, on: boolean): Promise<void> {
  const reference = doc(db, COLLECTIONS.userFavourites.docPath(uid, entityRefId(entityType, entityId)));
  if (!on) {
    await deleteDoc(reference);
    return;
  }
  await setDoc(reference, {
    schemaVersion: COLLECTIONS.userFavourites.schemaVersion,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid,
    archivedAt: null,
    writeContext: userWriteContext(),
    uid,
    entityType,
    entityId,
  });
}

/**
 * Records that the signed-in account has opened a record. A record visited before keeps its
 * document, whose `updatedAt` becomes the time of this visit.
 */
export async function recordRecentVisit(uid: string, entityType: EntityType, entityId: string): Promise<void> {
  const reference = doc(db, COLLECTIONS.userRecents.docPath(uid, entityRefId(entityType, entityId)));
  await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(reference);
    if (existing.exists()) {
      transaction.update(reference, touched(uid));
      return;
    }
    transaction.set(reference, {
      schemaVersion: COLLECTIONS.userRecents.schemaVersion,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: uid,
      updatedBy: uid,
      archivedAt: null,
      writeContext: userWriteContext(),
      uid,
      entityType,
      entityId,
    });
  });
}

/**
 * Changes fields of a laboratory's profile. The security rules accept the change from the
 * coordinators of the laboratory, the core team and programme administrators, for the fields
 * they allow, and refuse it from anyone else. The caller validates the values first.
 */
export async function updateLaboratoryFields(uid: string, laboratoryId: string, patch: FieldPatch): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.laboratories.docPath(laboratoryId)), { ...toStored(patch), ...touched(uid) });
}

/**
 * Writes the restricted detail of a laboratory, its postal address and internal notes, which the
 * rules let its coordinators, the core team and programme administrators write.
 */
export async function saveLaboratoryDetail(
  uid: string,
  laboratoryId: string,
  patch: FieldPatch,
  exists: boolean,
): Promise<void> {
  const reference = doc(db, COLLECTIONS.laboratoryDetail.docPath(laboratoryId));
  if (exists) {
    await updateDoc(reference, { ...toStored(patch), ...touched(uid) });
    return;
  }
  await setDoc(reference, {
    schemaVersion: COLLECTIONS.laboratoryDetail.schemaVersion,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid,
    archivedAt: null,
    writeContext: userWriteContext(),
    ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== null)),
  });
}

/** What a person changes on an item of an onboarding checklist. */
export interface ChecklistChange {
  readonly status: "notStarted" | "inProgress" | "done" | "notApplicable" | "blocked";
  /** Text to keep, or null to remove the note. Left out to keep it as it is. */
  readonly note?: string | null;
  /** A web address to keep, or null to remove it. Left out to keep it as it is. */
  readonly evidenceUrl?: string | null;
}

/**
 * Updates an item of the onboarding checklist of a participation. Completing an item signs it
 * in the caller's name at the server's time, and any other status clears the signature, as the
 * security rules require. The rules decide who may: the leads and coordinators of the
 * participation, the core team, administrators and the members of its laboratory, and the item
 * of readiness approval only for the replication's side.
 */
export async function updateChecklistItem(
  uid: string,
  participationId: string,
  itemKey: string,
  change: ChecklistChange,
): Promise<void> {
  const signature =
    change.status === "done"
      ? { completedBy: uid, completedAt: serverTimestamp() }
      : { completedBy: null, completedAt: null };
  const optional = (field: "note" | "evidenceUrl") =>
    change[field] === undefined ? {} : { [field]: change[field] === null ? deleteField() : change[field] };
  await updateDoc(doc(db, COLLECTIONS.participationChecklist.docPath(participationId, itemKey)), {
    status: change.status,
    ...signature,
    ...optional("note"),
    ...optional("evidenceUrl"),
    ...touched(uid),
  });
}

/**
 * Changes the restricted detail of a participation: ethics, training, notes and the
 * justification of an equipment override. The rules let those who manage the participation
 * write it, and keep what an approval of readiness covers from changing without it.
 */
export async function updateParticipationDetail(
  uid: string,
  participationId: string,
  patch: FieldPatch,
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.participationDetail.docPath(participationId)), {
    ...toStored(patch),
    ...touched(uid),
  });
}

/** Deletes a view of the signed-in account, which the rules let its owner alone do. */
export async function deleteView(viewId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.views.docPath(viewId)));
}

/**
 * Renames, describes or archives a database, which the rules let the editors of its parent page
 * do. Null removes the description or the icon; `archived` sets or clears `archivedAt`.
 */
export async function updateDatabaseFields(
  uid: string,
  databaseId: string,
  patch: {
    readonly name?: string;
    readonly description?: string | null;
    readonly icon?: string | null;
    readonly archived?: boolean;
  },
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.databases.docPath(databaseId)), {
    ...(patch.name === undefined ? {} : { name: patch.name }),
    ...(patch.description === undefined ? {} : { description: patch.description ?? deleteField() }),
    ...(patch.icon === undefined ? {} : { icon: patch.icon ?? deleteField() }),
    ...(patch.archived === undefined ? {} : { archivedAt: patch.archived ? serverTimestamp() : null }),
    ...touched(uid),
  });
}

/** The standard fields of a document that the signed-in account creates directly. */
const created = (key: "tags" | "userSubscriptions", uid: string) => ({
  schemaVersion: COLLECTIONS[key].schemaVersion,
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
  createdBy: uid,
  updatedBy: uid,
  archivedAt: null,
  writeContext: userWriteContext(),
});

/**
 * The shared tag of a name, created where no tag of that name exists yet. Its identifier is the
 * hash of the folded name, so the tag of a name is found again however the name is spelt, and a
 * second creation of the same name is refused by the rules and changes nothing.
 */
export async function ensureTag(uid: string, name: string): Promise<string> {
  const id = tagId(name);
  const reference = doc(db, COLLECTIONS.tags.docPath(id));
  await runTransaction(db, async (transaction) => {
    if ((await transaction.get(reference)).exists()) return;
    transaction.set(reference, { ...created("tags", uid), name: name.trim(), nameFolded: lookupFold(name) });
  });
  return id;
}

/** Removes a reminder of the signed-in account. */
export async function removeReminder(reminderId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.reminders.docPath(reminderId)));
}

/**
 * Follows a record, or stops following it: one who follows a replication, a laboratory or a
 * member is told of each progress update posted to it.
 */
export async function setFollowing(uid: string, entityType: EntityType, entityId: string, on: boolean): Promise<void> {
  const reference = doc(db, COLLECTIONS.userSubscriptions.docPath(uid, entityRefId(entityType, entityId)));
  if (!on) {
    await deleteDoc(reference);
    return;
  }
  await setDoc(reference, { ...created("userSubscriptions", uid), uid, entityType, entityId, level: "all" });
}

/** A planned pause of a participation, as a coordinator enters it. */
export interface PlannedPauseInput {
  readonly participationId: string;
  readonly replicationId: string;
  readonly laboratoryId: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly reason: string | null;
}

/**
 * Enters a period in which a laboratory will not collect for a replication. The security rules
 * accept it from those who manage the participation, with the replication, the laboratory and
 * the scope keys of the participation, and dates in order. Returns the generated identifier.
 */
export async function createPlannedPause(uid: string, pause: PlannedPauseInput): Promise<string> {
  const reference = doc(collection(db, COLLECTIONS.plannedPauses.collectionPath()));
  await setDoc(reference, {
    schemaVersion: COLLECTIONS.plannedPauses.schemaVersion,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdBy: uid,
    updatedBy: uid,
    archivedAt: null,
    writeContext: userWriteContext(),
    participationId: pause.participationId,
    replicationId: pause.replicationId,
    laboratoryId: pause.laboratoryId,
    scopeKeys: unitScopeKeys(pause.replicationId, pause.laboratoryId),
    startsOn: pause.startsOn,
    endsOn: pause.endsOn,
    ...(pause.reason === null ? {} : { reason: pause.reason }),
  });
  return reference.id;
}

/** Changes the dates or the reason of a planned pause, or archives it, under the same rules. */
export async function updatePlannedPause(
  uid: string,
  pauseId: string,
  patch: {
    readonly startsOn?: string;
    readonly endsOn?: string;
    readonly reason?: string | null;
    readonly archive?: boolean;
  },
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.plannedPauses.docPath(pauseId)), {
    ...(patch.startsOn === undefined ? {} : { startsOn: patch.startsOn }),
    ...(patch.endsOn === undefined ? {} : { endsOn: patch.endsOn }),
    ...(patch.reason === undefined ? {} : { reason: patch.reason === null ? deleteField() : patch.reason }),
    ...(patch.archive === true ? { archivedAt: serverTimestamp() } : {}),
    ...touched(uid),
  });
}
