// The triggers that keep `access/{uid}` in line with what it is resolved from (item one of the
// derived data in docs/DATA_MODEL.md, section 14).
//
// Each handler reads the sources as they are now and writes the access document only where it
// differs, so a delivery that arrives twice, late or out of order ends in the same document.
// A callable function that changed a source has written the access document in its own
// transaction already, and its event finds nothing left to do here.
import { COLLECTIONS, requireSecondFactorOf } from "@eegml/shared";
import { logger } from "firebase-functions";
import { type Change, type DocumentSnapshot, onDocumentWritten } from "firebase-functions/firestore";
import { rebuildAccess, rebuildAllAccess } from "../access/maintain";
import { firestore } from "../framework/admin";
import { documentTrigger } from "../framework/trigger";

interface WriteEvent {
  readonly id: string;
  readonly time: string;
  readonly data: Change<DocumentSnapshot> | undefined;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const texts = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((element): element is string => typeof element === "string") : [];
const sameTexts = (left: unknown, right: unknown): boolean => {
  const a = texts(left).sort();
  const b = texts(right).sort();
  return a.length === b.length && a.every((element, index) => element === b[index]);
};

async function rebuildFor(event: WriteEvent, uids: Iterable<string | null>): Promise<void> {
  const db = firestore();
  const at = new Date(event.time);
  for (const uid of new Set(uids)) {
    if (uid !== null) await rebuildAccess(db, uid, { at, logger, causationId: event.id });
  }
}

/** The accounts that the two states of a document name in a field. */
const namedIn = (event: WriteEvent, field: string): (string | null)[] => [
  text(event.data?.before.get(field)),
  text(event.data?.after.get(field)),
];

/** A role assignment was created, changed or removed: its account is resolved again. */
export const accessOnRoleAssignmentWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.roleAssignments.path),
  (event) => rebuildFor(event, namedIn(event, "uid")),
);

/** A named capability grant was created, changed or removed. */
export const accessOnCapabilityGrantWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.capabilityGrants.path),
  (event) => rebuildFor(event, namedIn(event, "uid")),
);

/** A record grant was created, changed or removed. */
export const accessOnRecordGrantWritten = onDocumentWritten(documentTrigger(COLLECTIONS.recordGrants.path), (event) =>
  rebuildFor(event, namedIn(event, "uid")),
);

/**
 * The profile of an account changed in what the access document follows: the suspension, the
 * second factor or the linked person. A new profile is left alone, because the function that
 * registers an account writes its access document in the same transaction.
 */
export const accessOnUserWritten = onDocumentWritten(documentTrigger(COLLECTIONS.users.path), async (event) => {
  const change = event.data;
  if (change === undefined || !change.before.exists || !change.after.exists) return;
  const followed = ["status", "mfaEnrolled", "personId"];
  if (followed.every((field) => change.before.get(field) === change.after.get(field))) return;
  await rebuildFor(event, [event.params.uid]);
});

/** The members of a group changed: the accounts that joined or left are resolved again. */
export const accessOnGroupWritten = onDocumentWritten(documentTrigger(COLLECTIONS.groups.path), async (event) => {
  const before = new Set(texts(event.data?.before.get("memberUids")));
  const after = new Set(texts(event.data?.after.get("memberUids")));
  await rebuildFor(
    event,
    [...before, ...after].filter((uid) => before.has(uid) !== after.has(uid)),
  );
});

/**
 * A person changed in what the access document of its login follows: the login itself, or the
 * replications of the person's confirmed memberships.
 */
export const accessOnPersonWritten = onDocumentWritten(documentTrigger(COLLECTIONS.persons.path), async (event) => {
  const change = event.data;
  if (change === undefined) return;
  const before = text(change.before.get("userId"));
  const after = text(change.after.get("userId"));
  if (before === after && sameTexts(change.before.get("replicationIds"), change.after.get("replicationIds"))) return;
  await rebuildFor(event, [before, after]);
});

/** The overrides of a role changed: every account may hold the role, so every account is resolved again. */
export const accessOnRoleCapabilitiesWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.roleCapabilities.path),
  async (event) => {
    await rebuildAllAccess(firestore(), { at: new Date(event.time), logger, causationId: event.id });
  },
);

/** The system setting for the second factor changed: every account is resolved again. */
export const accessOnSystemSettingsWritten = onDocumentWritten(
  documentTrigger(COLLECTIONS.systemSettings.path),
  async (event) => {
    const change = event.data;
    if (change === undefined) return;
    const before = requireSecondFactorOf(change.before.data() ?? null);
    const after = requireSecondFactorOf(change.after.data() ?? null);
    if (before === after) return;
    await rebuildAllAccess(firestore(), { at: new Date(event.time), logger, causationId: event.id });
  },
);
