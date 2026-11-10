import {
  type AuditEvent,
  auditEventSchema,
  type CallableInput,
  COLLECTIONS,
  type ListAuditEventsOutput,
  type ListedAuditEvent,
  listAuditEventsContract,
  parseStoredDocument,
} from "@eegml/shared";
import { FieldPath, type Firestore, type Query, Timestamp } from "firebase-admin/firestore";
import { defineCallable, readAccessDocument, requireCapability } from "../framework";

/** How many entries one read of the trail takes, and how many one call reads at most. */
const BATCH = 100;
export const AUDIT_SCAN_MAX = 1_000;

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** A stored value as JSON. An instant becomes ISO 8601 text, and anything without a JSON form becomes text. */
export function jsonOf(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonOf);
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, jsonOf(inner)]));
  }
  return String(value);
}

type Filters = Pick<
  CallableInput<typeof listAuditEventsContract>,
  "actorUid" | "entityType" | "action" | "from" | "to"
>;

/**
 * The query of the trail, newest first. One equality filter goes to Firestore, which an index
 * of firestore.indexes.json serves together with the order by time. The others are applied to
 * what it returns, so three indexes serve every combination.
 */
function trailQuery(db: Firestore, filters: Filters): Query {
  let query: Query = db.collection(COLLECTIONS.auditEvents.collectionPath());
  if (filters.actorUid !== undefined) query = query.where("actorUid", "==", filters.actorUid);
  else if (filters.entityType !== undefined) query = query.where("entityType", "==", filters.entityType);
  else if (filters.action !== undefined) query = query.where("action", "==", filters.action);
  if (filters.from !== undefined) query = query.where("createdAt", ">=", Timestamp.fromDate(new Date(filters.from)));
  if (filters.to !== undefined) query = query.where("createdAt", "<=", Timestamp.fromDate(new Date(filters.to)));
  return query.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");
}

const matches = (event: AuditEvent, filters: Filters) =>
  (filters.actorUid === undefined || event.actorUid === filters.actorUid) &&
  (filters.entityType === undefined || event.entityType === filters.entityType) &&
  (filters.action === undefined || event.action === filters.action);

/** The names of the acting accounts: the linked person's, or else the one the account gives itself. */
async function actorNames(db: Firestore, uids: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (uids.length === 0) return names;
  const users = await db.getAll(...uids.map((uid) => db.doc(COLLECTIONS.users.docPath(uid))));
  const personIds = users.map((user) => user.get("personId"));
  const linked = personIds.filter((id): id is string => typeof id === "string" && id !== "");
  const persons =
    linked.length === 0 ? [] : await db.getAll(...linked.map((id) => db.doc(COLLECTIONS.persons.docPath(id))));
  const personName = new Map(persons.map((person) => [person.id, person.get("displayName")] as const));
  users.forEach((user, index) => {
    const fromPerson: unknown = personName.get(personIds[index]);
    const own: unknown = user.get("displayName");
    const name = typeof fromPerson === "string" && fromPerson !== "" ? fromPerson : own;
    if (typeof name === "string" && name !== "") names.set(user.id, name);
  });
  return names;
}

/**
 * Reads the audit trail, newest first. Capability: `audit.read`, for the programme, with the
 * second factor wherever the caller's access document requires one (docs/SECURITY.md, section 6).
 *
 * No security rule opens the audit collection to any client, so this function is the only way
 * to consult it. A value that an entry withholds stays withheld. One call reads at most
 * `AUDIT_SCAN_MAX` entries: when the filters are narrow, a page can hold fewer entries than
 * asked for and still name a following page. It changes nothing.
 */
export const listAuditEvents = defineCallable(listAuditEventsContract, {
  handler: async (input, context): Promise<ListAuditEventsOutput> => {
    const { db } = context;
    requireCapability(context, await readAccessDocument(db, context.uid), "audit.read", "programme");

    const base = trailQuery(db, input);
    const found: { readonly id: string; readonly event: AuditEvent }[] = [];
    let cursor: readonly [Timestamp, string] | null =
      input.after === undefined ? null : [Timestamp.fromDate(new Date(input.after.at)), input.after.eventId];
    let scanned = 0;
    let exhausted = false;
    while (found.length < input.limit && scanned < AUDIT_SCAN_MAX) {
      const batch = await (cursor === null ? base : base.startAfter(...cursor)).limit(BATCH).get();
      for (const document of batch.docs) {
        scanned += 1;
        const createdAt: unknown = document.get("createdAt");
        if (createdAt instanceof Timestamp) cursor = [createdAt, document.id];
        const parsed = parseStoredDocument(auditEventSchema, document.data());
        if (!parsed.success) {
          context.logger.warn("an audit entry does not fit its schema", { eventId: document.id });
          continue;
        }
        if (matches(parsed.data, input)) found.push({ id: document.id, event: parsed.data });
        if (found.length === input.limit) break;
      }
      if (batch.size < BATCH && found.length < input.limit) {
        exhausted = true;
        break;
      }
    }

    const names = await actorNames(db, [
      ...new Set(found.flatMap(({ event }) => (event.actorUid === null ? [] : [event.actorUid]))),
    ]);
    const events: ListedAuditEvent[] = found.map(({ id, event }) => ({
      eventId: id,
      at: event.createdAt.toDate().toISOString(),
      actorUid: event.actorUid,
      actorKind: event.actorKind,
      actorName: event.actorUid === null ? null : (names.get(event.actorUid) ?? null),
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      documentPath: event.documentPath,
      changes: event.changes.map((change) => ({
        field: change.field,
        ...(change.withheld === true ? { withheld: true as const } : {}),
        ...("before" in change ? { before: jsonOf(change.before) } : {}),
        ...("after" in change ? { after: jsonOf(change.after) } : {}),
      })),
    }));
    return {
      events,
      next: exhausted || cursor === null ? null : { at: cursor[0].toDate().toISOString(), eventId: cursor[1] },
    };
  },
});
