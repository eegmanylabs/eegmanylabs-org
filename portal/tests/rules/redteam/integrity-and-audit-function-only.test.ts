// Red-team attacks on what only trusted code may write: recruitment reports, status history,
// the status of a replication, page updates, the audit trail, outbound mail, the access
// documents and everything else that the registry gives to functions or keeps closed until its
// feature is built. Each of the five attackers tries to create, change, replace and remove
// these documents with a well-shaped request, alone and inside a batch.
//
// Every test states the secure behaviour: the request is refused and the stored document stays
// as it was.
// Everything here is synthetic: fictitious accounts, people, studies and laboratories on the
// example.org domain.
import { COLLECTION_ENTRIES, type CollectionEntry, unitScopeKeys } from "@eegml/shared";
import { assertFails } from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { describe, expect, it } from "vitest";
import { fixtureOf, pathOf, placeholderIds } from "../seed";
import {
  createdBy,
  MEMBER_PERSON,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
  OWNER_UID,
  STORED_AT,
  updatedBy,
} from "../world";
import { ATTACKERS, arena, LABORATORY, PARTICIPATION, REPLICATION } from "./integrity-and-audit-support";

const lab = arena("function-only");

const UNIT = {
  replicationId: OWN_REPLICATION,
  laboratoryId: OWN_LABORATORY,
  scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY),
};

type Attacks = Readonly<Record<string, () => Promise<unknown>>>;

/** Makes every attack and returns the labels of those that were not refused. */
async function accepted(attacks: Attacks): Promise<string[]> {
  const labels: string[] = [];
  for (const [label, attack] of Object.entries(attacks)) {
    try {
      await assertFails(attack());
    } catch (error) {
      labels.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return labels;
}

/** Every entry that no client may write: function-only by tier, or closed until its feature is built. */
const CLOSED: readonly CollectionEntry[] = COLLECTION_ENTRIES.filter(
  (entry) => entry.write.mode === "function" || entry.enforcement === "deniedUntilBuilt",
);

const storedPathOf = (entry: CollectionEntry) => pathOf(entry, fixtureOf(entry.key)?.ids ?? placeholderIds(entry));

describe("every collection that only trusted code writes, and every collection that is not built yet", () => {
  it("covers the collections that the attack is about", () => {
    const keys = CLOSED.map((entry) => entry.key);
    for (const key of [
      "recruitmentReports",
      "statusHistory",
      "pageVersions",
      "pagePermissions",
      "auditEvents",
      "access",
      "roleAssignments",
      "personDemographics",
      "personContact",
      "searchIndex",
      "mail",
    ]) {
      expect(keys, key).toContain(key);
    }
    expect(CLOSED.length).toBeGreaterThan(80);
  });

  it.each([...ATTACKERS, "admin"] as const)(
    "refuses every create, change, replacement and removal to the caller: %s",
    async (attacker) => {
      const db = lab.db(attacker);
      const uid = lab.uid(attacker);
      const before = new Map<string, Record<string, unknown> | null>();
      const attacks: Record<string, () => Promise<unknown>> = {};
      for (const entry of CLOSED) {
        const path = storedPathOf(entry);
        const current = await lab.stored(path);
        before.set(path, current);
        const appendOnly = entry.flags.appendOnly;
        attacks[`${entry.key}: a change with honest stamps`] = () =>
          updateDoc(doc(db, path), { redTeam: true, ...updatedBy(uid) });
        attacks[`${entry.key}: a change with no stamps`] = () => updateDoc(doc(db, path), { redTeam: true });
        attacks[`${entry.key}: a set with merge`] = () =>
          setDoc(doc(db, path), { redTeam: true, ...updatedBy(uid) }, { merge: true });
        attacks[`${entry.key}: a replacement`] = () =>
          setDoc(doc(db, path), { ...current, ...createdBy(uid, appendOnly) });
        attacks[`${entry.key}: a removal`] = () => deleteDoc(doc(db, path));
        // A document with a fixed name has no sibling: a new one sits beneath another parent.
        if (entry.identifier.kind !== "fixed") {
          attacks[`${entry.key}: a new document beside the stored one`] = () =>
            setDoc(doc(db, `${path}-red-team`), { ...current, ...createdBy(uid, appendOnly) });
        }
      }
      expect(await accepted(attacks)).toEqual([]);
      for (const [path, current] of before) expect(await lab.stored(path), path).toEqual(current);
    },
    180_000,
  );
});

describe.each(ATTACKERS)("crafted attacks on accountability by the attacker: %s", (attacker) => {
  const db = () => lab.db(attacker);
  const uid = () => lab.uid(attacker);
  const appended = () => createdBy(uid(), true);
  const stamped = () => updatedBy(uid());

  it("neither files, corrects, voids nor removes a recruitment report", async () => {
    const report = {
      participationId: OWN_PARTICIPATION,
      ...UNIT,
      asOfDate: "2026-11-01",
      reportKind: "cumulative",
      basis: "labReported",
      entryKind: "new",
      counts: { main: { tested: 9_999, usable: 9_999 } },
      exclusions: [],
      reportedBy: uid(),
      source: "manual",
      dataOrigin: "live",
    };
    const stored = "recruitmentReports/record-1";
    expect(
      await accepted({
        "a new report": () => setDoc(doc(db(), "recruitmentReports/report-red-team"), { ...report, ...appended() }),
        "a centrally verified report": () =>
          setDoc(doc(db(), "recruitmentReports/report-verified"), {
            ...report,
            basis: "centrallyVerified",
            verifiesReportId: "record-1",
            ...appended(),
          }),
        "a report with a negative count": () =>
          setDoc(doc(db(), "recruitmentReports/report-negative"), {
            ...report,
            counts: { main: { tested: -40 } },
            ...appended(),
          }),
        "a report with a fractional count": () =>
          setDoc(doc(db(), "recruitmentReports/report-fraction"), {
            ...report,
            counts: { main: { tested: 0.5 } },
            ...appended(),
          }),
        "a report in the name of someone else": () =>
          setDoc(doc(db(), "recruitmentReports/report-forged"), { ...report, reportedBy: OWNER_UID, ...appended() }),
        "a report as a record of an import": () =>
          setDoc(doc(db(), "recruitmentReports/report-imported"), {
            ...report,
            source: "import",
            dataOrigin: "importedHistorical",
            ...appended(),
          }),
        "a change to the counts of a stored report": () =>
          updateDoc(doc(db(), stored), { "counts.main.tested": 9_999, ...stamped() }),
        "a stored report turned into a void one": () => updateDoc(doc(db(), stored), { entryKind: "void" }),
        "a stored report replaced": () => setDoc(doc(db(), stored), { ...report, ...appended() }),
        "a stored report merged": () => setDoc(doc(db(), stored), { counts: {} }, { merge: true }),
        "a stored report removed": () => deleteDoc(doc(db(), stored)),
        "a planned pause for the laboratory": () =>
          setDoc(doc(db(), "plannedPauses/pause-red-team"), {
            participationId: OWN_PARTICIPATION,
            ...UNIT,
            startsOn: "2026-12-01",
            endsOn: "2027-12-01",
            reason: "A pause that hides a shortfall.",
            ...createdBy(uid()),
          }),
      }),
    ).toEqual([]);
  });

  it("changes no status and writes no status history", async () => {
    const entry = {
      entityType: "replication",
      entityId: OWN_REPLICATION,
      fromStatusKey: "planning",
      toStatusKey: "published",
      effectiveAt: STORED_AT,
      recordedAt: serverTimestamp(),
      changedBy: uid(),
      source: "manual",
      replicationId: OWN_REPLICATION,
      laboratoryId: null,
      scopeKeys: [`rep:${OWN_REPLICATION}`, "members"],
    };
    const both = () => {
      const batch = writeBatch(db());
      batch.set(doc(db(), "statusHistory/history-red-team"), { ...entry, ...appended() });
      batch.update(doc(db(), REPLICATION), {
        statusKey: "published",
        statusHistoryId: "history-red-team",
        ...stamped(),
      });
      return batch.commit();
    };
    expect(
      await accepted({
        "a history entry of its own": () =>
          setDoc(doc(db(), "statusHistory/history-red-team"), { ...entry, ...appended() }),
        "a history entry in the name of an administrator": () =>
          setDoc(doc(db(), "statusHistory/history-forged"), { ...entry, changedBy: "uid-admin", ...appended() }),
        "a history entry said to come from an import": () =>
          setDoc(doc(db(), "statusHistory/history-imported"), { ...entry, source: "import", ...appended() }),
        "a change to a stored history entry": () =>
          updateDoc(doc(db(), "statusHistory/history-1"), { toStatusKey: "published", ...stamped() }),
        "a stored history entry dated back": () =>
          updateDoc(doc(db(), "statusHistory/history-1"), { effectiveAt: new Date("2019-01-01T00:00:00Z") }),
        "a stored history entry removed": () => deleteDoc(doc(db(), "statusHistory/history-1")),
        "the status of the replication": () =>
          updateDoc(doc(db(), REPLICATION), { statusKey: "published", ...stamped() }),
        "the status of the replication, by a set with merge": () =>
          setDoc(doc(db(), REPLICATION), { statusKey: "published", ...stamped() }, { merge: true }),
        "the status history that the replication names": () =>
          updateDoc(doc(db(), REPLICATION), { statusHistoryId: "history-1", ...stamped() }),
        "the status of the replication removed": () =>
          updateDoc(doc(db(), REPLICATION), { statusKey: null, ...stamped() }),
        "the status and its history entry in one batch": both,
        "the status of the participation": () =>
          updateDoc(doc(db(), PARTICIPATION), { status: "collectionComplete", ...stamped() }),
        "the status history that the participation names": () =>
          updateDoc(doc(db(), PARTICIPATION), { statusHistoryId: "history-1", ...stamped() }),
        "the status of a manuscript": () =>
          updateDoc(doc(db(), "manuscripts/manuscript-1"), { status: "published", ...stamped() }),
        "the status of a dataset": () =>
          updateDoc(doc(db(), "datasets/record-1"), { status: "validated", ...stamped() }),
        "the status of a task": () => updateDoc(doc(db(), "tasks/record-1"), { statusKey: "done", ...stamped() }),
      }),
    ).toEqual([]);
    expect((await lab.stored(REPLICATION))?.statusKey).toBe("planning");
    expect(await lab.stored("statusHistory/history-red-team")).toBeNull();
  });

  it("neither reads, writes, changes nor removes an entry of the audit trail", async () => {
    const event = {
      actorUid: OWNER_UID,
      actorKind: "user",
      action: "person.updated",
      documentPath: `persons/${OWNER_PERSON}`,
      entityType: "person",
      entityId: OWNER_PERSON,
      changes: [],
      context: {
        origin: "user",
        depth: 0,
        correlationId: null,
        causationId: null,
        requestId: null,
        ipHash: null,
        userAgent: null,
      },
    };
    expect(
      await accepted({
        "a read of an entry": () => getDoc(doc(db(), "auditEvents/event-1")),
        "a list of the trail": () => getDocs(query(collection(db(), "auditEvents"), limit(5))),
        "an entry that blames someone else": () =>
          setDoc(doc(db(), "auditEvents/event-red-team"), { ...event, ...appended() }),
        "an entry in the attacker's own name": () =>
          setDoc(doc(db(), "auditEvents/event-own"), { ...event, actorUid: uid(), ...appended() }),
        "a stored entry rewritten": () => updateDoc(doc(db(), "auditEvents/event-1"), { actorUid: "uid-nobody" }),
        "a stored entry emptied": () => setDoc(doc(db(), "auditEvents/event-1"), { ...event, changes: [] }),
        "a stored entry removed": () => deleteDoc(doc(db(), "auditEvents/event-1")),
        "an entry of the activity feed": () =>
          setDoc(doc(db(), "activity/event-red-team"), { ...event, ...appended() }),
        "a finding of the integrity checker removed": () =>
          deleteDoc(doc(db(), "integrityReports/run-1/findings/000001")),
        "a finding of the integrity checker rewritten": () =>
          updateDoc(doc(db(), "integrityReports/run-1/findings/000001"), { check: "none" }),
        "a report of the integrity checker cleared": () =>
          updateDoc(doc(db(), "integrityReports/run-1"), { counts: {}, ...stamped() }),
        "a line of an import log removed": () => deleteDoc(doc(db(), "importBatches/batch-1/log/000001")),
        "a recorded change of an import rewritten": () =>
          updateDoc(doc(db(), "importBatches/batch-1/changes/000001"), { after: { displayName: "Forged" } }),
        "a source record rewritten": () =>
          updateDoc(doc(db(), "sourceRecords/source-record-1"), { raw: { Name: "Forged" }, ...stamped() }),
        "a source record removed": () => deleteDoc(doc(db(), "sourceRecords/source-record-1")),
        "an outbound message of the portal": () =>
          setDoc(doc(db(), "mail/mail-red-team"), {
            toAddress: "owner.account@example.org",
            subject: "Your claim was approved",
            textBody: "Follow the link to confirm your account.",
            templateKey: "claimDecision",
            status: "queued",
            attempts: 0,
            sentAt: null,
            ...createdBy(uid()),
          }),
        "a notification for another user": () =>
          setDoc(doc(db(), `users/${OWNER_UID}/notifications/notification-red-team`), {
            uid: OWNER_UID,
            type: "roleDecision",
            entityType: "user",
            entityId: OWNER_UID,
            eventId: "event-red-team",
            payload: { message: "Your role was removed." },
            readAt: null,
            emailedAt: null,
            ...createdBy(uid()),
          }),
      }),
    ).toEqual([]);
  });

  it("neither edits a page update, a comment or a thread of someone else, nor writes one of its own", async () => {
    expect(
      await accepted({
        "a stored page update rewritten": () =>
          updateDoc(doc(db(), "pages/record-1/updates/record-1"), { update: "forged", ...stamped() }),
        "a stored page update removed": () => deleteDoc(doc(db(), "pages/record-1/updates/record-1")),
        "a page update of its own": () =>
          setDoc(doc(db(), "pages/record-1/updates/update-red-team"), {
            pageId: "record-1",
            authorUid: uid(),
            update: "AAAA",
            ...appended(),
          }),
        "a page update in the name of the author": () =>
          setDoc(doc(db(), "pages/record-1/updates/update-forged"), {
            pageId: "record-1",
            authorUid: OWNER_UID,
            update: "AAAA",
            ...appended(),
          }),
        "full access to the page for the attacker": () =>
          setDoc(doc(db(), `pages/record-1/permissions/user__${uid()}`), {
            pageId: "record-1",
            principalType: "user",
            principalId: uid(),
            level: "full",
            ...createdBy(uid()),
          }),
        "the title of the page": () => updateDoc(doc(db(), "pages/record-1"), { title: "Forged", ...stamped() }),
        "a stored version of the page removed": () => deleteDoc(doc(db(), "pages/record-1/versions/record-1")),
        "the comment of another author": () =>
          updateDoc(doc(db(), "threads/record-1/comments/record-1"), {
            body: "I agree with everything.",
            ...stamped(),
          }),
        "the comment of another author marked as deleted": () =>
          updateDoc(doc(db(), "threads/record-1/comments/record-1"), { deletedAt: serverTimestamp(), ...stamped() }),
        "the comment of another author removed": () => deleteDoc(doc(db(), "threads/record-1/comments/record-1")),
        "a comment in the name of another author": () =>
          setDoc(doc(db(), "threads/record-1/comments/comment-red-team"), {
            threadId: "record-1",
            authorUid: OWNER_UID,
            body: "Posted in your name.",
            ...createdBy(uid()),
          }),
        "a thread resolved": () =>
          updateDoc(doc(db(), "threads/record-1"), {
            status: "resolved",
            resolvedBy: uid(),
            resolvedAt: serverTimestamp(),
            ...stamped(),
          }),
        "a task linked to a parent that does not exist": () =>
          setDoc(doc(db(), "tasks/task-red-team"), {
            listId: "list-that-does-not-exist",
            title: "A task of no list",
            entityType: "replication",
            entityId: "GhostStudy1999",
            ...UNIT,
            ...createdBy(uid()),
          }),
        "a dataset of a participation that does not exist": () =>
          setDoc(doc(db(), "datasets/dataset-red-team"), {
            datasetKey: "dataset-red-team",
            participationId: "GhostStudy1999__lab-ghost",
            replicationId: "GhostStudy1999",
            laboratoryId: "lab-ghost",
            scopeKeys: ["rep:GhostStudy1999", "lab:lab-ghost"],
            ...createdBy(uid()),
          }),
        "an attachment": () =>
          setDoc(doc(db(), "attachments/attachment-red-team"), {
            entityType: "replication",
            entityId: OWN_REPLICATION,
            storagePath: `attachments/replication/${OWN_REPLICATION}/payload.html`,
            contentType: "text/html",
            sizeBytes: 12,
            ...UNIT,
            ...createdBy(uid()),
          }),
      }),
    ).toEqual([]);
  });

  it("grants itself nothing and claims nothing", async () => {
    const own = uid();
    expect(
      await accepted({
        "a programme role in its access document": () =>
          updateDoc(doc(db(), `access/${own}`), { programmeRoles: ["programme_admin"], ...stamped() }),
        "a capability in its access document": () =>
          setDoc(doc(db(), `access/${own}`), { capabilities: { rolesManage: ["programme"] } }, { merge: true }),
        "a lifted suspension flag of someone else": () =>
          updateDoc(doc(db(), "access/uid-suspended"), { suspended: false, ...stamped() }),
        "a role assignment": () =>
          setDoc(doc(db(), `roleAssignments/${own}__programme_admin__programme__programme`), {
            uid: own,
            role: "programme_admin",
            scopeType: "programme",
            scopeId: "programme",
            status: "active",
            grantedBy: own,
            grantedAt: serverTimestamp(),
            expiresAt: null,
            revokedBy: null,
            revokedAt: null,
            history: [],
            ...createdBy(own),
          }),
        "a grant to read demographics": () =>
          setDoc(doc(db(), `capabilityGrants/${own}__demographics.read`), {
            uid: own,
            capability: "demographics.read",
            grantedBy: own,
            grantedAt: serverTimestamp(),
            reason: "Self-service.",
            expiresAt: null,
            revokedBy: null,
            revokedAt: null,
            history: [],
            ...createdBy(own),
          }),
        "the sensitive capabilities of the core team": () =>
          updateDoc(doc(db(), "roleCapabilities/core_team"), {
            overrides: { rolesManage: true, demographicsRead: true, importsRollback: true },
            ...stamped(),
          }),
        "a record grant": () =>
          setDoc(doc(db(), `recordGrants/${own}__replication__${OWN_REPLICATION}`), {
            uid: own,
            entityType: "replication",
            entityId: OWN_REPLICATION,
            level: "edit",
            grantedBy: own,
            grantedAt: serverTimestamp(),
            expiresAt: null,
            revokedAt: null,
            ...createdBy(own),
          }),
        "a seat as manager of a group": () =>
          updateDoc(doc(db(), "groups/synthetic-working-group"), { [`roles.${own}`]: "manager", ...stamped() }),
        "its own login profile": () =>
          updateDoc(doc(db(), `users/${own}`), { mfaEnrolled: true, status: "active", ...stamped() }),
        "the login profile of someone else": () =>
          updateDoc(doc(db(), `users/${OWNER_UID}`), { status: "suspended", ...stamped() }),
        "an approved claim of a person": () =>
          setDoc(doc(db(), `accountClaims/${own}`), {
            uid: own,
            status: "approved",
            personId: OWNER_PERSON,
            submittedAt: serverTimestamp(),
            ...createdBy(own),
          }),
        "an approved claim of the laboratory": () =>
          setDoc(doc(db(), `labClaims/${own}__${OWN_LABORATORY}`), {
            laboratoryId: OWN_LABORATORY,
            uid: own,
            requestedRole: "coordinator",
            status: "approved",
            submittedAt: serverTimestamp(),
            ...createdBy(own),
          }),
        "an invitation": () =>
          setDoc(doc(db(), "invitations/invitation-red-team"), {
            email: "accomplice.account@example.org",
            personId: null,
            role: "programme_admin",
            scopeType: "programme",
            scopeId: "programme",
            tokenHash: "0".repeat(64),
            expiresAt: new Date("2099-01-01T00:00:00Z"),
            acceptedAt: null,
            invitedBy: own,
            revokedAt: null,
            ...createdBy(own),
          }),
        "the addresses of a person, which the claim flow trusts": () =>
          updateDoc(doc(db(), `persons/${OWNER_PERSON}/private/contact`), {
            emails: [
              { email: "accomplice.account@example.org", kind: "primary", verifiedAt: null, claimEligible: true },
            ],
            ...stamped(),
          }),
        "an entry of the address index": () =>
          setDoc(doc(db(), "personEmailIndex/ffffffffffffffffffff"), {
            personIds: [OWNER_PERSON],
            claimEligiblePersonIds: [OWNER_PERSON],
            ...createdBy(own),
          }),
        "an identity key": () =>
          updateDoc(doc(db(), "identityKeys/0123456789abcdef0123"), { entityIds: [MEMBER_PERSON], ...stamped() }),
        "the demographics of a person": () =>
          updateDoc(doc(db(), `persons/${OWNER_PERSON}/special/demographics`), {
            genderSource: "forged",
            ...stamped(),
          }),
        "a read of the demographics of a person": () =>
          getDoc(doc(db(), `persons/${OWNER_PERSON}/special/demographics`)),
        "a list of every special document": () => getDocs(query(collectionGroup(db(), "special"), limit(5))),
        "the demographics of a person removed": () =>
          deleteDoc(doc(db(), `persons/${OWNER_PERSON}/special/demographics`)),
        "the settings of the system": () =>
          updateDoc(doc(db(), "system/settings"), { maintenanceMode: true, ...stamped() }),
      }),
    ).toEqual([]);
  });

  it("writes nothing that trusted code derives or imports", async () => {
    expect(
      await accepted({
        "an equipment configuration of the laboratory": () =>
          updateDoc(doc(db(), `${LABORATORY}/equipment/configuration-1`), { channelCount: 256, ...stamped() }),
        "a new equipment configuration": () =>
          setDoc(doc(db(), `${LABORATORY}/equipment/configuration-red-team`), {
            laboratoryId: OWN_LABORATORY,
            name: "A booth that does not exist",
            isCurrent: true,
            validFrom: serverTimestamp(),
            validTo: null,
            supersedesId: null,
            ...createdBy(uid()),
          }),
        "a checklist item that no template holds": () =>
          setDoc(doc(db(), `${PARTICIPATION}/checklist/red-team`), {
            participationId: OWN_PARTICIPATION,
            templateKey: "onboarding",
            templateItemKey: "red-team",
            label: "Everything is fine",
            status: "done",
            completedBy: uid(),
            completedAt: serverTimestamp(),
            position: 1,
            ...UNIT,
            ...createdBy(uid()),
          }),
        "the recruitment summary of the replication": () =>
          updateDoc(doc(db(), `${REPLICATION}/summaries/recruitment`), {
            totals: { labReported: { main: { tested: 9_999 } } },
            ...stamped(),
          }),
        "an alias of the replication": () =>
          setDoc(doc(db(), `${REPLICATION}/aliases/bids__ffffffffffffffffffff`), {
            replicationId: OWN_REPLICATION,
            alias: "SomeoneElsesStudy",
            aliasFolded: "someoneelsesstudy",
            scheme: "bids",
            isCanonical: true,
            ...createdBy(uid()),
          }),
        "an entry of the alias index": () =>
          updateDoc(doc(db(), "studyAliasIndex/syntheticstudy"), {
            replicationIds: ["AnotherStudy1999"],
            ...stamped(),
          }),
        "a historical aggregate": () =>
          updateDoc(doc(db(), "historicalAggregates/nLabsSigned__source-record-1"), {
            valueNumeric: 9_999,
            ...stamped(),
          }),
        "an outreach contact": () =>
          updateDoc(doc(db(), "outreachContacts/contact-1"), { resultCategory: "accepted", ...stamped() }),
        "a source of imports": () => updateDoc(doc(db(), "sources/F"), { authority: "authoritative", ...stamped() }),
        "the address of a source": () =>
          updateDoc(doc(db(), "sources/F/private/location"), { url: "https://example.org/forged", ...stamped() }),
        "the state of an import batch": () =>
          updateDoc(doc(db(), "importBatches/batch-1"), { status: "rolledBack", ...stamped() }),
        "a reconciliation item resolved": () =>
          updateDoc(doc(db(), "reconciliationItems/fingerprint-1"), {
            status: "resolved",
            resolvedBy: uid(),
            resolvedAt: serverTimestamp(),
            ...stamped(),
          }),
      }),
    ).toEqual([]);
  });
});
