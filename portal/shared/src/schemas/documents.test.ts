// The document schemas of the data model, each with a well-formed document and with the
// documents it must refuse. The checks that hold for every schema alike (strictness, caps,
// standard fields) are in ../collections.test.ts.
// Fixtures are synthetic: invented people, studies and laboratories on the example.org domain.
import { describe, expect, it } from "vitest";
import { COLLECTIONS, type CollectionKey } from "../collections";
import type { FirestoreTimestamp } from "../timestamp";
import type { z } from "../zod";
import { LIMITS, parseStoredDocument, systemWriteContext, userWriteContext, utf8ByteLength } from "./base";

function timestamp(iso: string): FirestoreTimestamp {
  const date = new Date(iso);
  return {
    seconds: Math.floor(date.getTime() / 1000),
    nanoseconds: 0,
    toDate: () => date,
    toMillis: () => date.getTime(),
  };
}

const now = timestamp("2026-01-02T03:04:05Z");

const base = {
  schemaVersion: 1,
  createdAt: now,
  updatedAt: now,
  createdBy: "uid-synthetic",
  updatedBy: "uid-synthetic",
  archivedAt: null,
  writeContext: userWriteContext(),
};

const appendOnlyBase = {
  schemaVersion: 1,
  createdAt: now,
  createdBy: "uid-synthetic",
  writeContext: userWriteContext("event-synthetic"),
};

const schemaOf = (key: CollectionKey): z.ZodType => COLLECTIONS[key].schema;
const accepts = (key: CollectionKey, document: unknown) => schemaOf(key).safeParse(document).success;
const issuesOf = (key: CollectionKey, document: unknown) =>
  (schemaOf(key).safeParse(document).error?.issues ?? []).map((issue) => issue.path.join("."));

const unit = {
  replicationId: "SyntheticStudy2001",
  laboratoryId: "lab-synthetic-1",
  scopeKeys: ["rep:SyntheticStudy2001", "lab:lab-synthetic-1"],
};

const report = {
  ...appendOnlyBase,
  participationId: "SyntheticStudy2001__lab-synthetic-1",
  ...unit,
  asOfDate: "2026-01-01",
  reportKind: "cumulative",
  basis: "labReported",
  entryKind: "new",
  counts: {
    main: { recruited: 12, tested: 10, excluded: 0 },
    rest: { tested: 9 },
    participants: { tested: 11 },
  },
  exclusions: [{ modality: "main", reasonSource: " Too many artefacts ", count: 1 }],
  reportedBy: "uid-synthetic",
  source: "manual",
  dataOrigin: "live",
};

describe("a recruitment report", () => {
  it("is accepted with counts by modality and category", () => {
    expect(issuesOf("recruitmentReports", report)).toEqual([]);
    expect(schemaOf("recruitmentReports").parse(report)).toEqual(report);
  });

  it("keeps a value that is absent absent: an unknown count is never zero", () => {
    const partial = { ...report, counts: { main: { tested: 10 } } };
    const parsed = schemaOf("recruitmentReports").parse(partial) as typeof partial;
    expect(parsed.counts).toEqual({ main: { tested: 10 } });
    expect(Object.keys(parsed.counts)).toEqual(["main"]);
    expect("rest" in parsed.counts).toBe(false);
    expect(accepts("recruitmentReports", { ...report, counts: {} })).toBe(true);
    expect(accepts("recruitmentReports", { ...report, counts: { main: {} } })).toBe(true);
  });

  it("accepts zero, which is a known count", () => {
    expect(accepts("recruitmentReports", { ...report, counts: { main: { excluded: 0 } } })).toBe(true);
  });

  it.each([
    ["a negative count", -1],
    ["a fractional count", 1.5],
    ["a count as text", "12"],
    ["a count that is null", null],
    ["a count that is not a number", Number.NaN],
    ["an infinite count", Number.POSITIVE_INFINITY],
    ["a count as a boolean", true],
    ["a nested count", { value: 3 }],
  ])("rejects %s", (_label, value) => {
    expect(issuesOf("recruitmentReports", { ...report, counts: { main: { tested: value } } })).toEqual([
      "counts.main.tested",
    ]);
  });

  it("has only the three modalities, and no field from which a total of main plus rest could be read", () => {
    for (const modality of ["total", "all", "mainAndRest", "combined"]) {
      expect(
        accepts("recruitmentReports", { ...report, counts: { ...report.counts, [modality]: { tested: 19 } } }),
      ).toBe(false);
    }
    for (const field of ["total", "totals", "totalParticipants", "nTotal", "sum"]) {
      expect(issuesOf("recruitmentReports", { ...report, [field]: 19 })).toEqual([""]);
    }
    const fields = Object.keys(COLLECTIONS.recruitmentReports.schema.shape);
    expect(fields.filter((field) => /total|sum/i.test(field))).toEqual([]);
    // What a reader finds under each modality is what was written, and nothing derived.
    const parsed = schemaOf("recruitmentReports").parse(report) as typeof report;
    expect(Object.keys(parsed.counts).sort()).toEqual(["main", "participants", "rest"]);
  });

  it("rejects a category key that could not be a key of countCategories", () => {
    expect(accepts("recruitmentReports", { ...report, counts: { main: { "tested.today": 1 } } })).toBe(false);
    expect(accepts("recruitmentReports", { ...report, counts: { main: { "": 1 } } })).toBe(false);
  });

  it("carries no field that an update would set: a report is never edited", () => {
    expect(issuesOf("recruitmentReports", { ...report, updatedAt: now })).toEqual([""]);
    expect(issuesOf("recruitmentReports", { ...report, archivedAt: null })).toEqual([""]);
  });

  it("names the report it corrects or withdraws, and a withdrawal carries no counts", () => {
    const correction = { ...report, entryKind: "correction", correctsReportId: "report-1" };
    expect(accepts("recruitmentReports", correction)).toBe(true);
    expect(issuesOf("recruitmentReports", { ...report, entryKind: "correction" })).toEqual(["correctsReportId"]);
    expect(issuesOf("recruitmentReports", { ...report, correctsReportId: "report-1" })).toEqual(["correctsReportId"]);
    const withdrawal = { ...report, entryKind: "void", correctsReportId: "report-1", counts: {}, exclusions: [] };
    expect(accepts("recruitmentReports", withdrawal)).toBe(true);
    expect(issuesOf("recruitmentReports", { ...withdrawal, counts: report.counts })).toEqual(["counts"]);
    expect(issuesOf("recruitmentReports", { ...withdrawal, exclusions: report.exclusions })).toEqual(["exclusions"]);
  });

  it("lets only a centrally verified report name the report it verifies", () => {
    const verified = { ...report, basis: "centrallyVerified", verifiesReportId: "report-1" };
    expect(accepts("recruitmentReports", verified)).toBe(true);
    expect(issuesOf("recruitmentReports", { ...report, verifiesReportId: "report-1" })).toEqual(["verifiesReportId"]);
  });

  it("requires the period of a period report, in order", () => {
    const period = { ...report, reportKind: "period", periodStart: "2025-12-01", periodEnd: "2025-12-31" };
    expect(accepts("recruitmentReports", period)).toBe(true);
    expect(issuesOf("recruitmentReports", { ...period, periodEnd: undefined })).toContain("periodEnd");
    expect(issuesOf("recruitmentReports", { ...report, reportKind: "period" })).toEqual(["periodStart"]);
    expect(issuesOf("recruitmentReports", { ...period, periodEnd: "2025-11-30" })).toEqual(["periodEnd"]);
  });

  it.each([
    ["a date that is not a calendar date", { asOfDate: "2026-02-30" }],
    ["a date with a time", { asOfDate: "2026-01-01T00:00:00Z" }],
    ["a basis outside the list", { basis: "estimated" }],
    ["an exclusion with a negative count", { exclusions: [{ modality: "main", count: -1 }] }],
    ["an exclusion in an unknown modality", { exclusions: [{ modality: "total", count: 1 }] }],
    ["a missing scope", { scopeKeys: undefined }],
    ["a missing reporter", { reportedBy: undefined }],
  ])("rejects %s", (_label, change) => {
    expect(accepts("recruitmentReports", { ...report, ...change })).toBe(false);
  });

  it("keeps the verbatim reason of an exclusion exactly as it was given", () => {
    const parsed = schemaOf("recruitmentReports").parse(report) as typeof report;
    expect(parsed.exclusions[0]?.reasonSource).toBe(" Too many artefacts ");
  });
});

describe("a replication summary", () => {
  const summary = {
    ...base,
    replicationId: "SyntheticStudy2001",
    kind: "recruitment",
    totals: { labReported: { main: { tested: 40 }, participants: { tested: 44 } }, centrallyVerified: {} },
    participationCount: 4,
    reportCount: 9,
    latestAsOfDate: "2026-01-01",
    computedAt: now,
  };

  it("keeps lab-reported and centrally verified totals apart, with unknown values absent", () => {
    expect(issuesOf("replicationSummaries", summary)).toEqual([]);
    expect(accepts("replicationSummaries", { ...summary, totals: {} })).toBe(true);
    expect(accepts("replicationSummaries", { ...summary, totals: { combined: {} } })).toBe(false);
    expect(accepts("replicationSummaries", { ...summary, totals: { labReported: { total: { tested: 1 } } } })).toBe(
      false,
    );
    expect(accepts("replicationSummaries", { ...summary, totals: { labReported: { main: { tested: 1.5 } } } })).toBe(
      false,
    );
  });
});

const person = {
  ...base,
  slug: "synthetic-person",
  displayName: "Synthetic Person",
  laboratoryIds: [],
  replicationIds: [],
  isCoreTeam: false,
  publicListing: "member",
  coreRoles: [],
  userId: null,
  claimedAt: null,
  custom: {},
  dataOrigin: "importedHistorical",
};

describe("a person", () => {
  it("is accepted with directory fields only, and with the provenance of an import", () => {
    expect(issuesOf("persons", person)).toEqual([]);
    const imported = {
      ...person,
      givenName: "Synthetic",
      familyName: "Person",
      orcid: "0000-0002-1825-0097",
      countryCode: "GB",
      countrySource: " United Kingdom ",
      scholarUrl: "https://example.org/scholar/synthetic",
      sourceRecordIds: ["0123456789abcdef0123"],
      fieldSources: { countryCode: "0123456789abcdef0123" },
      importedValues: { displayName: "Synthetic Person" },
      sourceAuthor: { personId: null, nameSource: "S. Person" },
    };
    expect(schemaOf("persons").parse(imported)).toEqual(imported);
  });

  it("holds no contact detail and no special-category field", () => {
    for (const field of ["email", "emails", "postalAddress", "privateNotes", "genderSource", "ethnicityCategory"]) {
      expect(issuesOf("persons", { ...person, [field]: "x" })).toEqual([""]);
    }
  });

  it.each([
    ["an ORCID iD in another form", { orcid: "https://orcid.org/0000-0002-1825-0097" }],
    ["a country that is not a two-letter code", { countryCode: "GBR" }],
    ["a profile link that is no web address", { labUrl: "javascript:alert(1)" }],
    ["a profile link without a scheme", { universityUrl: "example.org/staff" }],
    ["a listing outside the list", { publicListing: "everyone" }],
    ["a map key with a full stop, which would split a field path", { custom: { "a.b": 1 } }],
    ["an explicit undefined where a field may only be absent", { middleName: undefined }],
    ["a login that was never set to null", { userId: undefined }],
  ])("rejects %s", (_label, change) => {
    expect(accepts("persons", { ...person, ...change })).toBe(false);
  });
});

describe("the restricted and special documents of a person", () => {
  const email = { email: "synthetic.person@example.org", kind: "primary", verifiedAt: null, claimEligible: true };

  it("stores an address trimmed and in lower case, with one primary at most", () => {
    expect(issuesOf("personContact", { ...base, emails: [email] })).toEqual([]);
    expect(accepts("personContact", { ...base, emails: [{ ...email, email: "Synthetic.Person@example.org" }] })).toBe(
      false,
    );
    expect(accepts("personContact", { ...base, emails: [{ ...email, email: "not an address" }] })).toBe(false);
    const second = { ...email, email: "second.address@example.org" };
    expect(accepts("personContact", { ...base, emails: [email, second] })).toBe(false);
    expect(accepts("personContact", { ...base, emails: [email, { ...second, kind: "secondary" }] })).toBe(true);
  });

  it("keeps demographic source terms verbatim, with the standardised categories optional", () => {
    const demographics = { ...base, genderSource: " Woman (she/her) ", ethnicitySource: "", recordedAt: now };
    expect(schemaOf("personDemographics").parse(demographics)).toEqual(demographics);
    expect(accepts("personDemographics", { ...demographics, genderCategory: "woman" })).toBe(true);
    expect(accepts("personDemographics", { ...demographics, gender: "woman" })).toBe(false);
  });
});

describe("a correction request", () => {
  const request = {
    ...base,
    uid: "uid-synthetic",
    entityType: "person",
    entityId: "person-synthetic-1",
    field: "displayName",
    proposedValue: "Synthetic Q. Person",
    status: "open",
    resolvedBy: null,
    resolvedAt: null,
  };

  it("names a field of a record and the value proposed for it", () => {
    expect(issuesOf("correctionRequests", request)).toEqual([]);
  });

  it.each([
    "genderSource",
    "genderCategory",
    "genderSelfDescribed",
    "ethnicitySource",
    "ethnicityCategory",
    "ethnicitySelfDescribed",
  ])("never names the special-category field %s", (field) => {
    expect(issuesOf("correctionRequests", { ...request, field })).toEqual(["field"]);
  });

  it("refers only to a kind of record that the entity registry knows", () => {
    expect(accepts("correctionRequests", { ...request, entityType: "spreadsheet" })).toBe(false);
  });
});

describe("a replication and what belongs to it", () => {
  const replication = {
    ...base,
    programmeId: "eegmanylabs",
    studyKey: "SyntheticStudy2001",
    citationStatus: "unverified",
    statusKey: null,
    statusHistoryId: null,
    selectionStatus: "selected",
    leadPersonIds: [],
    vocabulary: [],
    custom: {},
    dataOrigin: "importedHistorical",
  };

  it("is accepted with no status set, which is how a study of unknown status is imported", () => {
    expect(issuesOf("replications", replication)).toEqual([]);
  });

  it("keeps a number and the text it was read from side by side", () => {
    const withSources = {
      ...replication,
      originalN: 24,
      originalNSource: "24 (12 per group) ",
      minEegChannelsSource: "at least 32",
      originalEffectSizeSource: "d = .45",
      originalEffectSizeValue: 0.45,
    };
    expect(schemaOf("replications").parse(withSources)).toEqual(withSources);
    expect(accepts("replications", { ...replication, originalN: "24" })).toBe(false);
    expect(accepts("replications", { ...replication, originalN: 2.5 })).toBe(false);
    expect(accepts("replications", { ...replication, originalNSource: 24 })).toBe(false);
  });

  it.each([
    ["a study identifier with a separator", { studyKey: "Synthetic__Study2001" }],
    ["a study identifier with a slash", { studyKey: "Synthetic/2001" }],
    ["a DOI with a resolver prefix", { originalDoi: "https://doi.org/10.1000/example" }],
    ["a status key that is no key", { statusKey: "recruiting labs" }],
    ["a missing list of leads", { leadPersonIds: undefined }],
  ])("rejects %s", (_label, change) => {
    expect(accepts("replications", { ...replication, ...change })).toBe(false);
  });

  it("keeps the verbatim cells of a hypothesis, including the text null", () => {
    const hypothesis = {
      ...base,
      replicationId: "SyntheticStudy2001",
      hypothesisNumber: "1",
      text: "A synthetic hypothesis.",
      nullSigSource: "null",
      scientificReviewStatus: "unverified",
      analysisStatus: "notStarted",
      resultReviewedBy: null,
      resultReviewedAt: null,
    };
    expect(schemaOf("replicationHypotheses").parse(hypothesis)).toEqual(hypothesis);
    expect(accepts("replicationHypotheses", { ...hypothesis, hypothesisNumber: 1 })).toBe(false);
    expect(accepts("replicationHypotheses", { ...hypothesis, replicated: "yes" })).toBe(false);
  });

  it("keeps an alias as written beside its folded form", () => {
    const alias = {
      ...base,
      replicationId: "SyntheticStudy2001",
      alias: " Synthetic-Study 2001_",
      aliasFolded: "syntheticstudy2001",
      scheme: "sourceTab",
      isCanonical: false,
    };
    expect(schemaOf("replicationAliases").parse(alias)).toEqual(alias);
    expect(accepts("replicationAliases", { ...alias, aliasFolded: "" })).toBe(true);
    expect(accepts("replicationAliases", { ...alias, aliasFolded: "Synthetic-Study" })).toBe(false);
    expect(accepts("replicationAliases", { ...alias, scheme: "nickname" })).toBe(false);
  });

  it("records a change of status once, with the time it took effect and the time it was recorded", () => {
    const entry = {
      ...appendOnlyBase,
      entityType: "replication",
      entityId: "SyntheticStudy2001",
      fromStatusKey: null,
      toStatusKey: "planning",
      effectiveAt: now,
      recordedAt: now,
      changedBy: "uid-synthetic",
      source: "manual",
      replicationId: "SyntheticStudy2001",
      laboratoryId: null,
      scopeKeys: ["members"],
    };
    expect(issuesOf("statusHistory", entry)).toEqual([]);
    expect(accepts("statusHistory", { ...entry, entityType: "person" })).toBe(false);
    expect(issuesOf("statusHistory", { ...entry, updatedAt: now })).toEqual([""]);
  });

  it("labels a historical aggregate as imported, keeps its value verbatim and lets its date be absent", () => {
    const aggregate = {
      ...base,
      replicationIds: ["SyntheticStudy2001", "SyntheticStudy2002"],
      metricKey: "nLabsSigned",
      valueSource: "ca. 12 ",
      sourceRecordId: "0123456789abcdef0123",
      isCurrent: true,
      dataOrigin: "importedHistorical",
    };
    expect(schemaOf("historicalAggregates").parse(aggregate)).toEqual(aggregate);
    expect(accepts("historicalAggregates", { ...aggregate, dataOrigin: "live" })).toBe(false);
    expect(accepts("historicalAggregates", { ...aggregate, replicationIds: [] })).toBe(false);
    expect(accepts("historicalAggregates", { ...aggregate, valueNumeric: "12" })).toBe(false);
  });
});

describe("a participation and its checklist", () => {
  const participation = {
    ...base,
    ...unit,
    status: "invited",
    statusHistoryId: null,
    readinessStatus: "notStarted",
    custom: {},
    dataOrigin: "live",
  };

  it("holds the registry fields and none of the restricted ones", () => {
    expect(issuesOf("participations", participation)).toEqual([]);
    for (const field of ["ethicsStatus", "ethicsReference", "notes", "trainingStatus"]) {
      expect(issuesOf("participations", { ...participation, [field]: "unknown" })).toEqual([""]);
    }
    expect(accepts("participations", { ...participation, laboratoryId: null })).toBe(false);
    expect(accepts("participations", { ...participation, targetNMain: -5 })).toBe(false);
  });

  it("creates an acknowledgement once: it has no field that an update would set", () => {
    const acknowledgement = {
      ...appendOnlyBase,
      participationId: "SyntheticStudy2001__lab-synthetic-1",
      protocolId: "protocol-1",
      protocolVersionId: "version-1",
      personId: "person-synthetic-1",
      acknowledgedAt: now,
      ...unit,
    };
    expect(issuesOf("participationAcknowledgements", acknowledgement)).toEqual([]);
    expect(issuesOf("participationAcknowledgements", { ...acknowledgement, updatedBy: "uid-synthetic" })).toEqual([""]);
  });

  it("refuses a checklist template whose items share a key", () => {
    const template = { ...base, key: "onboarding", items: [{ key: "ethics", label: "Ethics" }] };
    expect(accepts("checklistTemplates", template)).toBe(true);
    expect(accepts("checklistTemplates", { ...template, items: [...template.items, ...template.items] })).toBe(false);
    expect(accepts("checklistTemplates", { ...template, items: [] })).toBe(false);
  });

  it("keeps the three verbatim cells of an outreach contact, with the parsed dates optional", () => {
    const contact = {
      ...base,
      createdBy: "system:import",
      updatedBy: "system:import",
      writeContext: systemWriteContext("import"),
      replicationId: null,
      contactNameSource: " Synthetic Contact",
      contactEmail: "Synthetic.Contact@Example.org ",
      firstContactSource: "03.04.21",
      resultSource: "no reply yet?",
      formatting: { struckThrough: true },
      sourceRecordId: "0123456789abcdef0123",
      scopeKeys: [],
    };
    expect(schemaOf("outreachContacts").parse(contact)).toEqual(contact);
    expect(accepts("outreachContacts", { ...contact, firstContactDate: "03.04.21" })).toBe(false);
    expect(accepts("outreachContacts", { ...contact, firstContactDate: "2021-04-03" })).toBe(true);
  });
});

describe("tasks and pages", () => {
  const task = {
    ...base,
    listId: "list-1",
    ownerUid: null,
    parentId: null,
    ancestorIds: [],
    order: "a0",
    kind: "task",
    title: "A synthetic task",
    mentionUids: [],
    statusKey: "toDo",
    statusHistoryId: null,
    priority: "none",
    completedAt: null,
    assigneeUids: ["uid-synthetic"],
    collaboratorUids: [],
    followerUids: [],
    unclaimedParticipants: [],
    dependsOn: { "task-2": "finishToStart" },
    links: [{ entityType: "replication", entityId: "SyntheticStudy2001" }],
    checklist: { item1: { label: "First step", done: false, order: "a0" } },
    tagIds: [],
    custom: {},
    replicationId: "SyntheticStudy2001",
    laboratoryId: null,
    scopeKeys: ["rep:SyntheticStudy2001"],
  };

  it("accepts a task, and a milestone that leaves the fields of a task unset", () => {
    expect(issuesOf("tasks", task)).toEqual([]);
    expect(accepts("tasks", { ...task, kind: "milestone", dueAt: now, checklist: {}, dependsOn: {} })).toBe(true);
  });

  it.each([
    ["progress above 100 per cent", { progressPercent: 101 }],
    ["a dependency of an unknown kind", { dependsOn: { "task-2": "after" } }],
    ["a link to an unknown kind of record", { links: [{ entityType: "spreadsheet", entityId: "x" }] }],
    ["a description above 100 KiB", { description: "x".repeat(LIMITS.richTextBytes + 1) }],
    ["a description that is above 100 KiB only in bytes", { description: "é".repeat(LIMITS.richTextBytes / 2 + 1) }],
  ])("rejects %s", (_label, change) => {
    expect(accepts("tasks", { ...task, ...change })).toBe(false);
  });

  it("measures rich text in bytes of UTF-8", () => {
    expect(utf8ByteLength("abc")).toBe(3);
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("€")).toBe(3);
    expect(utf8ByteLength("\u{1F600}")).toBe(4);
    expect(accepts("tasks", { ...task, description: "é".repeat(LIMITS.richTextBytes / 2) })).toBe(true);
  });

  it("stores the bytes of a page update, whichever SDK read them", () => {
    const update = {
      ...appendOnlyBase,
      pageId: "page-1",
      updateId: "update-1",
      index: 0,
      count: 1,
      update: new Uint8Array([1, 2, 3]),
      uid: "uid-synthetic",
      clientId: 123456789,
    };
    expect(issuesOf("pageUpdates", update)).toEqual([]);
    expect(accepts("pageUpdates", { ...update, update: { toUint8Array: () => new Uint8Array([1]) } })).toBe(true);
    expect(accepts("pageUpdates", { ...update, update: "AQID" })).toBe(false);
    expect(accepts("pageUpdates", { ...update, update: [1, 2, 3] })).toBe(false);
  });
});

describe("provenance", () => {
  const record = {
    ...base,
    createdBy: "system:import",
    updatedBy: "system:import",
    writeContext: systemWriteContext("import"),
    sourceKey: "F",
    tabKey: "354e6b841741896a1abf",
    rowKey: "syntheticstudy2001",
    rowNumber: 7,
    raw: { "Contact name": " Synthetic Contact", "Date email sent first time": "03.04.21", struckThrough: true, n: 12 },
    rawHash: "aabbccddeeff",
    observedOn: "2026-01-01",
    firstSeenBatchId: "run__20260101T000000Z__aabbccddeeff",
    lastSeenBatchId: "run__20260101T000000Z__aabbccddeeff",
    supersededById: null,
  };

  it("stores a raw row verbatim, whatever its cells hold", () => {
    expect(schemaOf("sourceRecords").parse(record)).toEqual(record);
    expect(accepts("sourceRecords", { ...record, raw: "a row" })).toBe(false);
  });

  it("names every kind of reconciliation item that the migration plan raises", () => {
    const item = {
      ...base,
      kind: "missingFromSource",
      entityRefs: [{ entityType: "replication", entityId: "SyntheticStudy2001" }],
      candidates: [{ key: "F:aa", valueSource: "12 ", sourceRecordId: "0123456789abcdef0123" }],
      status: "open",
      resolvedBy: null,
      resolvedAt: null,
      batchId: "run__20260101T000000Z__aabbccddeeff",
    };
    expect(issuesOf("reconciliationItems", item)).toEqual([]);
    for (const kind of ["duplicatePerson", "conflictingLead", "valueConflict", "structureChange", "privacyReview"]) {
      expect(accepts("reconciliationItems", { ...item, kind })).toBe(true);
    }
    expect(accepts("reconciliationItems", { ...item, kind: "somethingOdd" })).toBe(false);
    expect(accepts("reconciliationItems", { ...item, status: "reopened" })).toBe(false);
  });
});

describe("parseStoredDocument", () => {
  it("leaves out unknown fields at any depth and validates everything else", () => {
    const stored = {
      ...person,
      addedLater: true,
      writeContext: { ...person.writeContext, addedLater: 1 },
      sourceAuthor: { personId: null, nameSource: "S. Person", addedLater: "x" },
    };
    const read = parseStoredDocument(schemaOf("persons"), stored);
    expect(read.success && read.data).toEqual({ ...person, sourceAuthor: { personId: null, nameSource: "S. Person" } });
  });

  it("leaves out unknown fields of the elements of an array", () => {
    const email = { email: "synthetic.person@example.org", kind: "primary", verifiedAt: null, claimEligible: true };
    const read = parseStoredDocument(schemaOf("personContact"), { ...base, emails: [{ ...email, addedLater: 1 }] });
    expect(read.success && read.data).toEqual({ ...base, emails: [email] });
  });

  it("still refuses a document that is wrong in a field the schema knows", () => {
    expect(
      parseStoredDocument(schemaOf("persons"), { ...person, addedLater: true, publicListing: "everyone" }).success,
    ).toBe(false);
    expect(parseStoredDocument(schemaOf("persons"), { ...person, displayName: undefined }).success).toBe(false);
    expect(parseStoredDocument(schemaOf("persons"), null).success).toBe(false);
  });

  it("does not change the document it was given", () => {
    const stored = { ...person, addedLater: true };
    parseStoredDocument(schemaOf("persons"), stored);
    expect(stored.addedLater).toBe(true);
  });
});
