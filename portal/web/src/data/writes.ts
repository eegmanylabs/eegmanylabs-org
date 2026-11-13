// The few writes a browser makes directly, under the security rules. Each one sets exactly the
// fields the rules allow, with the caller as its author and the server's time as its instant.
// Everything else that changes state goes through a callable function.
import {
  acknowledgementId,
  COLLECTIONS,
  type CollectionKey,
  correctableFieldSchema,
  type EntityType,
  entityRefId,
  lookupFold,
  MEMBERS_SCOPE_KEY,
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
  Timestamp,
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
const created = (key: CollectionKey, uid: string) => ({
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

// ----- Protocols, acknowledgements, deviations and links of the scientific workflows -----

/**
 * Creates a protocol of a replication, which has no version yet. The security rules accept it
 * from those who hold `replications.manage` for the replication.
 */
export async function createProtocol(
  uid: string,
  studyKey: string,
  input: { readonly title: string; readonly description: string | null },
): Promise<string> {
  const reference = doc(collection(db, COLLECTIONS.replicationProtocols.collectionPath(studyKey)));
  await setDoc(reference, {
    ...created("replicationProtocols", uid),
    replicationId: studyKey,
    title: input.title,
    ...(input.description === null ? {} : { description: input.description }),
    currentVersionId: null,
  });
  return reference.id;
}

/** Adds a draft version to a protocol. The rules accept it from the same writers as the protocol. */
export async function createProtocolVersion(
  uid: string,
  studyKey: string,
  input: {
    readonly protocolId: string;
    readonly versionLabel: string;
    readonly effectiveDate: string | null;
    readonly changeSummary: string | null;
  },
): Promise<string> {
  const reference = doc(collection(db, COLLECTIONS.replicationProtocolVersions.collectionPath(studyKey)));
  await setDoc(reference, {
    ...created("replicationProtocolVersions", uid),
    replicationId: studyKey,
    protocolId: input.protocolId,
    versionLabel: input.versionLabel,
    ...(input.effectiveDate === null ? {} : { effectiveDate: input.effectiveDate }),
    status: "draft",
    ...(input.changeSummary === null ? {} : { changeSummary: input.changeSummary }),
    approvedBy: null,
    approvedAt: null,
  });
  return reference.id;
}

/**
 * Approves a draft version of a protocol in the caller's name at the request time, supersedes the
 * version approved before it and makes it the protocol's current version, in one transaction.
 * The rules allow each of the three changes to the writers of the protocol and no one else.
 */
export async function approveProtocolVersion(
  uid: string,
  studyKey: string,
  protocolId: string,
  versionId: string,
  supersededIds: readonly string[],
): Promise<void> {
  await runTransaction(db, async (transaction) => {
    transaction.update(doc(db, COLLECTIONS.replicationProtocolVersions.docPath(studyKey, versionId)), {
      status: "approved",
      approvedBy: uid,
      approvedAt: serverTimestamp(),
      ...touched(uid),
    });
    for (const id of supersededIds) {
      transaction.update(doc(db, COLLECTIONS.replicationProtocolVersions.docPath(studyKey, id)), {
        status: "superseded",
        ...touched(uid),
      });
    }
    transaction.update(doc(db, COLLECTIONS.replicationProtocols.docPath(studyKey, protocolId)), {
      currentVersionId: versionId,
      ...touched(uid),
    });
  });
}

/**
 * Acknowledges an approved version of a protocol for the caller's own person, who is on the team
 * of the participation. The rules accept it once, from that person alone, at the request time.
 */
export async function acknowledgeProtocolVersion(
  uid: string,
  input: {
    readonly participationId: string;
    readonly replicationId: string;
    readonly laboratoryId: string;
    readonly personId: string;
    readonly protocolId: string;
    readonly protocolVersionId: string;
  },
): Promise<void> {
  await setDoc(
    doc(
      db,
      COLLECTIONS.participationAcknowledgements.docPath(
        input.participationId,
        acknowledgementId(input.personId, input.protocolVersionId),
      ),
    ),
    {
      schemaVersion: 1,
      createdAt: serverTimestamp(),
      createdBy: uid,
      writeContext: userWriteContext(),
      participationId: input.participationId,
      protocolId: input.protocolId,
      protocolVersionId: input.protocolVersionId,
      personId: input.personId,
      acknowledgedAt: serverTimestamp(),
      replicationId: input.replicationId,
      laboratoryId: input.laboratoryId,
      scopeKeys: unitScopeKeys(input.replicationId, input.laboratoryId),
    },
  );
}

/**
 * Names the protocol a participation follows, or none. The version it followed belonged to the
 * protocol named before, so it is cleared with it. The rules accept the change from those who
 * hold `participations.manage` for the participation, for a protocol of its replication.
 */
export async function setParticipationProtocol(
  uid: string,
  participationId: string,
  protocolId: string | null,
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.participations.docPath(participationId)), {
    protocolId: protocolId ?? deleteField(),
    protocolVersionId: deleteField(),
    ...touched(uid),
  });
}

/**
 * Puts a person on the team of a participation in a role, or changes their role, or brings back
 * someone who was removed. The rules accept it from those who hold `participations.manage` for
 * the participation, for a person of the directory.
 */
export async function saveTeamMember(
  uid: string,
  input: {
    readonly participationId: string;
    readonly replicationId: string;
    readonly laboratoryId: string;
    readonly personId: string;
    readonly role: "localLead" | "experimenter" | "analyst" | "dataManager" | "member";
  },
  stored: "absent" | "active" | "archived",
): Promise<void> {
  const reference = doc(db, COLLECTIONS.participationTeamMembers.docPath(input.participationId, input.personId));
  // A restoration changes nothing else, so a person taken off the team is first put back and
  // then given the role.
  if (stored === "archived") await updateDoc(reference, { archivedAt: null, ...touched(uid) });
  if (stored !== "absent") {
    await updateDoc(reference, { role: input.role, ...touched(uid) });
    return;
  }
  await setDoc(reference, {
    ...created("participationTeamMembers", uid),
    participationId: input.participationId,
    personId: input.personId,
    role: input.role,
    replicationId: input.replicationId,
    laboratoryId: input.laboratoryId,
    scopeKeys: unitScopeKeys(input.replicationId, input.laboratoryId),
  });
}

/** Takes a person off the team of a participation, which archives their entry under the same rules. */
export async function removeTeamMember(uid: string, participationId: string, personId: string): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.participationTeamMembers.docPath(participationId, personId)), {
    archivedAt: serverTimestamp(),
    ...touched(uid),
  });
}

/** Reports a deviation from the protocol for a participation, in the caller's name. */
export async function reportDeviation(
  uid: string,
  input: {
    readonly participationId: string;
    readonly replicationId: string;
    readonly laboratoryId: string;
    readonly description: string;
    readonly severity: "minor" | "major" | "critical";
    readonly occurredAt: Date;
  },
): Promise<string> {
  const reference = doc(collection(db, COLLECTIONS.participationDeviations.collectionPath(input.participationId)));
  await setDoc(reference, {
    ...created("participationDeviations", uid),
    participationId: input.participationId,
    description: input.description,
    severity: input.severity,
    occurredAt: Timestamp.fromDate(input.occurredAt),
    reportedBy: uid,
    status: "open",
    replicationId: input.replicationId,
    laboratoryId: input.laboratoryId,
    scopeKeys: unitScopeKeys(input.replicationId, input.laboratoryId),
  });
  return reference.id;
}

/**
 * Follows up a deviation: its corrective action and its status. Its reporter resolves it; the
 * other managers of the participation add the corrective action and put it under review.
 */
export async function followUpDeviation(
  uid: string,
  participationId: string,
  deviationId: string,
  patch: { readonly correctiveAction: string | null; readonly status: "open" | "underReview" | "resolved" },
): Promise<void> {
  await updateDoc(doc(db, COLLECTIONS.participationDeviations.docPath(participationId, deviationId)), {
    status: patch.status,
    correctiveAction: patch.correctiveAction === null ? deleteField() : patch.correctiveAction,
    ...touched(uid),
  });
}

/**
 * Links an external document, such as an OSF page or a draft, to a manuscript of a replication.
 * Every member reads it, as they read the manuscript. The link starts unchecked; trusted code
 * checks it.
 */
export async function linkDocumentToManuscript(
  uid: string,
  input: {
    readonly manuscriptId: string;
    readonly replicationId: string;
    readonly kind: "googleDoc" | "osf" | "github" | "pdf" | "url";
    readonly url: string;
    readonly title: string;
  },
): Promise<string> {
  const reference = doc(collection(db, COLLECTIONS.documentLinks.collectionPath()));
  await setDoc(reference, {
    ...created("documentLinks", uid),
    entityType: "manuscript",
    entityId: input.manuscriptId,
    kind: input.kind,
    url: input.url,
    title: input.title,
    accessStatus: "unknown",
    lastCheckedAt: null,
    restricted: false,
    replicationId: input.replicationId,
    laboratoryId: null,
    scopeKeys: [...unitScopeKeys(input.replicationId, null), MEMBERS_SCOPE_KEY],
  });
  return reference.id;
}

/** A search the signed-in account keeps. The rules accept the fixed kinds, the caps and a generated identifier. */
export interface SavedSearchInput {
  readonly name: string;
  readonly query: string;
  readonly kinds: readonly ("record" | "page" | "comment" | "document")[];
  readonly replicationId: string | null;
}

export async function saveSearch(uid: string, search: SavedSearchInput): Promise<string> {
  const reference = doc(collection(db, COLLECTIONS.userSavedSearches.collectionPath(uid)));
  await setDoc(reference, {
    ...created("userSavedSearches", uid),
    uid,
    name: search.name,
    query: search.query,
    kinds: [...search.kinds],
    replicationId: search.replicationId,
  });
  return reference.id;
}

export async function removeSavedSearch(uid: string, searchId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTIONS.userSavedSearches.docPath(uid, searchId)));
}

/** The notification preferences of the signed-in account, which it alone reads and writes. */
export interface PreferencesInput {
  readonly channels: { readonly inApp: boolean; readonly email: boolean };
  readonly digestFrequency: "off" | "daily" | "weekly";
  readonly quietHours: { readonly start: string; readonly end: string; readonly timeZone: string } | null;
  readonly typeSwitches: Readonly<Record<string, boolean>>;
}

/** Saves the preferences: creates the document the first time, and changes its four fields after. */
export async function savePreferences(uid: string, preferences: PreferencesInput, exists: boolean): Promise<void> {
  const reference = doc(db, COLLECTIONS.userPreferences.docPath(uid));
  const fields = {
    channels: { ...preferences.channels },
    digestFrequency: preferences.digestFrequency,
    quietHours: preferences.quietHours === null ? null : { ...preferences.quietHours },
    typeSwitches: { ...preferences.typeSwitches },
  };
  if (exists) await updateDoc(reference, { ...fields, ...touched(uid) });
  else await setDoc(reference, { ...created("userPreferences", uid), ...fields });
}
