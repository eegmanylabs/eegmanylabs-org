import {
  BOOTSTRAP_ADMINS_COLLECTION,
  bootstrapAdminId,
  bootstrapAdminPath,
  bootstrapAdminRecordSchema,
  COLLECTIONS,
  type CollectionKey,
  distinctRoles,
  historicalAggregateId,
  hypothesisId,
  type ImpliedRole,
  identityKeyId,
  importBatchId,
  lookupFold,
  MEMBERS_SCOPE_KEY,
  memberEntryCounts,
  membershipCounts,
  normaliseEmail,
  ONBOARDING_CHECKLIST_TEMPLATE,
  organisationKey,
  PROGRAMME_KEY,
  participationId,
  personEmailIndexId,
  planAccessOf,
  readAccessSources,
  replicationMembershipId,
  replicationScopeKey,
  roleAssignmentId,
  rolesOfMemberEntry,
  rolesOfMembership,
  rolesOfPerson,
  sequenceId,
  sha256Hex,
  studyAliasId,
  summaryTotals,
  systemActor,
  systemWriteContext,
  unitScopeKeys,
} from "@eegml/shared";
import type { DocumentData } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { type AdminHandles, adminReader, connectToEmulators } from "../admin";
import type { Command } from "../command";
import { requireEmulatorTarget, requireRunningEmulators } from "../environment";
import { DEMO_ACCOUNTS } from "../fixtures/demo-accounts";
import {
  DEMO_BATCH_STARTED_AT,
  DEMO_BOOTSTRAP_ADMIN_EMAIL,
  DEMO_CATEGORY_EXTENSION,
  DEMO_CONTRIBUTOR_TABLE,
  DEMO_CONTRIBUTORS,
  DEMO_DOCUMENT_LINKS,
  DEMO_EQUIPMENT,
  DEMO_HISTORICAL_AGGREGATES,
  DEMO_HYPOTHESES,
  DEMO_INSTITUTIONS,
  DEMO_LABORATORIES,
  DEMO_LABORATORY_MEMBERS,
  DEMO_MANUSCRIPTS,
  DEMO_MEMBERSHIPS,
  DEMO_PARTICIPATIONS,
  DEMO_PAUSE,
  DEMO_PERSONS,
  DEMO_REPLICATIONS,
  DEMO_REPORTS,
  DEMO_REQUIREMENTS,
  DEMO_SOURCES,
  DEMO_STATUS_HISTORY,
  DEMO_TARGETS,
} from "../fixtures/demo-world";
import { emulatorHashKey } from "../hash-key";
import { seedLookups } from "./seed-lookups";

export interface SeedSummary {
  readonly projectId: string;
  created: number;
  unchanged: number;
  /** Access documents that were brought in line with a world that had changed. */
  updated: number;
  /** Lookup documents that this run created, through the seeding of the lookup data. */
  lookupsCreated: number;
}

/** The actor recorded on everything this command writes. */
export const SEED_DEMO_ACTOR = systemActor("seedDemo");

/** One document of the demonstration world: its path and its fields, standard fields included. */
export interface DemoDocument {
  readonly path: string;
  readonly data: DocumentData;
}

const displayNameOf = (person: { givenName: string; familyName: string }) => `${person.givenName} ${person.familyName}`;

/** The targets of a participation, where the world states them. An unknown target stays absent. */
function targetsOf(id: string): { targetNMain?: number; targetNRest?: number } {
  const target = DEMO_TARGETS[id];
  return {
    ...(target?.main === undefined ? {} : { targetNMain: target.main }),
    ...(target?.rest === undefined ? {} : { targetNRest: target.rest }),
  };
}

/** A member entry and a membership of the fixtures as the stored documents state them. */
const entryState = (entry: (typeof DEMO_LABORATORY_MEMBERS)[number]) => ({
  role: entry.role,
  status: entry.status,
  archivedAt: null,
});
const membershipState = (membership: (typeof DEMO_MEMBERSHIPS)[number]) => ({
  role: membership.role,
  reviewStatus: membership.reviewStatus,
  isCurrent: true,
  archivedAt: null,
});

/** The roles that the demonstration world implies for the account that has claimed a person. */
export function demoImpliedRoles(personId: string): ImpliedRole[] {
  const person = DEMO_PERSONS.find((candidate) => candidate.id === personId);
  return distinctRoles([
    ...DEMO_LABORATORY_MEMBERS.filter((entry) => entry.personId === personId).flatMap((entry) =>
      rolesOfMemberEntry(entry.laboratoryId, entryState(entry)),
    ),
    ...DEMO_MEMBERSHIPS.filter((membership) => membership.personId === personId).flatMap((membership) =>
      rolesOfMembership(membership.replicationId, membershipState(membership)),
    ),
    ...rolesOfPerson({ isCoreTeam: person?.isCoreTeam === true }),
  ]);
}

/**
 * Every document of the demonstration world except the access documents, which are resolved
 * from the others once they are stored. The derived values are computed here by the rules that
 * the functions apply, so that a trigger which follows the seed finds nothing to change.
 */
export function demoDocuments(now: Date, hashKey: string): DemoDocument[] {
  const timestamp = Timestamp.fromDate(now);
  const standard = {
    createdAt: timestamp,
    updatedAt: timestamp,
    createdBy: SEED_DEMO_ACTOR,
    updatedBy: SEED_DEMO_ACTOR,
    archivedAt: null,
    writeContext: systemWriteContext(),
  };
  const documents: DemoDocument[] = [];
  const add = <K extends CollectionKey>(key: K, path: string, data: Record<string, unknown>) => {
    const entry = COLLECTIONS[key];
    documents.push({
      path,
      data: entry.schema.parse({ ...standard, schemaVersion: entry.schemaVersion, ...data }) as DocumentData,
    });
  };
  /** A document of an append-only collection, which carries the shorter set of standard fields. */
  const append = <K extends CollectionKey>(key: K, path: string, data: Record<string, unknown>) => {
    const entry = COLLECTIONS[key];
    documents.push({
      path,
      data: entry.schema.parse({
        schemaVersion: entry.schemaVersion,
        createdAt: standard.createdAt,
        createdBy: standard.createdBy,
        writeContext: standard.writeContext,
        ...data,
      }) as DocumentData,
    });
  };
  const claimedBy = new Map(
    DEMO_ACCOUNTS.flatMap((account) => (account.personId === null ? [] : [[account.personId, account.uid] as const])),
  );
  const institutionOf = new Map(DEMO_INSTITUTIONS.map((institution) => [institution.id, institution]));

  // The second factor cannot be enrolled in the emulator, which implements no one-time
  // passwords, so the demonstration world waives it. No real project is ever seeded.
  add("systemSettings", COLLECTIONS.systemSettings.docPath(), {
    featureFlags: {},
    maintenanceMode: false,
    listLimit: 200,
    retention: {},
    requireSecondFactor: false,
  });

  for (const institution of DEMO_INSTITUTIONS) {
    add("institutions", COLLECTIONS.institutions.docPath(institution.id), {
      name: institution.name,
      countryCode: institution.countryCode,
      city: institution.city,
      emailDomains: [...institution.emailDomains],
    });
  }

  const slugKey = (entityType: "person" | "laboratory", id: string, slug: string) =>
    add("identityKeys", COLLECTIONS.identityKeys.docPath(identityKeyId(entityType, "slug", slug, hashKey)), {
      entityType,
      keyKind: "slug",
      entityIds: [id],
      status: "active",
      mergedIntoId: null,
    });

  for (const laboratory of DEMO_LABORATORIES) {
    const institution = institutionOf.get(laboratory.institutionId);
    add("laboratories", COLLECTIONS.laboratories.docPath(laboratory.id), {
      slug: laboratory.slug,
      name: laboratory.name,
      institutionId: laboratory.institutionId,
      ...(institution === undefined ? {} : { countryCode: institution.countryCode, city: institution.city }),
      ...(laboratory.piPersonId === undefined ? {} : { piPersonId: laboratory.piPersonId }),
      status: "active",
      custom: {},
      dataOrigin: "demo",
    });
    slugKey("laboratory", laboratory.id, laboratory.slug);
  }

  for (const person of DEMO_PERSONS) {
    const institution = person.institutionId === undefined ? undefined : institutionOf.get(person.institutionId);
    const uid = claimedBy.get(person.id) ?? null;
    add("persons", COLLECTIONS.persons.docPath(person.id), {
      slug: person.slug,
      givenName: person.givenName,
      familyName: person.familyName,
      displayName: displayNameOf(person),
      ...(institution === undefined
        ? {}
        : {
            institutionId: institution.id,
            affiliationSummary: institution.name,
            countryCode: institution.countryCode,
          }),
      laboratoryIds: DEMO_LABORATORY_MEMBERS.filter(
        (entry) => entry.personId === person.id && memberEntryCounts(entryState(entry)),
      )
        .map((entry) => entry.laboratoryId)
        .sort(),
      replicationIds: [
        ...new Set(
          DEMO_MEMBERSHIPS.filter(
            (membership) => membership.personId === person.id && membershipCounts(membershipState(membership)),
          ).map((membership) => membership.replicationId),
        ),
      ].sort(),
      isCoreTeam: person.isCoreTeam === true,
      publicListing: person.isCoreTeam === true ? "coreTeam" : "none",
      coreRoles: person.isCoreTeam === true ? ["Demonstration role"] : [],
      userId: uid,
      claimedAt: uid === null ? null : timestamp,
      custom: {},
      dataOrigin: "demo",
    });
    slugKey("person", person.id, person.slug);
    add("personContact", COLLECTIONS.personContact.docPath(person.id), {
      emails: person.emails.map((entry) => ({
        email: normaliseEmail(entry.email),
        kind: entry.kind,
        verifiedAt: null,
        claimEligible: entry.claimEligible,
      })),
    });
    if (person.demographics !== undefined) {
      add("personDemographics", COLLECTIONS.personDemographics.docPath(person.id), {
        genderSource: person.demographics.genderSource,
        ethnicitySource: person.demographics.ethnicitySource,
        recordedAt: timestamp,
      });
    }
  }

  // One index entry for each address, which lists every person who holds it.
  const holders = new Map<string, { personIds: Set<string>; eligible: Set<string> }>();
  for (const person of DEMO_PERSONS) {
    for (const entry of person.emails) {
      const address = normaliseEmail(entry.email);
      const held = holders.get(address) ?? { personIds: new Set<string>(), eligible: new Set<string>() };
      held.personIds.add(person.id);
      if (entry.claimEligible) held.eligible.add(person.id);
      holders.set(address, held);
    }
  }
  for (const [address, held] of holders) {
    add("personEmailIndex", COLLECTIONS.personEmailIndex.docPath(personEmailIndexId(address, hashKey)), {
      personIds: [...held.personIds].sort(),
      claimEligiblePersonIds: [...held.eligible].sort(),
    });
  }

  for (const entry of DEMO_LABORATORY_MEMBERS) {
    add("laboratoryMembers", COLLECTIONS.laboratoryMembers.docPath(entry.laboratoryId, entry.personId), {
      laboratoryId: entry.laboratoryId,
      personId: entry.personId,
      role: entry.role,
      isAuthorisedRepresentative: entry.isAuthorisedRepresentative,
      earlierPeriods: [],
      status: entry.status,
    });
  }

  for (const replication of DEMO_REPLICATIONS) {
    const historyId = DEMO_STATUS_HISTORY.replicationId === replication.studyKey ? DEMO_STATUS_HISTORY.id : null;
    add("replications", COLLECTIONS.replications.docPath(replication.studyKey), {
      programmeId: PROGRAMME_KEY,
      studyKey: replication.studyKey,
      shortTitle: replication.shortTitle,
      ...replication.details,
      statusKey: replication.statusKey,
      statusHistoryId: historyId,
      selectionStatus: replication.selectionStatus,
      leadPersonIds: DEMO_MEMBERSHIPS.filter(
        (membership) =>
          membership.replicationId === replication.studyKey &&
          (membership.role === "lead" || membership.role === "coLead") &&
          membershipCounts(membershipState(membership)),
      )
        .map((membership) => membership.personId)
        .sort(),
      vocabulary: [],
      custom: {},
      dataOrigin: "demo",
    });
    for (const { scheme, alias } of replication.aliases) {
      add(
        "replicationAliases",
        COLLECTIONS.replicationAliases.docPath(replication.studyKey, studyAliasId(scheme, alias)),
        {
          replicationId: replication.studyKey,
          alias,
          aliasFolded: lookupFold(alias),
          scheme,
          isCanonical: scheme === "website",
        },
      );
    }
    const replicated = Object.fromEntries(
      DEMO_HYPOTHESES.filter(
        (hypothesis) => hypothesis.replicationId === replication.studyKey && hypothesis.replicatedSource !== undefined,
      ).map((hypothesis) => [hypothesisId(hypothesis.number), hypothesis.replicatedSource]),
    );
    if (Object.keys(replicated).length > 0) {
      add("replicationDetail", COLLECTIONS.replicationDetail.docPath(replication.studyKey), {
        replicatedSource: replicated,
      });
    }
  }
  append("statusHistory", COLLECTIONS.statusHistory.docPath(DEMO_STATUS_HISTORY.id), {
    entityType: "replication",
    entityId: DEMO_STATUS_HISTORY.replicationId,
    fromStatusKey: DEMO_STATUS_HISTORY.fromStatusKey,
    toStatusKey: DEMO_STATUS_HISTORY.toStatusKey,
    effectiveAt: timestamp,
    recordedAt: timestamp,
    changedBy: SEED_DEMO_ACTOR,
    reason: DEMO_STATUS_HISTORY.reason,
    source: "import",
    replicationId: DEMO_STATUS_HISTORY.replicationId,
    laboratoryId: null,
    scopeKeys: [replicationScopeKey(DEMO_STATUS_HISTORY.replicationId), MEMBERS_SCOPE_KEY],
  });
  for (const hypothesis of DEMO_HYPOTHESES) {
    add(
      "replicationHypotheses",
      COLLECTIONS.replicationHypotheses.docPath(hypothesis.replicationId, hypothesisId(hypothesis.number)),
      {
        replicationId: hypothesis.replicationId,
        hypothesisNumber: String(hypothesis.number),
        text: hypothesis.text,
        ...(hypothesis.nullSigSource === undefined ? {} : { nullSigSource: hypothesis.nullSigSource }),
        scientificReviewStatus: "unverified",
        analysisStatus: "notStarted",
        resultReviewedBy: null,
        resultReviewedAt: null,
      },
    );
  }
  for (const manuscript of DEMO_MANUSCRIPTS) {
    add("manuscripts", COLLECTIONS.manuscripts.docPath(manuscript.id), {
      replicationId: manuscript.replicationId,
      title: manuscript.title,
      kind: manuscript.kind,
      status: manuscript.status,
      statusHistoryId: null,
      ...(manuscript.journal === undefined ? {} : { journal: manuscript.journal }),
      ...(manuscript.doi === undefined ? {} : { doi: manuscript.doi }),
      ...(manuscript.acceptedYear === undefined
        ? {}
        : { acceptedAt: Timestamp.fromDate(new Date(Date.UTC(manuscript.acceptedYear, 5, 1))) }),
      custom: {},
      scopeKeys: [replicationScopeKey(manuscript.replicationId)],
    });
  }
  add("contributorTables", COLLECTIONS.contributorTables.docPath(DEMO_CONTRIBUTOR_TABLE.id), {
    replicationId: DEMO_CONTRIBUTOR_TABLE.replicationId,
    sourceKey: DEMO_CONTRIBUTOR_TABLE.sourceKey,
    isPublished: false,
    scopeKeys: [replicationScopeKey(DEMO_CONTRIBUTOR_TABLE.replicationId)],
  });
  for (const contributor of DEMO_CONTRIBUTORS) {
    add("contributors", COLLECTIONS.contributors.docPath(contributor.id), {
      firstNameSource: contributor.firstNameSource,
      surnameSource: contributor.surnameSource,
      orderInPublication: contributor.orderInPublication,
      affiliationSource: contributor.affiliationSource,
      creditRoles: contributor.creditRoles,
      reviewStatus: "confirmed",
      replicationId: DEMO_CONTRIBUTOR_TABLE.replicationId,
      manuscriptId: DEMO_CONTRIBUTOR_TABLE.manuscriptId,
      contributorTableId: DEMO_CONTRIBUTOR_TABLE.id,
      personId: contributor.personId,
      scopeKeys: [replicationScopeKey(DEMO_CONTRIBUTOR_TABLE.replicationId)],
    });
  }
  for (const aggregate of DEMO_HISTORICAL_AGGREGATES) {
    const sourceRecordId = `demo-source-${aggregate.replicationIds.join("-").toLowerCase()}`;
    add(
      "historicalAggregates",
      COLLECTIONS.historicalAggregates.docPath(historicalAggregateId(aggregate.metricKey, sourceRecordId)),
      {
        replicationIds: [...aggregate.replicationIds],
        metricKey: aggregate.metricKey,
        valueSource: aggregate.valueSource,
        ...(aggregate.valueNumeric === undefined ? {} : { valueNumeric: aggregate.valueNumeric }),
        sourceRecordId,
        isCurrent: true,
        dataOrigin: "demo",
      },
    );
  }
  // Recruitment: the reports of one participation, its summary, a planned pause and a category
  // that extends one replication. The summary is computed as the function that files a report
  // computes it, so the totals every member reads agree with the reports.
  const participationOf = new Map(
    DEMO_PARTICIPATIONS.map((item) => [participationId(item.replicationId, item.laboratoryId), item] as const),
  );
  for (const report of DEMO_REPORTS) {
    const participation = participationOf.get(report.participationId);
    if (participation === undefined) throw new Error(`The demonstration report ${report.id} names no participation.`);
    append("recruitmentReports", COLLECTIONS.recruitmentReports.docPath(report.id), {
      participationId: report.participationId,
      replicationId: participation.replicationId,
      laboratoryId: participation.laboratoryId,
      scopeKeys: unitScopeKeys(participation.replicationId, participation.laboratoryId),
      asOfDate: report.asOfDate,
      reportKind: "cumulative",
      basis: report.basis,
      entryKind: report.entryKind,
      ...(report.correctsReportId === undefined ? {} : { correctsReportId: report.correctsReportId }),
      ...(report.verifiesReportId === undefined ? {} : { verifiesReportId: report.verifiesReportId }),
      counts: report.counts,
      exclusions: [],
      ...(report.note === undefined ? {} : { note: report.note }),
      reportedBy: SEED_DEMO_ACTOR,
      source: "manual",
      dataOrigin: "demo",
    });
  }
  const reportingReplications = [
    ...new Set(DEMO_REPORTS.map((report) => participationOf.get(report.participationId)?.replicationId)),
  ];
  for (const replicationId of reportingReplications) {
    if (replicationId === undefined) continue;
    const ids = DEMO_PARTICIPATIONS.filter((item) => item.replicationId === replicationId).map((item) =>
      participationId(item.replicationId, item.laboratoryId),
    );
    const facts = DEMO_REPORTS.filter((report) => ids.includes(report.participationId)).map((report, index) => ({
      ...report,
      reportKind: "cumulative" as const,
      exclusions: [],
      createdAtMillis: index,
      dataOrigin: "demo" as const,
    }));
    const { totals, reporting, latestAsOfDate } = summaryTotals(ids, facts, "9999-12-31");
    add("replicationSummaries", COLLECTIONS.replicationSummaries.docPath(replicationId, "recruitment"), {
      replicationId,
      kind: "recruitment",
      totals,
      reporting,
      participationCount: ids.length,
      reportCount: facts.length,
      latestAsOfDate,
      computedAt: timestamp,
    });
  }
  const pausedParticipation = participationOf.get(DEMO_PAUSE.participationId);
  if (pausedParticipation !== undefined) {
    add("plannedPauses", COLLECTIONS.plannedPauses.docPath(DEMO_PAUSE.id), {
      participationId: DEMO_PAUSE.participationId,
      replicationId: pausedParticipation.replicationId,
      laboratoryId: pausedParticipation.laboratoryId,
      scopeKeys: unitScopeKeys(pausedParticipation.replicationId, pausedParticipation.laboratoryId),
      startsOn: DEMO_PAUSE.startsOn,
      endsOn: DEMO_PAUSE.endsOn,
      reason: DEMO_PAUSE.reason,
    });
  }
  add("countCategories", COLLECTIONS.countCategories.docPath(DEMO_CATEGORY_EXTENSION.key), {
    ...DEMO_CATEGORY_EXTENSION,
    position: 100,
    isCore: false,
  });
  for (const link of DEMO_DOCUMENT_LINKS) {
    add("documentLinks", COLLECTIONS.documentLinks.docPath(link.id), {
      entityType: "replication",
      entityId: link.replicationId,
      kind: link.kind,
      url: link.url,
      title: link.title,
      accessStatus: link.accessStatus,
      lastCheckedAt: null,
      restricted: link.restricted,
      replicationId: link.replicationId,
      laboratoryId: null,
      scopeKeys: link.restricted
        ? [replicationScopeKey(link.replicationId)]
        : [replicationScopeKey(link.replicationId), MEMBERS_SCOPE_KEY],
    });
  }
  for (const membership of DEMO_MEMBERSHIPS) {
    add(
      "replicationMemberships",
      COLLECTIONS.replicationMemberships.docPath(
        membership.replicationId,
        replicationMembershipId(membership.personId, membership.role),
      ),
      {
        replicationId: membership.replicationId,
        personId: membership.personId,
        role: membership.role,
        isCurrent: true,
        earlierPeriods: [],
        reviewStatus: membership.reviewStatus,
      },
    );
  }
  for (const participation of DEMO_PARTICIPATIONS) {
    add(
      "participations",
      COLLECTIONS.participations.docPath(participationId(participation.replicationId, participation.laboratoryId)),
      {
        replicationId: participation.replicationId,
        laboratoryId: participation.laboratoryId,
        scopeKeys: unitScopeKeys(participation.replicationId, participation.laboratoryId),
        status: participation.status,
        statusHistoryId: null,
        ...targetsOf(participationId(participation.replicationId, participation.laboratoryId)),
        readinessStatus: participation.readinessStatus,
        custom: {},
        dataOrigin: "demo",
      },
    );
  }

  // The name keys by which a registration finds a laboratory or an institution that exists.
  for (const institution of DEMO_INSTITUTIONS) {
    const key = organisationKey.institution(institution.name, institution.countryCode);
    if (key === null) continue;
    add(
      "identityKeys",
      COLLECTIONS.identityKeys.docPath(identityKeyId("institution", "nameAffiliation", key, hashKey)),
      {
        entityType: "institution",
        keyKind: "nameAffiliation",
        entityIds: [institution.id],
        status: "active",
        mergedIntoId: null,
      },
    );
  }
  for (const laboratory of DEMO_LABORATORIES) {
    const key = organisationKey.laboratory(laboratory.institutionId, laboratory.name);
    if (key === null) continue;
    add(
      "identityKeys",
      COLLECTIONS.identityKeys.docPath(identityKeyId("laboratory", "nameAffiliation", key, hashKey)),
      {
        entityType: "laboratory",
        keyKind: "nameAffiliation",
        entityIds: [laboratory.id],
        status: "active",
        mergedIntoId: null,
      },
    );
  }

  for (const configuration of DEMO_EQUIPMENT) {
    const { id, laboratoryId, isCurrent, supersedesId, ...stated } = configuration;
    add("laboratoryEquipment", COLLECTIONS.laboratoryEquipment.docPath(laboratoryId, id), {
      laboratoryId,
      ...stated,
      ...(stated.samplingRatesHz === undefined ? {} : { samplingRatesHz: [...stated.samplingRatesHz] }),
      isCurrent,
      validFrom: timestamp,
      validTo: isCurrent ? null : timestamp,
      supersedesId,
    });
  }
  for (const requirement of DEMO_REQUIREMENTS) {
    add(
      "replicationEquipmentRequirements",
      COLLECTIONS.replicationEquipmentRequirements.docPath(requirement.replicationId, requirement.requirementKey),
      {
        replicationId: requirement.replicationId,
        requirementKey: requirement.requirementKey,
        operator: requirement.operator,
        ...(requirement.value === undefined ? {} : { value: requirement.value }),
        isMandatory: requirement.isMandatory,
      },
    );
  }

  // The checklist and the restricted detail of each participation, as `createParticipation`
  // would have made them, advanced as far as its readiness says.
  for (const participation of DEMO_PARTICIPATIONS) {
    const id = participationId(participation.replicationId, participation.laboratoryId);
    const approved = participation.readinessStatus === "approved";
    const done = approved
      ? ONBOARDING_CHECKLIST_TEMPLATE.items.length
      : participation.readinessStatus === "inProgress"
        ? 3
        : 0;
    ONBOARDING_CHECKLIST_TEMPLATE.items.forEach((item, position) => {
      add("participationChecklist", COLLECTIONS.participationChecklist.docPath(id, item.key), {
        participationId: id,
        templateKey: ONBOARDING_CHECKLIST_TEMPLATE.key,
        templateItemKey: item.key,
        label: item.label,
        status: position < done ? "done" : "notStarted",
        completedBy: position < done ? SEED_DEMO_ACTOR : null,
        completedAt: position < done ? timestamp : null,
        position,
        replicationId: participation.replicationId,
        laboratoryId: participation.laboratoryId,
        scopeKeys: unitScopeKeys(participation.replicationId, participation.laboratoryId),
      });
    });
    add("participationDetail", COLLECTIONS.participationDetail.docPath(id), {
      ethicsStatus: approved ? "approved" : participation.readinessStatus === "inProgress" ? "submitted" : "unknown",
      ...(approved ? { ethicsReference: `DEMO-ETHICS-${participation.laboratoryId.slice(9).toUpperCase()}` } : {}),
      trainingStatus: approved ? "completed" : "unknown",
      readinessApprovedBy: approved ? SEED_DEMO_ACTOR : null,
      readinessApprovedAt: approved ? timestamp : null,
    });
  }

  for (const source of DEMO_SOURCES) {
    add("sources", COLLECTIONS.sources.docPath(source.key), {
      ...source,
      lastFetchedAt: Timestamp.fromDate(new Date(DEMO_BATCH_STARTED_AT)),
    });
  }

  // One applied import batch of the first source: it created a historical figure, matched the
  // contact document of a person without changing it, and raised the items of the review queue.
  const batchStartedAt = new Date(DEMO_BATCH_STARTED_AT);
  const batchId = importBatchId(batchStartedAt, sha256Hex("synthetic demonstration batch"));
  const items = [
    {
      id: "demo-item-gamma-lead",
      kind: "conflictingLead",
      entityRefs: [
        { entityType: "replication", entityId: "DemoGamma2010" },
        { entityType: "person", entityId: "demo-person-dev" },
      ],
      field: "leadPersonIds",
      candidates: [
        { key: "demo-a/leads:dev", valueSource: "Dev Fictional", sourceRecordId: "demo-source-gamma-leads-a" },
        { key: "demo-b/leads:none", valueSource: "No lead named", sourceRecordId: "demo-source-gamma-leads-b" },
      ],
    },
    {
      id: "demo-item-beta-title",
      kind: "valueConflict",
      entityRefs: [{ entityType: "replication", entityId: "DemoBeta2005" }],
      field: "originalTitle",
      candidates: [
        {
          key: "demo-a/title:1",
          valueSource: "A made-up account of memory and an imagined rhythm",
          sourceRecordId: "demo-source-beta-title-a",
        },
        {
          key: "demo-b/title:2",
          valueSource: "A made up account of memory, and of an imagined rhythm",
          sourceRecordId: "demo-source-beta-title-b",
        },
      ],
    },
    {
      id: "demo-item-mock-duplicate",
      kind: "duplicatePerson",
      entityRefs: [
        { entityType: "person", entityId: "demo-person-hana" },
        { entityType: "person", entityId: "demo-person-hugo" },
      ],
      candidates: [],
    },
  ] as const;
  for (const item of items) {
    const { id, ...fields } = item;
    add("reconciliationItems", COLLECTIONS.reconciliationItems.docPath(id), {
      ...fields,
      entityRefs: fields.entityRefs.map((ref) => ({ ...ref })),
      candidates: fields.candidates.map((candidate) => ({ ...candidate })),
      sourceKey: "demo-a",
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      batchId,
    });
  }
  const startedAt = Timestamp.fromDate(batchStartedAt);
  add("importBatches", COLLECTIONS.importBatches.docPath(batchId), {
    sourceKey: "demo-a",
    mode: "apply",
    status: "applied",
    contentHash: sha256Hex("synthetic demonstration batch"),
    startedBy: "system:import",
    startedAt,
    finishedAt: Timestamp.fromDate(new Date(batchStartedAt.getTime() + 42_000)),
    stats: { rowsRead: 14, created: 1, updated: 0, matched: 1, itemsRaised: items.length },
    observedOn: DEMO_BATCH_STARTED_AT.slice(0, 10),
  });
  const stored = (path: string) => documents.find((document) => document.path === path)?.data ?? null;
  const aggregatePath = COLLECTIONS.historicalAggregates.docPath(
    historicalAggregateId("nLabsSigned", "demo-source-demoalpha2001"),
  );
  const contactPath = COLLECTIONS.personContact.docPath("demo-person-ben");
  const changes = [
    {
      documentPath: aggregatePath,
      operation: "create",
      relation: "created",
      before: null,
      after: stored(aggregatePath),
    },
    {
      documentPath: contactPath,
      operation: "update",
      relation: "matched",
      before: stored(contactPath),
      after: stored(contactPath),
    },
    ...items.map((item) => {
      const path = COLLECTIONS.reconciliationItems.docPath(item.id);
      return { documentPath: path, operation: "create", relation: "created", before: null, after: stored(path) };
    }),
  ];
  changes.forEach((change, index) => {
    append("importBatchChanges", COLLECTIONS.importBatchChanges.docPath(batchId, sequenceId(index + 1)), {
      batchId,
      ...change,
      sourceRecordIds: ["demo-source-demoalpha2001"],
    });
  });
  const log = [
    { level: "info", message: `Applied: 1 created, 0 updated, 1 matched, ${items.length} items raised.` },
    { level: "warning", message: "1 row could not be read mechanically and waits in the review queue." },
  ] as const;
  log.forEach((entry, index) => {
    append("importBatchLog", COLLECTIONS.importBatchLog.docPath(batchId, sequenceId(index + 1)), { batchId, ...entry });
  });

  for (const account of DEMO_ACCOUNTS) {
    add("users", COLLECTIONS.users.docPath(account.uid), {
      emailLower: normaliseEmail(account.email),
      displayName: account.displayName,
      personId: account.personId,
      status: "active",
      mfaEnrolled: false,
      lastSeenAt: timestamp,
      dataOrigin: "demo",
    });
    if (account.personId === null) continue;
    // The account has claimed its person already, with what the claim function writes for a match.
    const roles = demoImpliedRoles(account.personId);
    const assignmentIds = roles.map((role) => roleAssignmentId(account.uid, role.role, role.scopeType, role.scopeId));
    roles.forEach((role, index) => {
      const granted = role.status === "active";
      add("roleAssignments", COLLECTIONS.roleAssignments.docPath(assignmentIds[index] ?? ""), {
        uid: account.uid,
        role: role.role,
        scopeType: role.scopeType,
        scopeId: role.scopeId,
        status: role.status,
        grantedBy: granted ? SEED_DEMO_ACTOR : null,
        grantedAt: granted ? timestamp : null,
        expiresAt: null,
        revokedBy: null,
        revokedAt: null,
        history: [],
      });
    });
    add("accountClaims", COLLECTIONS.accountClaims.docPath(account.uid), {
      uid: account.uid,
      status: "approved",
      personId: account.personId,
      submittedAt: timestamp,
    });
    add("accountClaimReview", COLLECTIONS.accountClaimReview.docPath(account.uid), {
      uid: account.uid,
      candidatePersonIds: [account.personId],
      matchBasis: "primaryEmail",
      evidence: { automatic: true, createdRoleAssignmentIds: assignmentIds },
      reviewedBy: null,
      reviewedAt: null,
      history: [],
    });
  }

  // The first sign-in with the demonstration administrator's address becomes a programme administrator.
  documents.push({
    path: bootstrapAdminPath(bootstrapAdminId(DEMO_BOOTSTRAP_ADMIN_EMAIL, hashKey)),
    data: bootstrapAdminRecordSchema.parse({ ...standard, schemaVersion: 1, usedAt: null, usedBy: null }),
  });
  return documents;
}

/**
 * Writes the demonstration world: the lookup data, the demonstration accounts, the documents of
 * `demoDocuments` and the access document of each account, resolved from what was written.
 * Everything is fictitious, every fact-like document is labelled `dataOrigin: "demo"`, and
 * every document names this command as its author. A document that exists already is left as
 * it is, so running the command again changes nothing.
 */
export async function seedDemo(
  handles: AdminHandles,
  projectId: string,
  now: Date = new Date(),
  hashKey: string = emulatorHashKey(),
): Promise<SeedSummary> {
  const { db, auth } = handles;
  const lookups = await seedLookups(db, projectId, now);
  const summary: SeedSummary = { projectId, created: 0, unchanged: 0, updated: 0, lookupsCreated: lookups.created };
  const count = (written: boolean) => {
    if (written) summary.created += 1;
    else summary.unchanged += 1;
  };

  for (const account of DEMO_ACCOUNTS) {
    const existing = await auth.getUser(account.uid).catch((error: { code?: string }) => {
      if (error.code === "auth/user-not-found") return null;
      throw error;
    });
    if (existing === null) {
      await auth.createUser({
        uid: account.uid,
        email: account.email,
        emailVerified: true,
        displayName: account.displayName,
      });
    }
    count(existing === null);
  }

  for (const document of demoDocuments(now, hashKey)) {
    const reference = db.doc(document.path);
    count(
      await db.runTransaction(async (transaction) => {
        if ((await transaction.get(reference)).exists) return false;
        transaction.create(reference, document.data);
        return true;
      }),
    );
  }

  // The access document of each account, resolved from the world as it is stored now.
  const reader = adminReader(db);
  for (const account of DEMO_ACCOUNTS) {
    const sources = await readAccessSources(reader, account.uid, now);
    if (sources === null) continue;
    const { write } = planAccessOf(sources, {
      now: Timestamp.fromDate(now),
      actor: SEED_DEMO_ACTOR,
      writeContext: systemWriteContext(),
    });
    const reference = db.doc(COLLECTIONS.access.docPath(account.uid));
    if (write.kind === "create") await reference.create(write.document);
    else if (write.kind === "update") await reference.update(write.changes);
    if (write.kind === "update") summary.updated += 1;
    else count(write.kind === "create");
  }
  return summary;
}

export const seedDemoCommand: Command = {
  name: "seed:demo",
  summary: "Write the synthetic demonstration world to the Local Emulator Suite.",
  async run() {
    // Refuses here, before the Admin SDK is touched, unless the emulators are the target.
    const target = requireEmulatorTarget();
    await requireRunningEmulators(target);
    const summary = await seedDemo(connectToEmulators(target), target.projectId);
    console.log(
      `seed:demo wrote to ${summary.projectId} (emulator): ${summary.created} created, ${summary.unchanged} unchanged` +
        `${summary.updated > 0 ? `, ${summary.updated} access documents updated` : ""}` +
        `${summary.lookupsCreated > 0 ? `, and ${summary.lookupsCreated} lookup documents created` : ""}.`,
    );
    console.log(
      `The world is synthetic: ${DEMO_PERSONS.length} persons, ${DEMO_LABORATORIES.length} laboratories at ` +
        `${DEMO_INSTITUTIONS.length} institutions and ${DEMO_REPLICATIONS.length} replications. Nobody in it exists.`,
    );
    console.log(`Demonstration accounts: ${DEMO_ACCOUNTS.map((account) => account.email).join(", ")}`);
    console.log(
      `Sign in as ${DEMO_BOOTSTRAP_ADMIN_EMAIL} to become the programme administrator of the emulator ` +
        `(a record in ${BOOTSTRAP_ADMINS_COLLECTION}). The second factor is switched off in this world.`,
    );
    return undefined;
  },
};
