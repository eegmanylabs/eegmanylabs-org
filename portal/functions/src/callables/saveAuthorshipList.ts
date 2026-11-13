import {
  AUTHORSHIP_ENTRIES_MAX,
  type AuthorshipEntryDoc,
  authorshipEntryDocSchema,
  authorshipListDocSchema,
  COLLECTIONS,
  contributorDocSchema,
  entryChanged,
  entryConfirmation,
  orderEntries,
  PROGRAMME_SCOPE_KEY,
  parseStoredDocument,
  personDocSchema,
  replicationDocSchema,
  saveAuthorshipListContract,
  unitScopeKeys,
} from "@eegml/shared";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  touchedFields,
  writeAudit,
} from "../framework";
import { readManuscript, requireNotArchived, requireOutputManager } from "../scientific/model";

/**
 * Saves the authorship list of a manuscript (requirement R12.9), for a holder of
 * `replications.manage` for its replication: the ordering rule the list follows, its status and
 * every entry, in order within each kind.
 *
 * Each person appears once and exists in the directory, and an entry prepared from a row of an
 * imported contributor table names a row of the same replication. An entry whose content
 * changes asks its person for a new answer, and one that stays as it was keeps its answer. A
 * person left out of the list is removed from it. A list is final only while every person on it
 * has confirmed their entry, and a save names the revision it edited, so two leads never
 * overwrite each other's work unseen. Positions are stored as the rule places people (the
 * replication's leads first under `leadsFirstThenAlphabetical`), so a change of rule that moves
 * someone asks them again, and a save that changes the rule or its note cannot make a list final.
 */
export const saveAuthorshipList = defineCallable(saveAuthorshipListContract, {
  handler: async (input, context) => {
    const { db } = context;
    const at = context.clock.now();
    const people = input.entries.map((entry) => entry.personId);
    if (new Set(people).size !== people.length) {
      throw new AppError("invalid-argument", "Name each person once: as an author or in the acknowledgements.");
    }
    if (input.entries.length > AUTHORSHIP_ENTRIES_MAX) {
      throw new AppError("invalid-argument", `A list holds at most ${AUTHORSHIP_ENTRIES_MAX} people.`);
    }
    if (input.orderingRule === "custom" && input.orderingNote === null) {
      throw new AppError("invalid-argument", "State the ordering rule in the note.");
    }
    return db.runTransaction(async (transaction) => {
      const access = await readAccessDocument(db, context.uid, transaction);
      const manuscript = await readManuscript(db, transaction, input.manuscriptId);
      const replicationId = manuscript.data.replicationId ?? null;
      requireOutputManager(context, access, replicationId);
      requireNotArchived(manuscript.data, "output");

      const listReference = db.doc(COLLECTIONS.authorshipLists.docPath(input.manuscriptId));
      const stored = (await transaction.get(listReference)).data();
      const parsedList = stored === undefined ? null : parseStoredDocument(authorshipListDocSchema, stored);
      if (parsedList !== null && !parsedList.success) throw parsedList.error;
      const list = parsedList;
      const revision = list === null ? 0 : list.data.revision;
      if (input.expectedRevision !== revision) {
        throw new AppError(
          "failed-precondition",
          "Someone saved this list after you opened it. Reload it to see their changes, then make yours again.",
        );
      }

      const existing = new Map<string, AuthorshipEntryDoc>();
      for (const snapshot of (
        await transaction.get(db.collection(COLLECTIONS.authorshipEntries.collectionPath(input.manuscriptId)))
      ).docs) {
        const parsed = parseStoredDocument(authorshipEntryDocSchema, snapshot.data());
        if (parsed.success) existing.set(snapshot.id, parsed.data);
      }
      for (const entry of input.entries) {
        const person = parseStoredDocument(
          personDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.persons.docPath(entry.personId)))).data(),
        );
        if (!person.success || person.data.archivedAt !== null) {
          throw new AppError("invalid-argument", `${entry.displayName} is not in the directory.`);
        }
        if (entry.contributorId !== null) {
          const row = parseStoredDocument(
            contributorDocSchema,
            (await transaction.get(db.doc(COLLECTIONS.contributors.docPath(entry.contributorId)))).data(),
          );
          if (!row.success || row.data.replicationId !== replicationId) {
            throw new AppError(
              "invalid-argument",
              `The contributor row of ${entry.displayName} is not one of this replication's contributor tables.`,
            );
          }
        }
      }

      const scope = {
        replicationId,
        laboratoryId: null,
        scopeKeys: replicationId === null ? [PROGRAMME_SCOPE_KEY] : unitScopeKeys(replicationId, null),
      };
      // The stored position is the place the person holds under the list's rule, so the order a
      // person confirms is the order every reader and the journal export see, and a change of
      // rule that moves someone changes their entry and asks them again.
      const leads = new Set<string>();
      if (replicationId !== null) {
        const replication = parseStoredDocument(
          replicationDocSchema,
          (await transaction.get(db.doc(COLLECTIONS.replications.docPath(replicationId)))).data(),
        );
        if (replication.success) for (const personId of replication.data.leadPersonIds) leads.add(personId);
      }
      const placeOf = new Map<string, number>();
      for (const kind of ["author", "acknowledgement"] as const) {
        const ofKind = input.entries
          .filter((entry) => entry.kind === kind)
          .map((entry, index) => ({ personId: entry.personId, displayName: entry.displayName, position: index + 1 }));
        for (const [index, entry] of orderEntries(ofKind, input.orderingRule, (item) =>
          leads.has(item.personId),
        ).entries()) {
          placeOf.set(entry.personId, index + 1);
        }
      }
      const positions = { author: 0, acknowledgement: 0 };
      const next = input.entries.map((entry) => {
        positions[entry.kind] += 1;
        const content = {
          kind: entry.kind,
          position: placeOf.get(entry.personId) ?? positions[entry.kind],
          displayName: entry.displayName,
          affiliations: entry.affiliations,
          ...(entry.orcid === null ? {} : { orcid: entry.orcid }),
          creditRoles: entry.creditRoles,
          contributionRoles: entry.contributionRoles,
          isCorresponding: entry.isCorresponding,
        };
        const before = existing.get(entry.personId);
        const changed =
          before === undefined || entryChanged(before, content as Pick<AuthorshipEntryDoc, keyof typeof content>);
        return { entry, content, before, changed };
      });
      if (positions.author === 0 && input.status !== "draft") {
        throw new AppError("invalid-argument", "Name at least one author before the list is reviewed.");
      }
      const storedRule = list?.success === true ? list.data.orderingRule : null;
      const storedNote = list?.success === true ? (list.data.orderingNote ?? null) : null;
      const ruleChanged = list !== null && (storedRule !== input.orderingRule || storedNote !== input.orderingNote);
      if (ruleChanged && input.orderingRule === "custom") {
        // Under a custom rule the note is the rule, so a change of it asks everyone again.
        for (const item of next) item.changed = true;
      }
      if (input.status === "final" && ruleChanged) {
        throw new AppError(
          "failed-precondition",
          "A change of the ordering rule is reviewed before the list is final. Save the list for review first.",
        );
      }
      if (input.status === "final") {
        const unconfirmed = next.filter(
          ({ before, changed }) => changed || before === undefined || entryConfirmation(before) !== "confirmed",
        );
        if (unconfirmed.length > 0) {
          throw new AppError(
            "failed-precondition",
            `The list is final only once everyone has confirmed their entry. Waiting for: ${unconfirmed
              .map(({ entry }) => entry.displayName)
              .join(", ")}.`,
          );
        }
      }
      const removed = [...existing.keys()].filter((personId) => !people.includes(personId));

      const auditEventId = writeAudit(
        transaction,
        {
          action: "authorship.saved",
          actor: { kind: "user", uid: context.uid },
          entityType: "manuscript",
          entityId: input.manuscriptId,
          changes: [
            { field: "revision", before: revision, after: revision + 1 },
            { field: "status", before: list?.success === true ? list.data.status : null, after: input.status },
            { field: "orderingRule", before: storedRule, after: input.orderingRule },
            ...(ruleChanged ? [{ field: "orderingNote", before: storedNote, after: input.orderingNote }] : []),
            { field: "changedEntries", after: next.filter((item) => item.changed).map((item) => item.entry.personId) },
            { field: "removedEntries", after: removed },
          ],
          at,
        },
        db,
      );
      const stamp = callerStamp(context.uid, at, auditEventId);
      transaction.set(
        listReference,
        authorshipListDocSchema.parse({
          ...createdFields("authorshipLists", stamp),
          ...(list?.success === true ? { createdAt: list.data.createdAt, createdBy: list.data.createdBy } : {}),
          manuscriptId: input.manuscriptId,
          orderingRule: input.orderingRule,
          ...(input.orderingNote === null ? {} : { orderingNote: input.orderingNote }),
          status: input.status,
          revision: revision + 1,
          preparedBy: context.uid,
          ...scope,
        }),
      );
      for (const { entry, content, before, changed } of next) {
        const reference = db.doc(COLLECTIONS.authorshipEntries.docPath(input.manuscriptId, entry.personId));
        if (before !== undefined && !changed) {
          // The comparison covers the position under the rule, so an entry that is unchanged
          // stands where its person confirmed it and stays as it is.
          continue;
        }
        transaction.set(
          reference,
          authorshipEntryDocSchema.parse({
            ...createdFields("authorshipEntries", stamp),
            ...(before === undefined ? {} : { createdAt: before.createdAt, createdBy: before.createdBy }),
            ...touchedFields(stamp),
            manuscriptId: input.manuscriptId,
            personId: entry.personId,
            contributorId: entry.contributorId,
            ...content,
            entryRevision: (before?.entryRevision ?? 0) + 1,
            confirmation: { status: "pending", revision: 0, respondedAt: null },
            ...scope,
          }),
        );
      }
      for (const personId of removed) {
        transaction.delete(db.doc(COLLECTIONS.authorshipEntries.docPath(input.manuscriptId, personId)));
      }
      return { revision: revision + 1 };
    });
  },
});
