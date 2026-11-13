// Golden values for every identifier derivation. A change to any of them would make a repeated
// import write new documents beside the old ones, so each builder is pinned to literal results
// here. The hashes were checked against an independent SHA-256 and HMAC implementation when
// they were recorded.
// Fixtures are synthetic: invented values on the example.org domain, and a secret made up for these tests.
import { describe, expect, it } from "vitest";
import {
  AUTO_ID_PATTERN,
  acknowledgementId,
  automationRunId,
  candidateStudyId,
  capabilityGrantId,
  contributorId,
  contributorNameHash,
  contributorSheetSourceKey,
  contributorTableId,
  datasetQcListId,
  datasetQcTaskId,
  documentLinkSlotId,
  entityRefId,
  eventFailureId,
  fold,
  generatedDocumentId,
  groupScopeKey,
  historicalAggregateId,
  hypothesisId,
  ID_BUILDERS,
  type IdBuilderName,
  identityKeyId,
  importBatchId,
  importedAffiliationId,
  importedPersonId,
  inactivityFollowUpTaskId,
  institutionCandidateId,
  integrationMappingId,
  isAutoId,
  keyedShortHash,
  labClaimId,
  laboratoryScopeKey,
  lookupFold,
  MEMBERS_SCOPE_KEY,
  mailId,
  nameFold,
  nestedEntityId,
  notificationId,
  onboardingListId,
  opaquePersonSlug,
  organisationKey,
  outreachContactId,
  outreachGroupKey,
  outreachNameHash,
  PROGRAMME_SCOPE_KEY,
  pageContentChunkId,
  pagePermissionId,
  pagePresenceId,
  parseScopeKey,
  participationId,
  personEmailIndexId,
  personEvidenceKey,
  predictionMarketItemId,
  reconciliationFingerprint,
  recordGrantId,
  recruitmentFollowUpListId,
  registeredInstitutionId,
  registeredLaboratoryId,
  replicationMembershipId,
  replicationScopeKey,
  roleAssignmentId,
  roleScopeKey,
  scopeDashboardId,
  searchFold,
  searchIndexId,
  sequenceId,
  sha256Hex,
  shortHash,
  sourceRecordId,
  sourceTabKey,
  splitNestedEntityId,
  statusDefinitionId,
  studyAliasId,
  studyAliasIndexId,
  syncCellStateId,
  syncConflictId,
  syncMappingId,
  syncReviewItemId,
  syncRunId,
  tagId,
  unitScopeKeys,
  userScopeKey,
  vocabularyTermId,
  websiteManuscriptId,
} from "./ids";

const SECRET = "synthetic-secret-for-tests-only-0123456789";

describe("fold", () => {
  it.each([
    ["diacritics", "São Paulo", "sao-paulo"],
    ["case", "SAO PAULO", "sao-paulo"],
    ["surrounding white space", "  São  Paulo! ", "sao-paulo"],
    ["runs of punctuation", "Amodio & Jost (2007)_", "amodio-jost-2007"],
    ["a decomposed and a composed spelling alike", "Müller", "muller"],
    ["the composed spelling", "Müller", "muller"],
    ["compatibility characters", "ﬁne ①", "fine-1"],
    ["a dotted capital I", "İstanbul", "istanbul"],
    ["letters that have no decomposition, which separate", "Straße Søren ŁÓDŹ", "stra-e-s-ren-odz"],
    ["nothing but punctuation", "---", ""],
    ["an empty text", "", ""],
  ])("folds %s", (_label, text, folded) => {
    expect(fold(text)).toBe(folded);
  });

  it("gives the same result when applied twice", () => {
    for (const text of ["  São  Paulo! ", "Amodio & Jost (2007)_", "ŁÓDŹ"]) expect(fold(fold(text))).toBe(fold(text));
  });
});

describe("lookupFold", () => {
  it("keeps only a to z and 0 to 9, so every spelling of a study identifier meets in one key", () => {
    for (const spelling of ["AmodioJost2007", "amodiojost2007", "Amodio-Jost 2007_", " AMODIO_JOST_2007 "]) {
      expect(lookupFold(spelling)).toBe("amodiojost2007");
    }
    expect(lookupFold("Müller2003")).toBe(lookupFold("Muller2003"));
    expect(lookupFold("!!!")).toBe("");
  });
});

describe("sha256Hex", () => {
  it("matches the published test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("hashes the UTF-8 bytes of the text as it is given", () => {
    expect(sha256Hex("Müller")).toBe("a78429899bb825ce667d25d92e2cde488f8a7d6871bb2be7365601cad6b0a8f2");
    expect(sha256Hex("Müller")).not.toBe(sha256Hex("Müller"));
  });

  it("refuses a text with an unpaired surrogate, which has no UTF-8 form", () => {
    expect(() => sha256Hex("a\uD800b")).toThrow(RangeError);
    expect(() => sha256Hex("a\uDC00")).toThrow(RangeError);
    expect(sha256Hex("a\u{1F600}b")).toHaveLength(64);
  });
});

describe("shortHash and keyedShortHash", () => {
  it("keep 20 hexadecimal characters of the hash of the text in NFC", () => {
    expect(shortHash("AmodioJost2007")).toBe("8b1eb44b495a600d1a3c");
    expect(shortHash("Müller")).toBe("a78429899bb825ce667d");
    expect(shortHash("Müller")).toBe("a78429899bb825ce667d");
  });

  it("do not trim or fold: the value is hashed as written", () => {
    expect(shortHash("AmodioJost2007 ")).not.toBe(shortHash("AmodioJost2007"));
    expect(shortHash("amodiojost2007")).not.toBe(shortHash("AmodioJost2007"));
  });

  it("key the hash of a personal value with the secret", () => {
    expect(keyedShortHash("synthetic.person@example.org", SECRET)).toBe("2582f190c9c2f5731bad");
    expect(keyedShortHash("synthetic.person@example.org", `${SECRET}x`)).not.toBe("2582f190c9c2f5731bad");
    expect(keyedShortHash("synthetic.person@example.org", SECRET)).not.toBe(shortHash("synthetic.person@example.org"));
  });

  it.each(["", "short", "x".repeat(31)])("refuse the secret %j, which is too short to protect anything", (secret) => {
    expect(() => keyedShortHash("synthetic.person@example.org", secret)).toThrow(RangeError);
  });
});

/** One literal result for every builder. The type makes a builder without a golden value a compile error. */
const GOLDEN: { readonly [Name in IdBuilderName]: readonly [actual: string | null, expected: string | null] } = {
  entityRefId: [entityRefId("hypothesis", "AmodioJost2007__h01"), "hypothesis__AmodioJost2007__h01"],
  nestedEntityId: [nestedEntityId("lab__0f3a", "config-1"), "lab__0f3a__config-1"],
  roleAssignmentId: [
    roleAssignmentId("uid-1", "lab_coordinator", "laboratory", "lab__0f3a"),
    "uid-1__lab_coordinator__laboratory__lab__0f3a",
  ],
  capabilityGrantId: [capabilityGrantId("uid-1", "demographics.read"), "uid-1__demographics.read"],
  recordGrantId: [recordGrantId("uid-1", "dataset", "ds-1"), "uid-1__dataset__ds-1"],
  labClaimId: [labClaimId("uid-1", "lab__0f3a"), "uid-1__lab__0f3a"],
  personEmailIndexId: [personEmailIndexId("synthetic.person@example.org", SECRET), "2582f190c9c2f5731bad"],
  identityKeyId: [identityKeyId("person", "orcid", "0000-0002-1825-0097", SECRET), "9b44cbde2a75cbca2951"],
  importedPersonId: [importedPersonId(personEvidenceKey.websitePeople("sperson"), SECRET), "p__5e2af6801cca31cdd33b"],
  registeredInstitutionId: [registeredInstitutionId("Example University", "gb"), "inst__008123e1ea36c201a864"],
  registeredLaboratoryId: [registeredLaboratoryId("inst__0f3a", "Sample EEG Laboratory"), "lab__d33e231e7011c59722e3"],
  importedAffiliationId: [importedAffiliationId("h", "people", 1), "h__people__a1"],
  institutionCandidateId: [institutionCandidateId("Example University, Sample City"), "instcand__359afef6134bad95183e"],
  studyAliasId: [studyAliasId("bids", "AmodioJost2007_"), "bids__cddb6bc0be97edc28b39"],
  studyAliasIndexId: [studyAliasIndexId("Amodio-Jost 2007_"), "amodiojost2007"],
  hypothesisId: [hypothesisId(3), "h03"],
  replicationMembershipId: [replicationMembershipId("p__0f3a", "coLead"), "p__0f3a__coLead"],
  statusDefinitionId: [statusDefinitionId("replication", "recruitingLabs"), "replication__recruitingLabs"],
  historicalAggregateId: [
    historicalAggregateId("nLabsSigned", "0123456789abcdef0123"),
    "nLabsSigned__0123456789abcdef0123",
  ],
  vocabularyTermId: [vocabularyTermId("creditRole", "Writing – review & editing"), "creditRole__writingreviewediting"],
  candidateStudyId: [candidateStudyId({ doi: "10.1000/example.doi" }), "cand__39303ff0414138ed44f9"],
  predictionMarketItemId: [
    predictionMarketItemId("First section", "Did you understand the question?", 1),
    "pmq__8923f48f25a5010b341e__1",
  ],
  participationId: [participationId("AmodioJost2007", "lab__0f3a"), "AmodioJost2007__lab__0f3a"],
  acknowledgementId: [acknowledgementId("p__0f3a", "version-1"), "p__0f3a__version-1"],
  outreachContactId: [
    outreachContactId("f", "354e6b841741896a1abf", "Ada Example?", 1, SECRET),
    "oc__f__354e6b841741896a1abf__e7aba9ebf35055fdb49b__1",
  ],
  tagId: [tagId("Follow-up"), "c990fae1b539eca72254"],
  pagePermissionId: [pagePermissionId("role", "lab_member"), "role__lab_member"],
  sequenceId: [sequenceId(42), "000042"],
  pageContentChunkId: [pageContentChunkId(3, 12), "000003__000012"],
  pagePresenceId: [pagePresenceId("uid-synthetic", "AbCdEfGhIjKlMnOpQrSt"), "uid-synthetic__AbCdEfGhIjKlMnOpQrSt"],
  contributorTableId: [contributorTableId("an-invented-file-identifier"), "ctable__231260a4e1fc5c73416f"],
  contributorId: [
    contributorId("an-invented-file-identifier", contributorNameHash("Ada", "Example", SECRET) ?? "", 1),
    "ctr__231260a4e1fc5c73416f__07682aa57abec309b384__1",
  ],
  sourceTabKey: [sourceTabKey("Sheet 1 "), "354e6b841741896a1abf"],
  sourceRecordId: [sourceRecordId("F", "tab-1", "row-1", "aabbccddeeff"), "d5353780f1be271d54e8"],
  importBatchId: [
    importBatchId(new Date("2026-11-10T03:15:00.123Z"), "ab".repeat(32)),
    "run__20261110T031500123Z__abababababab",
  ],
  documentLinkSlotId: [documentLinkSlotId("AmodioJost2007", "signup"), "AmodioJost2007__signup"],
  reconciliationFingerprint: [
    reconciliationFingerprint({
      kind: "valueConflict",
      subject: "AmodioJost2007#targetN",
      candidateKeys: ["D:bb", "H:aa"],
    }),
    "983af40dcccd7e72b752",
  ],
  integrationMappingId: [
    integrationMappingId("doi", "replication", "10.1000/example"),
    "doi__replication__a9f27d96a32e291e28fb",
  ],
  syncMappingId: [syncMappingId("F", "tab-1", "core:participations"), "f5c017c2fbf8de1e331c"],
  syncCellStateId: [syncCellStateId("AmodioJost2007__lab-1", "targetNMain"), "f7f7f8f24a22bc246e7f"],
  syncRunId: [syncRunId("mapping-1", "2026-01-02T03:00:00Z"), "b0c9805a4264f1b6480b"],
  syncConflictId: [syncConflictId("mapping-1", "lab-memory:root-1", "channelCount", "64"), "7ec60f25e2fbd94e69de"],
  syncReviewItemId: [syncReviewItemId("mapping-1", "missingRow", "lab-memory:root-1", ""), "cce5b5f7abec95b8c439"],
  generatedDocumentId: [
    generatedDocumentId("progress", "replication", "AmodioJost2007"),
    "progress__replication__AmodioJost2007",
  ],
  notificationId: [notificationId("mention", "event-1"), "e6decc8170bd9debfd53"],
  mailId: [mailId("synthetic.person@example.org", "claimDecision", "event-1", SECRET), "fe02e91bf82aeebfc6dc"],
  eventFailureId: [eventFailureId("searchIndexer", "0a1b2c3d-event"), "searchIndexer__0a1b2c3d-event"],
  automationRunId: [automationRunId("qcTaskOnArrival", "event-1"), "c155bc9a8303fd5547a0"],
  searchIndexId: [searchIndexId("page", "replication__AmodioJost2007", 0), "page__replication__AmodioJost2007__000000"],
  scopeDashboardId: [scopeDashboardId("laboratory", "lab__0f3a"), "laboratory__lab__0f3a"],
  inactivityFollowUpTaskId: [
    inactivityFollowUpTaskId("AmodioJost2007__lab__0f3a", "2026-03-01"),
    "inactivity__5a3384dcdb973395b3f3",
  ],
  recruitmentFollowUpListId: [recruitmentFollowUpListId("lab__0f3a"), "recruitmentFollowUp__e6274d880e0bed504d50"],
  datasetQcTaskId: [datasetQcTaskId("AmodioJost2007-bremen-main"), "datasetQc__efe1bc3ce24ba653a499"],
  datasetQcListId: [datasetQcListId("AmodioJost2007"), "datasetQcList__8b1eb44b495a600d1a3c"],
  onboardingListId: [onboardingListId("lab__0f3a"), "onboarding__e6274d880e0bed504d50"],
  websiteManuscriptId: [websiteManuscriptId("Synthetic2027Stage1"), "web__Synthetic2027Stage1"],
};

describe("the identifier builders", () => {
  it("have one golden value each", () => {
    expect(Object.keys(GOLDEN).sort()).toEqual(Object.keys(ID_BUILDERS).sort());
  });

  it.each(Object.entries(GOLDEN))("%s gives its golden value", (_name, [actual, expected]) => {
    expect(actual).toBe(expected);
  });

  it("give identifiers that Firestore accepts: no slash, not a dot name and not the reserved form", () => {
    for (const [actual] of Object.values(GOLDEN)) {
      expect(actual).toMatch(/^(?!\.{1,2}$)(?!__.*__$)[^/]+$/);
    }
  });

  it("never give a record that a client could also create the shape of an identifier that Firestore generates", () => {
    // Where a client creates a record under an opaque identifier, the rules accept nothing but
    // the shape that Firestore generates. The identifiers that importers derive for the same
    // collections have another shape, so a client cannot take one before the import writes it.
    const derivedBesideClientRecords: readonly IdBuilderName[] = [
      "importedAffiliationId",
      "documentLinkSlotId",
      "contributorTableId",
      "contributorId",
      "predictionMarketItemId",
      "websiteManuscriptId",
    ];
    for (const name of derivedBesideClientRecords) {
      const actual = GOLDEN[name][0] ?? "";
      expect(isAutoId(actual), name).toBe(false);
      expect(actual, name).toContain("__");
    }
  });
});

describe("the identifier of a manuscript of the public website", () => {
  it("is namespaced, so a publication named like an identifier Firestore generates is never one a client can take", () => {
    // The residual risk of docs/SECURITY.md: a publication identifier of exactly twenty letters
    // and digits had the shape that the rules let a client choose for a new manuscript.
    const publication = "AbCdEfGhIjKlMnOpQrSt";
    expect(isAutoId(publication)).toBe(true);
    expect(websiteManuscriptId(publication)).toBe("web__AbCdEfGhIjKlMnOpQrSt");
    expect(isAutoId(websiteManuscriptId(publication))).toBe(false);
  });

  it("refuses a publication identifier that would break the composite form", () => {
    expect(() => websiteManuscriptId("")).toThrow(RangeError);
    expect(() => websiteManuscriptId("two__parts")).toThrow(RangeError);
  });
});

describe("the identifier that Firestore generates", () => {
  it("is twenty letters and digits", () => {
    expect(isAutoId("AbCdEfGhIjKlMnOpQrSt")).toBe(true);
    expect(isAutoId("0123456789abcdefghij")).toBe(true);
    expect(AUTO_ID_PATTERN.source).toBe("^[A-Za-z0-9]{20}$");
  });

  it.each([
    ["a readable name", "manuscript-1"],
    ["the identifier of a publication on the public website", "Synthetic2027"],
    ["a composite identifier", "replication__SyntheticStudy2002__signup"],
    ["nineteen characters", "AbCdEfGhIjKlMnOpQrS"],
    ["twenty-one characters", "AbCdEfGhIjKlMnOpQrStU"],
    ["twenty characters with a hyphen", "AbCdEfGhIj-lMnOpQrSt"],
    ["twenty characters with a line break after them", "AbCdEfGhIjKlMnOpQrSt\n"],
    ["nothing", ""],
  ])("is not %s", (_label, id) => {
    expect(isAutoId(id)).toBe(false);
  });
});

describe("the identifiers that importers derive", () => {
  it("builds the evidence keys of a person in one spelling for importers and functions", () => {
    expect(personEvidenceKey.websitePeople("sperson")).toBe("web_people:sperson");
    expect(personEvidenceKey.websiteMembers("sample-person")).toBe("web_members:sample-person");
    expect(personEvidenceKey.orcid(" 0000-0002-1825-009x ")).toBe("orcid:0000-0002-1825-009X");
    expect(personEvidenceKey.email(" Synthetic.Person@Example.org ")).toBe("email:synthetic.person@example.org");
    expect(personEvidenceKey.nameAffiliation("Sámple Person", "Example University")).toBe(
      "name:sampleperson@exampleuniversity",
    );
  });

  it("builds the name keys of an institution and a laboratory, which fold spellings alike", () => {
    expect(organisationKey.institution(" Exámple University ", "gb")).toBe("exampleuniversity#GB");
    expect(organisationKey.laboratory("inst__0f3a", "Sample EEG-Laboratory")).toBe("inst__0f3a#sampleeeglaboratory");
    expect(registeredLaboratoryId("inst__0f3a", "sample eeg laboratory")).toBe(
      registeredLaboratoryId("inst__0f3a", "Sample EEG Laboratory"),
    );
    expect(registeredLaboratoryId("inst__0f3b", "Sample EEG Laboratory")).not.toBe(
      registeredLaboratoryId("inst__0f3a", "Sample EEG Laboratory"),
    );
    expect(organisationKey.laboratory("inst__0f3a", " - ")).toBeNull();
    expect(() => registeredInstitutionId("!!", "GB")).toThrow(RangeError);
  });

  it("keys the names of organisations in every script, and keeps names apart that differ outside Latin", () => {
    // Synthetic names in Arabic, Hebrew, Cyrillic, Greek, Chinese, Japanese and Korean.
    for (const name of [
      "جامعة المثال للعلوم العصبية",
      "אוניברסיטת דוגמה",
      "Пример университет",
      "Πανεπιστήμιο Παράδειγμα",
      "示例大学",
      "サンプル大学",
      "예시 대학교",
    ]) {
      expect(organisationKey.institution(name, "GB"), name).not.toBeNull();
      expect(() => registeredInstitutionId(name, "GB")).not.toThrow();
    }
    expect(organisationKey.institution("جامعة المثال", "EG")).toBe("جامعةالمثال#EG");
    // Mixed scripts no longer fold to their Latin part alone.
    expect(registeredLaboratoryId("inst__0f3a", "ЭЭГ Lab")).not.toBe(registeredLaboratoryId("inst__0f3a", "МРТ Lab"));
    expect(registeredLaboratoryId("inst__0f3a", "ЭЭГ Lab")).toBe(registeredLaboratoryId("inst__0f3a", "ээг-lab"));
    expect(registeredLaboratoryId("inst__0f3a", "示例实验室")).not.toBe(
      registeredLaboratoryId("inst__0f3a", "示例研究室"),
    );
    // Latin names fold as before, diacritics included, so the identifiers of earlier registrations hold.
    expect(nameFold("Exámple-University")).toBe(lookupFold("Exámple-University"));
    expect(searchFold("São  Paulo!")).toBe("sao-paulo");
    // Marks of other scripts carry the word and stay.
    expect(nameFold("किताब")).not.toBe(nameFold("कताब"));
    expect(nameFold(" - !! ")).toBe("");
  });

  it("gives no name-and-affiliation key when either part folds to nothing", () => {
    expect(personEvidenceKey.nameAffiliation("Sample Person", " / ")).toBeNull();
    expect(personEvidenceKey.nameAffiliation("", "Example University")).toBeNull();
  });

  it("derives a different person from each evidence key and each secret", () => {
    const people = importedPersonId(personEvidenceKey.websitePeople("sperson"), SECRET);
    expect(importedPersonId(personEvidenceKey.websiteMembers("sperson"), SECRET)).not.toBe(people);
    expect(importedPersonId(personEvidenceKey.websitePeople("sperson"), `${SECRET}-other`)).not.toBe(people);
    expect(() => importedPersonId(" ", SECRET)).toThrow(RangeError);
  });

  it("meets one affiliation string from two sources in one candidate, however it is spelt", () => {
    const candidate = institutionCandidateId("Example University, Sample City");
    expect(institutionCandidateId("  example university ,sample  city ")).toBe(candidate);
    expect(institutionCandidateId("Exámple University, Sample City")).toBe(candidate);
    expect(institutionCandidateId("Example University, Other City")).not.toBe(candidate);
    expect(institutionCandidateId(" , ")).toBeNull();
  });

  it("gives a preview and an apply of one file different batches, and refuses what is no hash or instant", () => {
    const hash = "ab".repeat(32);
    expect(importBatchId(new Date("2026-11-10T03:15:00.124Z"), hash)).not.toBe(
      importBatchId(new Date("2026-11-10T03:15:00.123Z"), hash),
    );
    expect(() => importBatchId(new Date("not a date"), hash)).toThrow(RangeError);
    expect(() => importBatchId(new Date("2026-11-10T03:15:00Z"), "abc")).toThrow(RangeError);
  });

  it("gives an outreach row an identifier without its name, which a tentative mark or a space does not change", () => {
    const contact = outreachContactId("f", "354e6b841741896a1abf", "Ada Example", 1, SECRET);
    expect(contact).toBe("oc__f__354e6b841741896a1abf__e7aba9ebf35055fdb49b__1");
    expect(contact).not.toMatch(/ada|example/i);
    expect(outreachContactId("f", "354e6b841741896a1abf", " ada  example? ", 1, SECRET)).toBe(contact);
    expect(outreachNameHash("Ada Example", SECRET)).toBe("e7aba9ebf35055fdb49b");
    // A second row of the tab with the same name, another tab, another source and another secret each differ.
    expect(outreachContactId("f", "354e6b841741896a1abf", "Ada Example", 2, SECRET)).not.toBe(contact);
    expect(outreachContactId("f", "0123456789abcdef0123", "Ada Example", 1, SECRET)).not.toBe(contact);
    expect(outreachContactId("a", "354e6b841741896a1abf", "Ada Example", 1, SECRET)).not.toBe(contact);
    expect(outreachContactId("f", "354e6b841741896a1abf", "Ada Example", 1, `${SECRET}-other`)).not.toBe(contact);
    // A name of which nothing is left after folding is hashed as written, so two such names stay apart.
    expect(outreachNameHash("?", SECRET)).not.toBe(outreachNameHash("??", SECRET));
    expect(() => outreachContactId("f", "354e6b841741896a1abf", "Ada Example", 0, SECRET)).toThrow(RangeError);
    expect(() => outreachContactId("f", "354e6b841741896a1abf", "Ada Example", 1.5, SECRET)).toThrow(RangeError);
  });

  it("gives a contributor sheet a source key and a table identifier that hold no file identifier", () => {
    const fileIdentifier = "an-invented-file-identifier";
    expect(contributorSheetSourceKey(fileIdentifier)).toBe("ctable-231260a4e1fc5c73416f");
    expect(contributorTableId(fileIdentifier)).toBe("ctable__231260a4e1fc5c73416f");
    // The key of a source holds no separator, and both forms stand for the same file.
    expect(contributorSheetSourceKey(fileIdentifier)).toMatch(/^ctable-[0-9a-f]{20}$/);
    expect(contributorTableId(fileIdentifier).slice(8)).toBe(contributorSheetSourceKey(fileIdentifier).slice(7));
    expect(contributorSheetSourceKey(` ${fileIdentifier} `)).toBe(contributorSheetSourceKey(fileIdentifier));
    expect(contributorSheetSourceKey("another-invented-identifier")).not.toBe(
      contributorSheetSourceKey(fileIdentifier),
    );
    expect(() => contributorSheetSourceKey(" ")).toThrow(RangeError);
    expect(() => contributorTableId("")).toThrow(RangeError);
  });

  it("gives a contributor row an identifier without its name, its row or its order", () => {
    const nameHash = contributorNameHash("Ada", "Example", SECRET);
    expect(nameHash).toBe("07682aa57abec309b384");
    const contributor = contributorId("an-invented-file-identifier", nameHash ?? "", 1);
    expect(contributor).toBe("ctr__231260a4e1fc5c73416f__07682aa57abec309b384__1");
    expect(contributor).not.toMatch(/ada|example|invented/i);
    // Case, spacing and a diacritic change nothing, and the middle name is no part of the key.
    expect(contributorNameHash(" ada ", "EXAMPLE", SECRET)).toBe(nameHash);
    expect(contributorNameHash("Áda", "Example", SECRET)).toBe(nameHash);
    // First name and surname are kept apart: the same letters split elsewhere are another name.
    expect(contributorNameHash("Adae", "Xample", SECRET)).not.toBe(nameHash);
    expect(contributorNameHash("Ada", "Example", `${SECRET}-other`)).not.toBe(nameHash);
    expect(contributorNameHash("Ada", " ", SECRET)).toBeNull();
    expect(contributorNameHash("?", "Example", SECRET)).toBeNull();
    // Another sheet and a second row of the same name each differ.
    expect(contributorId("another-invented-identifier", nameHash ?? "", 1)).not.toBe(contributor);
    expect(contributorId("an-invented-file-identifier", nameHash ?? "", 2)).not.toBe(contributor);
    expect(() => contributorId("an-invented-file-identifier", "Ada Example", 1)).toThrow(RangeError);
    expect(() => contributorId("an-invented-file-identifier", nameHash ?? "", 0)).toThrow(RangeError);
  });

  it("gives a person from a restricted source a slug that repeats the hash of the identifier and no name", () => {
    const personId = importedPersonId(personEvidenceKey.email("synthetic.person@example.org"), SECRET);
    expect(opaquePersonSlug(personId)).toBe(`p-${personId.slice(3)}`);
    expect(opaquePersonSlug(personId)).toMatch(/^p-[0-9a-f]{20}$/);
    expect(() => opaquePersonSlug("ada-example")).toThrow(RangeError);
  });

  it("links the copies of one contact within one study, and no two studies or two people", () => {
    const group = outreachGroupKey("AmodioJost2007", "Ada Example", SECRET);
    expect(group).toBe("ced7157bf018160ecc89");
    expect(outreachGroupKey("amodiojost2007", " Ada Example? ", SECRET)).toBe(group);
    expect(outreachGroupKey("AmodioMaster2008", "Ada Example", SECRET)).not.toBe(group);
    expect(outreachGroupKey("AmodioJost2007", "Bo Fictional", SECRET)).not.toBe(group);
    expect(outreachGroupKey("AmodioJost2007", "Ada Example", `${SECRET}-other`)).not.toBe(group);
    expect(outreachGroupKey("AmodioJost2007", "?", SECRET)).toBeNull();
    expect(outreachGroupKey("", "Ada Example", SECRET)).toBeNull();
  });

  it("gives a survey question an identifier from its section and its text, with an ordinal for an exact repeat", () => {
    const question = predictionMarketItemId("First section", "Did you understand the question?", 1);
    // White space is no part of the identity, so an edit of spacing does not make a new question.
    expect(predictionMarketItemId(" First  section ", "Did you understand\nthe question? ", 1)).toBe(question);
    expect(predictionMarketItemId("First section", "Did you understand the question?", 2)).not.toBe(question);
    expect(predictionMarketItemId("Second section", "Did you understand the question?", 1)).not.toBe(question);
    expect(predictionMarketItemId("", "First section", 1)).toMatch(/^pmq__[0-9a-f]{20}__1$/);
    expect(() => predictionMarketItemId("First section", "  ", 1)).toThrow(RangeError);
    expect(() => predictionMarketItemId("First section", "A question", 0)).toThrow(RangeError);
    expect(() => predictionMarketItemId("First section", "A question", 1.5)).toThrow(RangeError);
  });

  it("keeps the slots of one owner and the affiliations of one tab apart", () => {
    expect(documentLinkSlotId("AmodioJost2007", "signupArchive")).not.toBe(
      documentLinkSlotId("AmodioJost2007", "signup"),
    );
    expect(importedAffiliationId("h", "members", 1)).toBe("h__members__a1");
    expect(importedAffiliationId("ctable__0f3a", "t0", 2)).toBe("ctable__0f3a__t0__a2");
    expect(() => importedAffiliationId("h", "people", -1)).toThrow(RangeError);
  });
});

describe("composite identifiers", () => {
  it("cannot be reached from two different lists of parts", () => {
    // Without the rule on separators, ("AmodioJost2007", "lab__0f3a") and ("AmodioJost2007__lab", "0f3a")
    // would both give AmodioJost2007__lab__0f3a.
    expect(participationId("AmodioJost2007", "lab__0f3a")).toBe("AmodioJost2007__lab__0f3a");
    expect(() => participationId("AmodioJost2007__lab", "0f3a")).toThrow(RangeError);
    expect(() => replicationMembershipId("p", "0f3a__coLead")).toThrow(RangeError);
    expect(() => acknowledgementId("p__0f3a", "version__1")).toThrow(RangeError);
    expect(() => roleAssignmentId("uid__1", "lab_member", "laboratory", "lab-1")).toThrow(RangeError);
    expect(() => recordGrantId("uid__1", "dataset", "ds-1")).toThrow(RangeError);
    expect(() => historicalAggregateId("nLabs__Signed", "0123")).toThrow(RangeError);
    expect(() => nestedEntityId("lab-1", "config__1")).toThrow(RangeError);
  });

  it.each([
    ["an empty part", () => participationId("", "lab-1")],
    ["an empty last part", () => participationId("AmodioJost2007", "")],
    ["a part that ends with an underscore", () => participationId("AmodioJost2007_", "lab-1")],
    ["a part that begins with an underscore", () => participationId("AmodioJost2007", "_lab-1")],
    ["a wide part that ends with an underscore", () => participationId("AmodioJost2007", "lab-1_")],
    ["a slash", () => labClaimId("uid-1", "lab/1")],
    ["white space", () => labClaimId("uid 1", "lab-1")],
    ["a character outside the permitted set", () => statusDefinitionId("replication", "recruiting labs")],
  ])("refuse %s", (_label, build) => {
    expect(build).toThrow(RangeError);
  });

  it("keep an identifier that an importer derived, with its own separator, in the one wide position", () => {
    expect(labClaimId("uid-1", "lab__0f3a__x")).toBe("uid-1__lab__0f3a__x");
    expect(entityRefId("person", "p__0f3a")).toBe("person__p__0f3a");
    expect(searchIndexId("person", "p__0f3a", 2)).toBe("person__p__0f3a__000002");
  });

  it("split the identifier of a nested entity where it was joined", () => {
    expect(splitNestedEntityId("AmodioJost2007__h01")).toEqual(["AmodioJost2007", "h01"]);
    expect(splitNestedEntityId(nestedEntityId("lab__0f3a", "config-1"))).toEqual(["lab__0f3a", "config-1"]);
    expect(() => splitNestedEntityId("h01")).toThrow(RangeError);
    expect(() => splitNestedEntityId("AmodioJost2007__")).toThrow(RangeError);
  });
});

describe("hashed identifiers", () => {
  it("cannot be reached from two different lists of values", () => {
    expect(sourceRecordId("ab", "c", "d", "e")).not.toBe(sourceRecordId("a", "bc", "d", "e"));
    expect(syncCellStateId("a", "bc")).not.toBe(syncCellStateId("ab", "c"));
    // A conflict on a cell that never agreed differs from one whose base was empty or a value.
    const bases = [undefined, null, "", "64"].map((base) => syncConflictId("m", "row", "field", base));
    expect(new Set(bases).size).toBe(4);
    // Row keys and bases may hold a line feed: they are hashed before they are joined.
    expect(syncConflictId("m", "row\nwith a break", "field", "two\nlines")).toMatch(/^[0-9a-f]{20}$/);
    expect(syncReviewItemId("m", "missingRow", "row\nwith a break", "")).toMatch(/^[0-9a-f]{20}$/);
    // A value with a line feed could imitate two values, so it is refused.
    expect(() => sourceRecordId("F", "tab-1\nrow-0", "row-1", "aabb")).toThrow(RangeError);
    expect(() => notificationId("mention\nevent-0", "event-1")).toThrow(RangeError);
    expect(() => identityKeyId("person", "email", "a\nb", SECRET)).toThrow(RangeError);
  });

  it("take an alias as written, so two spellings of one study are two aliases", () => {
    expect(studyAliasId("bids", "amodiojost2007")).toBe("bids__62b0ab35c27ff3d2d231");
    expect(studyAliasId("bids", "AmodioJost2007_")).not.toBe(studyAliasId("bids", "AmodioJost2007"));
    expect(studyAliasId("eegnet", "AmodioJost2007_")).toBe("eegnet__cddb6bc0be97edc28b39");
  });

  it("fold a spelling for the alias index, and give none when nothing is left of it", () => {
    expect(studyAliasIndexId(" AMODIO_JOST_2007 ")).toBe("amodiojost2007");
    expect(studyAliasIndexId("Müller2003")).toBe("muller2003");
    expect(studyAliasIndexId("---")).toBeNull();
  });

  it("canonicalise an email address before it is hashed, and nothing else", () => {
    expect(personEmailIndexId("  Synthetic.Person@Example.ORG ", SECRET)).toBe("2582f190c9c2f5731bad");
    expect(personEmailIndexId("synthetic.person+x@example.org", SECRET)).not.toBe("2582f190c9c2f5731bad");
    expect(mailId(" Synthetic.Person@Example.org", "claimDecision", "event-1", SECRET)).toBe("fe02e91bf82aeebfc6dc");
  });

  it("use the folded label of a vocabulary term, or the hash of the label when the fold cannot serve", () => {
    expect(vocabularyTermId("journal", "Psychophysiology")).toBe("journal__psychophysiology");
    expect(vocabularyTermId("journal", " PSYCHO-physiology ")).toBe("journal__psychophysiology");
    expect(vocabularyTermId("journal", "!!!")).toBe("journal__e84c538e7fe250730ef6");
    expect(vocabularyTermId("journal", "x".repeat(60))).toBe(`journal__${"x".repeat(60)}`);
    expect(vocabularyTermId("journal", "x".repeat(61))).toBe("journal__c508e75f24e25db94dff");
  });

  it("identify a candidate study by its DOI in lower case, or by author, year and title", () => {
    expect(candidateStudyId({ doi: " 10.1000/Example.DOI " })).toBe("cand__39303ff0414138ed44f9");
    expect(candidateStudyId({ firstAuthorSurname: "Müller", year: 2003, title: "A Synthetic Title" })).toBe(
      "cand__t__32797622775718adf49c",
    );
    expect(candidateStudyId({ firstAuthorSurname: "MULLER", year: 2003, title: "a synthetic title!" })).toBe(
      "cand__t__32797622775718adf49c",
    );
    expect(() => candidateStudyId({ doi: "  " })).toThrow(RangeError);
    expect(() => candidateStudyId({ firstAuthorSurname: "", year: 2003, title: "A Synthetic Title" })).toThrow(
      RangeError,
    );
    expect(() => candidateStudyId({ firstAuthorSurname: "Muller", year: 2003.5, title: "A Synthetic Title" })).toThrow(
      RangeError,
    );
  });

  it("give one tag for every spelling of a name", () => {
    expect(tagId("follow up")).toBe("c990fae1b539eca72254");
    expect(tagId("FOLLOWUP")).toBe("c990fae1b539eca72254");
    expect(() => tagId("!!!")).toThrow(RangeError);
  });

  it("key a tab by its exact title, since two titles can fold alike", () => {
    expect(sourceTabKey("Sheet 1")).not.toBe(sourceTabKey("Sheet 1 "));
    expect(sourceTabKey("sheet 1")).not.toBe(sourceTabKey("Sheet 1"));
  });

  it("fingerprint a conflict by kind, subject and candidates, whatever their order and number of mentions", () => {
    const conflict = { kind: "valueConflict", subject: "AmodioJost2007#targetN" };
    expect(reconciliationFingerprint({ ...conflict, candidateKeys: ["H:aa", "D:bb", "D:bb"] })).toBe(
      "983af40dcccd7e72b752",
    );
    expect(reconciliationFingerprint({ ...conflict, candidateKeys: ["H:aa", "D:cc"] })).not.toBe(
      "983af40dcccd7e72b752",
    );
    expect(reconciliationFingerprint({ ...conflict, kind: "unparsedValue", candidateKeys: ["D:bb", "H:aa"] })).not.toBe(
      "983af40dcccd7e72b752",
    );
    expect(
      reconciliationFingerprint(
        { kind: "ambiguousEmail", subject: "p__0f3a#email", candidateKeys: ["G:11", "F:22"] },
        SECRET,
      ),
    ).toBe("51918575be944d24bc73");
  });
});

describe("numbered identifiers", () => {
  it("pad a hypothesis number to two digits", () => {
    expect(hypothesisId(1)).toBe("h01");
    expect(hypothesisId(38)).toBe("h38");
    for (const number of [0, 100, 1.5, -1, Number.NaN]) expect(() => hypothesisId(number)).toThrow(RangeError);
  });

  it("pad a position to six digits, so identifiers sort in the order of the series", () => {
    expect(sequenceId(0)).toBe("000000");
    expect(sequenceId(999_999)).toBe("999999");
    expect([sequenceId(10), sequenceId(9), sequenceId(100)].sort()).toEqual(["000009", "000010", "000100"]);
    for (const position of [-1, 1.5, 1_000_000, Number.NaN]) expect(() => sequenceId(position)).toThrow(RangeError);
  });
});

describe("scope keys", () => {
  it("have the forms of the data model", () => {
    expect(PROGRAMME_SCOPE_KEY).toBe("programme");
    expect(MEMBERS_SCOPE_KEY).toBe("members");
    expect(replicationScopeKey("AmodioJost2007")).toBe("rep:AmodioJost2007");
    expect(laboratoryScopeKey("lab__0f3a")).toBe("lab:lab__0f3a");
    expect(groupScopeKey("analysis-group")).toBe("group:analysis-group");
    expect(userScopeKey("uid-1")).toBe("user:uid-1");
    expect(roleScopeKey("core_team")).toBe("role:core_team");
    expect(() => replicationScopeKey("")).toThrow(RangeError);
    expect(() => laboratoryScopeKey("a/b")).toThrow(RangeError);
  });

  it("are read back into the unit they name, and anything else reads as nothing", () => {
    expect(parseScopeKey(laboratoryScopeKey("lab__0f3a"))).toEqual({ kind: "laboratory", id: "lab__0f3a" });
    expect(parseScopeKey(replicationScopeKey("AmodioJost2007"))).toEqual({ kind: "replication", id: "AmodioJost2007" });
    expect(parseScopeKey(roleScopeKey("core_team"))).toEqual({ kind: "role", id: "core_team" });
    expect(parseScopeKey("lab:with:colon")).toEqual({ kind: "laboratory", id: "with:colon" });
    for (const key of [PROGRAMME_SCOPE_KEY, MEMBERS_SCOPE_KEY, "lab:", ":x", "toString:x", "lab:a/b", ""]) {
      expect(parseScopeKey(key)).toBeNull();
    }
  });

  it("list the replication before the laboratory, as the rules rebuild them", () => {
    expect(unitScopeKeys("AmodioJost2007", "lab__0f3a")).toEqual(["rep:AmodioJost2007", "lab:lab__0f3a"]);
    expect(unitScopeKeys("AmodioJost2007", null)).toEqual(["rep:AmodioJost2007"]);
    expect(unitScopeKeys(null, "lab__0f3a")).toEqual(["lab:lab__0f3a"]);
    expect(unitScopeKeys(null, null)).toEqual([]);
  });
});
