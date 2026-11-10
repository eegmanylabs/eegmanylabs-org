// Golden values for every identifier derivation. A change to any of them would make a repeated
// import write new documents beside the old ones, so each builder is pinned to literal results
// here. The hashes were checked against an independent SHA-256 and HMAC implementation when
// they were recorded.
// Fixtures are synthetic: invented values on the example.org domain, and a secret made up for these tests.
import { describe, expect, it } from "vitest";
import {
  acknowledgementId,
  candidateStudyId,
  capabilityGrantId,
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
  integrationMappingId,
  keyedShortHash,
  labClaimId,
  laboratoryScopeKey,
  lookupFold,
  MEMBERS_SCOPE_KEY,
  mailId,
  nestedEntityId,
  notificationId,
  PROGRAMME_SCOPE_KEY,
  pageContentChunkId,
  pagePermissionId,
  participationId,
  personEmailIndexId,
  reconciliationFingerprint,
  recordGrantId,
  replicationMembershipId,
  replicationScopeKey,
  roleAssignmentId,
  roleScopeKey,
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
  syncMappingId,
  syncRunId,
  tagId,
  unitScopeKeys,
  userScopeKey,
  vocabularyTermId,
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
  participationId: [participationId("AmodioJost2007", "lab__0f3a"), "AmodioJost2007__lab__0f3a"],
  acknowledgementId: [acknowledgementId("p__0f3a", "version-1"), "p__0f3a__version-1"],
  tagId: [tagId("Follow-up"), "c990fae1b539eca72254"],
  pagePermissionId: [pagePermissionId("role", "lab_member"), "role__lab_member"],
  sequenceId: [sequenceId(42), "000042"],
  pageContentChunkId: [pageContentChunkId(3, 12), "000003__000012"],
  sourceTabKey: [sourceTabKey("Sheet 1 "), "354e6b841741896a1abf"],
  sourceRecordId: [sourceRecordId("F", "tab-1", "row-1", "aabbccddeeff"), "d5353780f1be271d54e8"],
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
  generatedDocumentId: [
    generatedDocumentId("progress", "replication", "AmodioJost2007"),
    "progress__replication__AmodioJost2007",
  ],
  notificationId: [notificationId("mention", "event-1"), "e6decc8170bd9debfd53"],
  mailId: [mailId("synthetic.person@example.org", "claimDecision", "event-1", SECRET), "fe02e91bf82aeebfc6dc"],
  eventFailureId: [eventFailureId("searchIndexer", "0a1b2c3d-event"), "searchIndexer__0a1b2c3d-event"],
  searchIndexId: [searchIndexId("page", "replication__AmodioJost2007", 0), "page__replication__AmodioJost2007__000000"],
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

  it("list the replication before the laboratory, as the rules rebuild them", () => {
    expect(unitScopeKeys("AmodioJost2007", "lab__0f3a")).toEqual(["rep:AmodioJost2007", "lab:lab__0f3a"]);
    expect(unitScopeKeys("AmodioJost2007", null)).toEqual(["rep:AmodioJost2007"]);
    expect(unitScopeKeys(null, "lab__0f3a")).toEqual(["lab:lab__0f3a"]);
    expect(unitScopeKeys(null, null)).toEqual([]);
  });
});
