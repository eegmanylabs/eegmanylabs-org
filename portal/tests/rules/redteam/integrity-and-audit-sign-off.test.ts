// Red-team attacks on accountability: changing a record that carries someone's signature while
// the signature stays, signing in another person's name, signing at a time of the attacker's
// choosing, and recording a decision that belongs to someone else.
//
// The portal's audit trail is written by a trigger whose acting identity is unverified
// (docs/SECURITY.md, section 6), so the data itself has to say who stands behind a review, an
// approval, a completion or a report. Every test states the secure behaviour: the request is
// refused. A test that fails has found a way to corrupt a signed record or to escape the name on it.
// Everything here is synthetic: fictitious accounts, people, studies and laboratories on the
// example.org domain.
import { acknowledgementId, participationId, unitScopeKeys } from "@eegml/shared";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { serverTimestamp, Timestamp } from "firebase/firestore";
import { describe, it } from "vitest";
import {
  autoId,
  MEMBER_PERSON,
  MEMBER_UID,
  OTHER_REPLICATION,
  OWN_LABORATORY,
  OWN_PARTICIPATION,
  OWN_REPLICATION,
  OWNER_PERSON,
  OWNER_UID,
  STORED_AT,
  stored,
} from "../world";
import {
  ADMIN_UID,
  APPROVED_VERSION,
  arena,
  COMPLETED_ITEM,
  COORDINATOR_UID,
  LABORATORY,
  LEAD_DEVIATION,
  LEAD_UID,
  PARTICIPATION,
  REPLICATION,
  REVIEWED_HYPOTHESIS,
} from "./integrity-and-audit-support";

const lab = arena("sign-off");

const UNIT = {
  replicationId: OWN_REPLICATION,
  laboratoryId: OWN_LABORATORY,
  scopeKeys: unitScopeKeys(OWN_REPLICATION, OWN_LABORATORY),
};
const past = () => Timestamp.fromMillis(Date.now() - 86_400_000);
const future = () => Timestamp.fromMillis(Date.now() + 86_400_000);
const DETAIL = `${PARTICIPATION}/private/detail`;

describe("a reviewed result of a hypothesis", () => {
  it("is not rewritten by a lead while the review of a programme administrator stays on it", async () => {
    // The administrator signed "did not replicate". The lead turns the finding round, and the
    // record still says that the administrator reviewed it, at the time the administrator did.
    await assertFails(
      lab.update("ownLead", REVIEWED_HYPOTHESIS, { resultSummary: "The synthetic effect replicated in full." }),
    );
  });

  it("does not lose its text while it stays verified and reviewed", async () => {
    await assertFails(
      lab.update("ownLead", REVIEWED_HYPOTHESIS, { text: "A third synthetic effect is absent, as we predicted." }),
    );
  });

  it("does not lose the review of a programme administrator to a lead", async () => {
    await assertFails(lab.update("ownLead", REVIEWED_HYPOTHESIS, { resultReviewedBy: null, resultReviewedAt: null }));
  });

  it("is not signed by a lead in the name of a programme administrator", async () => {
    await assertFails(
      lab.update("ownLead", `${REPLICATION}/hypotheses/h01`, {
        resultSummary: "The synthetic effect replicated.",
        resultReviewedBy: ADMIN_UID,
        resultReviewedAt: serverTimestamp(),
      }),
    );
  });

  it("is not signed at a time of the lead's choosing", async () => {
    await assertFails(
      lab.update("ownLead", `${REPLICATION}/hypotheses/h01`, {
        resultReviewedBy: LEAD_UID,
        resultReviewedAt: past(),
      }),
    );
  });

  it("is not reviewed by the lead who wrote it", async () => {
    // The lead writes the result, marks the hypothesis as verified and names themselves as the
    // reviewer of their own result, in one request.
    await assertFails(
      lab.update("ownLead", `${REPLICATION}/hypotheses/h01`, {
        resultSummary: "The synthetic effect replicated.",
        scientificReviewStatus: "verified",
        resultReviewedBy: LEAD_UID,
        resultReviewedAt: serverTimestamp(),
      }),
    );
  });
});

describe("an approved version of a protocol", () => {
  it("does not point at another document while the approval of a programme administrator stays on it", async () => {
    // People acknowledge a version. A lead who swaps its document changes what they acknowledged.
    await assertFails(lab.update("ownLead", APPROVED_VERSION, { documentLinkId: "link-of-another-document" }));
  });

  it("does not change its label after approval", async () => {
    await assertFails(lab.update("ownLead", APPROVED_VERSION, { versionLabel: "2.0 (final)" }));
  });

  it("does not change its effective date after approval", async () => {
    await assertFails(lab.update("ownLead", APPROVED_VERSION, { effectiveDate: "2020-01-01" }));
  });

  it("is not created as approved with nobody named as its approver", async () => {
    await assertFails(
      lab.create("ownLead", `${REPLICATION}/protocolVersions/${autoId("version-red-team")}`, {
        replicationId: OWN_REPLICATION,
        protocolId: "protocol-1",
        versionLabel: "3.0",
        status: "approved",
        approvedBy: null,
        approvedAt: null,
      }),
    );
  });

  it("is not approved in the name of a programme administrator", async () => {
    await assertFails(
      lab.update("ownLead", `${REPLICATION}/protocolVersions/version-1`, {
        approvedBy: ADMIN_UID,
        approvedAt: serverTimestamp(),
      }),
    );
  });

  it("is not approved at a time of the lead's choosing", async () => {
    await assertFails(
      lab.update("ownLead", `${REPLICATION}/protocolVersions/version-1`, { approvedBy: LEAD_UID, approvedAt: past() }),
    );
  });

  it("does not move to another protocol", async () => {
    await assertFails(lab.update("ownLead", APPROVED_VERSION, { protocolId: "protocol-2" }));
  });
});

describe("a checklist item that the coordinator completed", () => {
  it("does not take other evidence from a member of the laboratory while the coordinator stays named", async () => {
    await assertFails(
      lab.update("ownLabMember", COMPLETED_ITEM, { evidenceUrl: "https://example.org/another-certificate" }),
    );
  });

  it("is not reopened by a member of the laboratory with the coordinator still named as having completed it", async () => {
    await assertFails(lab.update("ownLabMember", COMPLETED_ITEM, { status: "notStarted" }));
  });

  it("does not lose the name of who completed it while it stays done", async () => {
    await assertFails(lab.update("ownLabMember", COMPLETED_ITEM, { completedBy: null, completedAt: null }));
  });

  it("is not marked as done with nobody named as having completed it", async () => {
    await assertFails(lab.update("ownLabMember", `${PARTICIPATION}/checklist/ethics`, { status: "done" }));
  });

  it("is not completed in the name of the lead", async () => {
    await assertFails(
      lab.update("ownLabMember", `${PARTICIPATION}/checklist/ethics`, {
        status: "done",
        completedBy: LEAD_UID,
        completedAt: serverTimestamp(),
      }),
    );
  });

  it("is not completed at a time of the member's choosing", async () => {
    const uid = lab.uid("ownLabMember");
    const item = `${PARTICIPATION}/checklist/ethics`;
    await assertFails(lab.update("ownLabMember", item, { status: "done", completedBy: uid, completedAt: past() }));
    await assertFails(lab.update("ownLabMember", item, { status: "done", completedBy: uid, completedAt: future() }));
  });

  it("is completed by a member of the laboratory in their own name, at the time of the request", async () => {
    await assertSucceeds(
      lab.update("ownLabMember", `${PARTICIPATION}/checklist/ethics`, {
        status: "done",
        completedBy: lab.uid("ownLabMember"),
        completedAt: serverTimestamp(),
      }),
    );
  });
});

describe("a deviation that the lead of the replication reported against laboratory A", () => {
  it("is not rewritten and played down by the coordinator of that laboratory under the name of the lead", async () => {
    await assertFails(
      lab.update("ownCoordinator", LEAD_DEVIATION, {
        description: "A minor remark about electrode labels.",
        severity: "minor",
        status: "resolved",
      }),
    );
  });

  it("is not archived by the coordinator of the laboratory it was reported against", async () => {
    await assertFails(lab.update("ownCoordinator", LEAD_DEVIATION, { archivedAt: serverTimestamp() }));
  });

  it("does not change its reporter", async () => {
    await assertFails(lab.update("ownCoordinator", LEAD_DEVIATION, { reportedBy: COORDINATOR_UID }));
  });

  it("is not reported in the name of someone else", async () => {
    await assertFails(
      lab.create("ownCoordinator", `${PARTICIPATION}/deviations/${autoId("deviation-red-team")}`, {
        participationId: OWN_PARTICIPATION,
        description: "The lead told us to skip the practice block.",
        severity: "critical",
        occurredAt: STORED_AT,
        reportedBy: LEAD_UID,
        status: "open",
        ...UNIT,
      }),
    );
  });

  it("is not removed by anyone who can write it", async () => {
    await assertFails(lab.remove("ownCoordinator", LEAD_DEVIATION));
    await assertFails(lab.remove("ownLead", LEAD_DEVIATION));
    await assertFails(lab.remove("coreTeam", LEAD_DEVIATION));
  });
});

describe("the readiness of laboratory A for replication X", () => {
  it("is not set to approved by the coordinator of laboratory A, on the record that every member reads", async () => {
    // The laboratory signs off its own readiness for collection.
    await assertFails(lab.update("ownCoordinator", PARTICIPATION, { readinessStatus: "approved" }));
  });

  it("does not name the coordinator of laboratory A as its approver", async () => {
    await assertFails(
      lab.update("ownCoordinator", DETAIL, {
        readinessApprovedBy: COORDINATOR_UID,
        readinessApprovedAt: serverTimestamp(),
      }),
    );
  });

  it("does not lose the approval of the lead to the coordinator of laboratory A", async () => {
    await lab.plant({
      [DETAIL]: {
        ...stored(),
        ethicsStatus: "approved",
        trainingStatus: "completed",
        readinessApprovedBy: LEAD_UID,
        readinessApprovedAt: STORED_AT,
      },
    });
    await assertFails(lab.update("ownCoordinator", DETAIL, { readinessApprovedBy: null, readinessApprovedAt: null }));
  });

  it("is not approved in the name of the lead, or at a time of the coordinator's choosing", async () => {
    await assertFails(
      lab.update("ownCoordinator", DETAIL, { readinessApprovedBy: LEAD_UID, readinessApprovedAt: serverTimestamp() }),
    );
    await assertFails(
      lab.update("ownCoordinator", DETAIL, { readinessApprovedBy: COORDINATOR_UID, readinessApprovedAt: past() }),
    );
  });

  it("does not stay approved in the name of the lead while the coordinator changes what was approved", async () => {
    await lab.plant({
      [DETAIL]: {
        ...stored(),
        ethicsStatus: "approved",
        ethicsReference: "SYN-2026-001",
        trainingStatus: "completed",
        readinessApprovedBy: LEAD_UID,
        readinessApprovedAt: STORED_AT,
      },
    });
    await assertFails(
      lab.update("ownCoordinator", DETAIL, {
        ethicsStatus: "notRequired",
        ethicsReference: "none",
        equipmentOverrideJustification: "We use another amplifier after all.",
      }),
    );
  });
});

describe("an acknowledgement of a protocol version", () => {
  const acknowledgement = (personId: string, fields: Record<string, unknown> = {}) => ({
    participationId: OWN_PARTICIPATION,
    protocolId: "protocol-1",
    protocolVersionId: "version-1",
    personId,
    acknowledgedAt: STORED_AT,
    ...UNIT,
    ...fields,
  });
  const pathOf = (personId: string, versionId = "version-1") =>
    `${PARTICIPATION}/acknowledgements/${acknowledgementId(personId, versionId)}`;

  it("is not recorded by a coordinator in the name of another person, at a time of the coordinator's choosing", async () => {
    // The person has an account of their own and never saw the protocol. The record can never
    // be changed or removed afterwards, and its identifier is the one their own acknowledgement
    // would take.
    await assertFails(lab.create("ownCoordinator", pathOf(MEMBER_PERSON), acknowledgement(MEMBER_PERSON), true));
  });

  it("is not dated in the future", async () => {
    await assertFails(
      lab.create(
        "ownCoordinator",
        pathOf(MEMBER_PERSON),
        acknowledgement(MEMBER_PERSON, { acknowledgedAt: future() }),
        true,
      ),
    );
  });

  it("never changes and is never removed once it exists", async () => {
    const existing = pathOf(OWNER_PERSON);
    for (const attacker of ["ownCoordinator", "ownLead", "coreTeam"] as const) {
      await assertFails(lab.update(attacker, existing, { acknowledgedAt: serverTimestamp() }));
      await assertFails(lab.remove(attacker, existing));
      await assertFails(lab.create(attacker, existing, acknowledgement(OWNER_PERSON), true));
    }
  });

  it("names a version of the protocol it names, under the identifier of its person and version", async () => {
    await assertFails(
      lab.create(
        "ownCoordinator",
        pathOf(MEMBER_PERSON, "version-of-protocol-2"),
        acknowledgement(MEMBER_PERSON, { protocolVersionId: "version-of-protocol-2" }),
        true,
      ),
    );
    await assertFails(
      lab.create("ownCoordinator", `${PARTICIPATION}/acknowledgements/anything`, acknowledgement(MEMBER_PERSON), true),
    );
  });
});

describe("a confirmed entry of a member of laboratory A", () => {
  const entry = `${LABORATORY}/members/${OWNER_PERSON}`;

  it("does not become that of a principal investigator and authorised representative while it stays confirmed", async () => {
    // The person confirmed that they are a member. The coordinator rewrites what was confirmed.
    await assertFails(lab.update("ownCoordinator", entry, { role: "pi", isAuthorisedRepresentative: true }));
  });

  it("is not confirmed by a coordinator", async () => {
    await assertSucceeds(lab.update("ownCoordinator", entry, { status: "ended" }));
    await assertFails(lab.update("ownCoordinator", entry, { status: "confirmed" }));
  });

  it("is not created as confirmed", async () => {
    await assertFails(
      lab.create("ownCoordinator", `${LABORATORY}/members/${MEMBER_PERSON}`, {
        laboratoryId: OWN_LABORATORY,
        personId: MEMBER_PERSON,
        role: "member",
        isAuthorisedRepresentative: true,
        earlierPeriods: [],
        status: "confirmed",
      }),
    );
  });
});

describe("a value that an import took verbatim from a source", () => {
  it("is not rewritten by a lead on a contributor row, where it records what the contributor answered", async () => {
    // The row still names the source record as the origin of the value, and a later import
    // leaves an edited value alone, so the forged answer stays.
    await lab.plant({
      "contributors/contributor-imported": {
        ...stored(),
        surnameSource: "Synthetic",
        agreementSource: "No, please remove me",
        creditRoles: {},
        reviewStatus: "needsReview",
        replicationId: OWN_REPLICATION,
        manuscriptId: null,
        contributorTableId: "table-1",
        personId: null,
        scopeKeys: [`rep:${OWN_REPLICATION}`],
        sourceRecordIds: ["source-record-1"],
        fieldSources: { agreementSource: "source-record-1" },
        importedValues: { agreementSource: "No, please remove me" },
      },
    });
    await assertFails(lab.update("ownLead", "contributors/contributor-imported", { agreementSource: "Yes" }));
  });

  it("is not rewritten by a lead on an imported replication", async () => {
    const replication = await lab.stored(REPLICATION);
    await lab.plant({
      [REPLICATION]: {
        ...replication,
        dataOrigin: "importedHistorical",
        originalNSource: "n = 24",
        sourceRecordIds: ["source-record-1"],
        fieldSources: { originalNSource: "source-record-1" },
        importedValues: { originalNSource: "n = 24" },
      },
    });
    await assertFails(lab.update("ownLead", REPLICATION, { originalNSource: "n = 240" }));
  });
});

describe("a decision that belongs to the programme or to the other side", () => {
  it("an invitation of laboratory A into another replication is not recorded by the coordinator of laboratory A", async () => {
    // `invited` says that the replication asked the laboratory. Nobody of that replication took part.
    await assertFails(
      lab.create("ownCoordinator", `participations/${participationId(OTHER_REPLICATION, OWN_LABORATORY)}`, {
        replicationId: OTHER_REPLICATION,
        laboratoryId: OWN_LABORATORY,
        scopeKeys: unitScopeKeys(OTHER_REPLICATION, OWN_LABORATORY),
        status: "invited",
        statusHistoryId: null,
        readinessStatus: "notStarted",
        custom: {},
        dataOrigin: "live",
      }),
    );
  });

  it("a lead does not move their replication into another programme", async () => {
    await lab.plant({
      "programmes/synthetic-subproject": {
        ...stored(),
        key: "synthetic-subproject",
        name: "Synthetic subproject",
        parentId: "synthetic-programme",
        kind: "subproject",
      },
    });
    await assertFails(lab.update("ownLead", REPLICATION, { programmeId: "synthetic-subproject" }));
  });

  it("a lead does not select again a replication that the programme withdrew", async () => {
    const replication = await lab.stored(REPLICATION);
    await lab.plant({ [REPLICATION]: { ...replication, selectionStatus: "withdrawn" } });
    await assertFails(lab.update("ownLead", REPLICATION, { selectionStatus: "selected" }));
  });

  it("a lead does not move the public stage of their replication, which is its status as the public sees it", async () => {
    // The status proper changes through a function that writes its history. The stage that the
    // public website shows sits beside it and has no history.
    await assertFails(
      lab.update("ownLead", REPLICATION, {
        publicStageNumber: 6,
        publicStageName: "Published",
        publicStageText: "The results are published.",
      }),
    );
  });

  it("a lead does not record that the citation of their replication was verified", async () => {
    await assertFails(
      lab.update("ownLead", REPLICATION, {
        citationStatus: "verified",
        citationCheckedAt: serverTimestamp(),
        citationSource: "crossref",
      }),
    );
  });

  it("a lead does not record the result of a link check that never ran", async () => {
    await assertFails(
      lab.update("ownLead", "documentLinks/link-1", {
        accessStatus: "public",
        httpStatus: 200,
        lastCheckedAt: past(),
      }),
    );
  });

  it("a lead does not revive a membership that was confirmed for a period that has ended", async () => {
    // A confirmed membership gives its person sight of the replication and gives the leads sight
    // of the person's contact details. The confirmation was for a period that is over.
    const membership = `${REPLICATION}/memberships/${MEMBER_PERSON}__analyst`;
    await lab.plant({
      [membership]: {
        ...stored(),
        replicationId: OWN_REPLICATION,
        personId: MEMBER_PERSON,
        role: "analyst",
        isCurrent: false,
        endDate: "2024-12-31",
        earlierPeriods: [],
        reviewStatus: "confirmed",
      },
    });
    await assertFails(lab.update("ownLead", membership, { isCurrent: true }));
  });

  it("a lead neither confirms a membership nor makes anyone a lead", async () => {
    const membership = `${REPLICATION}/memberships`;
    await lab.plant({
      [`${membership}/${MEMBER_PERSON}__analyst`]: {
        ...stored(),
        replicationId: OWN_REPLICATION,
        personId: MEMBER_PERSON,
        role: "analyst",
        isCurrent: true,
        earlierPeriods: [],
        reviewStatus: "needsReview",
      },
    });
    await assertFails(lab.update("ownLead", `${membership}/${MEMBER_PERSON}__analyst`, { reviewStatus: "confirmed" }));
    for (const role of ["lead", "coLead"]) {
      await assertFails(
        lab.create("ownLead", `${membership}/${MEMBER_PERSON}__${role}`, {
          replicationId: OWN_REPLICATION,
          personId: MEMBER_PERSON,
          role,
          isCurrent: true,
          earlierPeriods: [],
          reviewStatus: "needsReview",
        }),
      );
    }
  });

  it("a member does not resolve a correction request, their own included, or file one in another name", async () => {
    const request = {
      uid: MEMBER_UID,
      entityType: "laboratory",
      entityId: OWN_LABORATORY,
      field: "city",
      proposedValue: "Synthetic City",
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
    };
    await assertSucceeds(lab.create("member", `correctionRequests/${autoId("request-red-team")}`, request));
    await assertFails(
      lab.update("member", `correctionRequests/${autoId("request-red-team")}`, {
        status: "accepted",
        resolvedBy: MEMBER_UID,
        resolvedAt: serverTimestamp(),
      }),
    );
    await assertFails(lab.update("member", "correctionRequests/request-1", { status: "withdrawn" }));
    await assertFails(
      lab.create("member", `correctionRequests/${autoId("request-forged")}`, { ...request, uid: OWNER_UID }),
    );
    await assertFails(
      lab.create("member", `correctionRequests/${autoId("request-accepted")}`, { ...request, status: "accepted" }),
    );
    await assertFails(lab.remove("member", `correctionRequests/${autoId("request-red-team")}`));
  });

  it("a member does not claim a person, or turn their own record into that of the core team", async () => {
    await lab.plant({
      "persons/person-synthetic-unclaimed": {
        ...stored(),
        slug: "synthetic-unclaimed",
        displayName: "Synthetic Unclaimed",
        laboratoryIds: [],
        replicationIds: [],
        isCoreTeam: false,
        publicListing: "member",
        coreRoles: [],
        userId: null,
        claimedAt: null,
        custom: {},
        dataOrigin: "demo",
      },
    });
    await assertFails(
      lab.update("member", "persons/person-synthetic-unclaimed", { userId: MEMBER_UID, claimedAt: serverTimestamp() }),
    );
    const own = `persons/${MEMBER_PERSON}`;
    await assertSucceeds(lab.update("member", own, { scholarUrl: "https://example.org/scholar/synthetic-member" }));
    // Imports find a person again by the ORCID iD, so a callable function changes it.
    await assertFails(lab.update("member", own, { orcid: "0000-0002-1825-0097" }));
    await assertFails(lab.update("member", own, { isCoreTeam: true }));
    await assertFails(lab.update("member", own, { publicListing: "coreTeam" }));
    await assertFails(lab.update("member", own, { coreRoles: ["Steering committee"] }));
    await assertFails(lab.update("member", own, { displayName: "Synthetic Owner" }));
    await assertFails(lab.update("member", own, { replicationIds: [OWN_REPLICATION] }));
    await assertFails(lab.update("member", own, { laboratoryIds: [OWN_LABORATORY] }));
    await assertFails(lab.update("member", own, { userId: null }));
    await assertFails(lab.update("member", own, { archivedAt: serverTimestamp() }));
  });
});
