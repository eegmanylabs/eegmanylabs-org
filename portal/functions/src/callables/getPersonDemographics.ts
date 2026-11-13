import {
  COLLECTIONS,
  capabilityGrantId,
  consentInForce,
  getDemographicAggregatesContract,
  getPersonDemographicsContract,
  type PersonDemographics,
  PROGRAMME_KEY,
  parseStoredDocument,
  personDemographicsDocSchema,
  releaseDemographicCounts,
  SMALL_CELL_THRESHOLD,
  SPECIAL_CATEGORY_FIELDS,
} from "@eegml/shared";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import {
  AppError,
  defineCallable,
  NOT_ALLOWED_MESSAGE,
  readAccessDocument,
  requireCapability,
  withheldChanges,
  writeAudit,
} from "../framework";
import { grantInForce } from "../people/demographics-grant";
import { consentsInForce } from "../people/demographics-values";

/**
 * Serves the special-category data of one person: gender and ethnicity (decision D-006 and
 * docs/SECURITY.md, section 2). No security rule lets any client read the document, so this
 * function is the only route to it.
 *
 * | Caller                    | Is served when                                                       |
 * |---------------------------|----------------------------------------------------------------------|
 * | The person concerned      | Their account is the one linked to the person                        |
 * | Anybody else              | The access document confers `demographics.read`, a named grant of it to the caller is neither revoked nor expired, and the second factor is satisfied |
 *
 * Every other reader needs the named grant, programme administrators included, and is served
 * values only while the person's consent is in force (shared/src/governance/demographics-consent.ts):
 * without it nothing is held, and the reader is told so. Each call writes an audit entry in the
 * transaction that reads the data: who read whose record, and which fields were served, never a
 * value. Nothing of the data is logged.
 */
export const getPersonDemographics = defineCallable(getPersonDemographicsContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const personReference = db.doc(COLLECTIONS.persons.docPath(input.personId));
    const demographicsReference = db.doc(COLLECTIONS.personDemographics.docPath(input.personId));
    const grantReference = db.doc(COLLECTIONS.capabilityGrants.docPath(capabilityGrantId(uid, "demographics.read")));
    const consentReference = db.doc(COLLECTIONS.personDemographicsConsent.docPath(input.personId));

    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, uid, transaction);
      const [person, grantSnapshot, consent] = await transaction.getAll(
        personReference,
        grantReference,
        consentReference,
      );
      const own = person?.exists === true && person.get("userId") === uid && !access.suspended;
      if (!own) {
        requireCapability(context, access, "demographics.read", "programme");
        if (!grantInForce(grantSnapshot, at)) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);
        if (person?.exists !== true) throw new AppError("not-found", "This person does not exist.");
      }

      const snapshot = await transaction.get(demographicsReference);
      const served = snapshot.exists && (own || consentInForce(consent?.data()));
      const stored = served ? parseStoredDocument(personDemographicsDocSchema, snapshot.data()) : null;
      if (stored !== null && !stored.success)
        throw new Error("A stored demographics document does not fit its schema.");
      let demographics: PersonDemographics | null = null;
      if (stored !== null) {
        const values: Record<string, string> = {};
        for (const field of SPECIAL_CATEGORY_FIELDS) {
          const value = stored.data[field];
          if (value !== undefined) values[field] = value;
        }
        demographics = {
          ...values,
          recordedAt: stored.data.recordedAt.toDate().toISOString(),
          ...(stored.data.confirmedAt === undefined
            ? {}
            : { confirmedAt: stored.data.confirmedAt.toDate().toISOString() }),
        };
      }

      writeAudit(
        transaction,
        {
          action: "demographics.read",
          actor: { kind: "user", uid },
          entityType: "person",
          entityId: input.personId,
          changes: withheldChanges(
            demographics === null
              ? []
              : Object.keys(demographics).filter((field) => field !== "recordedAt" && field !== "confirmedAt"),
          ),
          at,
        },
        db,
      );
      return { personId: input.personId, demographics };
    });
  },
});

/** The text that stands for a person with nothing recorded in a field. */
const NOT_RECORDED = "Not recorded";

/** The most people of one scope that are counted. */
const SCOPE_PEOPLE_MAX = 5_000;
/** The most overlapping scopes checked for one release. A scope with more is withheld. */
const OVERLAP_SCOPES_MAX = 100;
const AUDIT_BATCH = 400;

type ScopeType = "programme" | "replication" | "laboratory";

/**
 * Serves counts of one special-category field for the people of a scope, for the analysis views
 * (requirement R15.10). Only the values of a person whose consent is in force are counted; anyone
 * else counts as "Not recorded", so a withdrawal leaves every count on its next computation. It is the second route of this audited function and takes the same
 * authorisation as the reading of another person's data: `demographics.read`, a named grant of
 * it that is neither revoked nor expired, and the second factor, programme administrators
 * included. Nobody is served their own record this way. What is released follows
 * `releaseDemographicCounts`: nothing for a scope of fewer people than `SMALL_CELL_THRESHOLD`,
 * suppressed groups folded into one unnamed cell, no value named unless two values reach the
 * threshold, and neither the people nor the total wherever a group is suppressed.
 *
 * Two releases can be subtracted from each other (docs/SECURITY.md, section 2):
 *
 * | Attack                                   | Defence |
 * |------------------------------------------|---------|
 * | Two overlapping scopes read at once: a replication and a laboratory within it, two replications sharing laboratories, the programme and one unit | Every laboratory and replication that a person of the scope belongs to (every one, for the programme) is compared with the scope. When either side of the difference holds between one and `SMALL_CELL_THRESHOLD - 1` people with a recorded value and the other scope could itself be released, nothing is released and `overlapWithheld` says so |
 * | The same scope read before and after one person joins | Every release writes, beside the entry for the read, one entry for each person whose recorded value it counted (`demographics.aggregateIncluded`, no value), so that the person's trail shows the read as a direct read would |
 *
 * No entry names a value or a count. Nothing of the data is logged.
 */
export const getDemographicAggregates = defineCallable(getDemographicAggregatesContract, {
  handler: async (input, context) => {
    const { uid, db } = context;
    const at = context.clock.now();
    const grantReference = db.doc(COLLECTIONS.capabilityGrants.docPath(capabilityGrantId(uid, "demographics.read")));
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "demographics.read", "programme");
    if (!grantInForce(await grantReference.get(), at)) throw new AppError("permission-denied", NOT_ALLOWED_MESSAGE);

    const persons = db.collection(COLLECTIONS.persons.collectionPath());
    const membersOf = async (scopeType: ScopeType, scopeId: string): Promise<QueryDocumentSnapshot[]> => {
      const query =
        scopeType === "replication"
          ? persons.where("replicationIds", "array-contains", scopeId)
          : scopeType === "laboratory"
            ? persons.where("laboratoryIds", "array-contains", scopeId)
            : persons;
      return (await query.limit(SCOPE_PEOPLE_MAX).get()).docs.filter((document) => document.get("archivedAt") === null);
    };
    const people = await membersOf(input.scopeType, input.scopeId);

    // The category of each person read so far; undefined where nothing is recorded.
    const categories = new Map<string, string | undefined>();
    const readCategories = async (ids: readonly string[]) => {
      const missing = ids.filter((id) => !categories.has(id));
      for (let start = 0; start < missing.length; start += 300) {
        const chunk = missing.slice(start, start + 300);
        const consenting = await consentsInForce(db, chunk);
        const special = await db.getAll(...chunk.map((id) => db.doc(COLLECTIONS.personDemographics.docPath(id))));
        special.forEach((snapshot, index) => {
          const counted = snapshot.exists && consenting.has(chunk[index] ?? "");
          const parsed = counted ? parseStoredDocument(personDemographicsDocSchema, snapshot.data()) : null;
          const value = parsed?.success === true ? parsed.data[input.field] : undefined;
          categories.set(chunk[index] ?? "", value === undefined || value === "" ? undefined : value.slice(0, 100));
        });
      }
    };
    await readCategories(people.map((document) => document.id));
    const counts: Record<string, number> = {};
    for (const document of people) {
      const category = categories.get(document.id) ?? NOT_RECORDED;
      counts[category] = (counts[category] ?? 0) + 1;
    }
    let release = releaseDemographicCounts(counts, new Set([NOT_RECORDED]));

    // The overlapping scopes, and whether any of them differs from this one by a few people.
    const recorded = (ids: Iterable<string>) => [...ids].filter((id) => categories.get(id) !== undefined);
    const scopeIds = new Set(people.map((document) => document.id));
    const overlapping: { scopeType: ScopeType; scopeId: string }[] = [];
    const seen = new Set<string>();
    for (const document of people) {
      for (const [scopeType, field] of [
        ["laboratory", "laboratoryIds"],
        ["replication", "replicationIds"],
      ] as const) {
        const ids: unknown = document.get(field);
        for (const id of Array.isArray(ids) ? ids : []) {
          if (typeof id !== "string" || (scopeType === input.scopeType && id === input.scopeId)) continue;
          if (seen.has(`${scopeType}/${id}`)) continue;
          seen.add(`${scopeType}/${id}`);
          overlapping.push({ scopeType, scopeId: id });
        }
      }
    }
    if (input.scopeType !== "programme") overlapping.push({ scopeType: "programme", scopeId: PROGRAMME_KEY });
    let overlapWithheld = false;
    if (release.cells.length > 0) {
      const inMemory = input.scopeType === "programme";
      if (!inMemory && overlapping.length > OVERLAP_SCOPES_MAX) overlapWithheld = true;
      for (const other of overlapWithheld ? [] : overlapping) {
        const members = inMemory
          ? people.filter((document) => {
              const ids: unknown = document.get(other.scopeType === "laboratory" ? "laboratoryIds" : "replicationIds");
              return Array.isArray(ids) && ids.includes(other.scopeId);
            })
          : await membersOf(other.scopeType, other.scopeId);
        const otherIds = new Set(members.map((document) => document.id));
        await readCategories([...otherIds]);
        // A scope too small to be released on its own gives nothing to subtract.
        if (members.length < SMALL_CELL_THRESHOLD) continue;
        const onlyHere = recorded([...scopeIds].filter((id) => !otherIds.has(id))).length;
        const onlyThere = recorded([...otherIds].filter((id) => !scopeIds.has(id))).length;
        const small = (count: number) => count > 0 && count < SMALL_CELL_THRESHOLD;
        if (small(onlyHere) || small(onlyThere)) {
          overlapWithheld = true;
          break;
        }
      }
      if (overlapWithheld) release = { people: null, cells: [], total: null };
    }

    const included = release.cells.length === 0 ? [] : recorded(scopeIds);
    const entries = [
      {
        action: "demographics.aggregateRead" as const,
        entityType: input.scopeType,
        entityId: input.scopeId,
      },
      ...included.map((personId) => ({
        action: "demographics.aggregateIncluded" as const,
        entityType: "person" as const,
        entityId: personId,
      })),
    ];
    for (let start = 0; start < entries.length; start += AUDIT_BATCH) {
      const batch = db.batch();
      for (const entry of entries.slice(start, start + AUDIT_BATCH)) {
        writeAudit(batch, { ...entry, actor: { kind: "user", uid }, changes: withheldChanges([input.field]), at }, db);
      }
      await batch.commit();
    }
    return {
      threshold: SMALL_CELL_THRESHOLD,
      people: release.people,
      cells: release.cells.slice(0, 100),
      total: release.total,
      overlapWithheld,
    };
  },
});
