// Unit tests of the identity rules. The people, addresses (all on example.org) and iDs here are
// invented: the ORCID iDs are the published sample iDs of the ORCID documentation.
import { COLLECTIONS, identityKeyId, importedPersonId, personEvidenceKey } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { fakeFirestore } from "./fixtures/fake-firestore";
import { IdentityResolver, personEvidence, singleEmail, validOrcid } from "./identity";

const SECRET = "a-synthetic-secret-for-tests-of-32-bytes-or-more";
const keyPath = (kind: string, key: string, entityType = "person") =>
  COLLECTIONS.identityKeys.docPath(identityKeyId(entityType as "person", kind, key, SECRET));
const active = (...entityIds: string[]) => ({ entityIds, status: "active", mergedIntoId: null });

describe("singleEmail", () => {
  it("accepts exactly one address, trimmed and in lower case", () => {
    expect(singleEmail("  Ada.Example@Example.org ")).toBe("ada.example@example.org");
  });

  it("refuses a cell with two addresses, a name, or an address without a domain", () => {
    for (const cell of [
      "ada@example.org; bo@example.org",
      "ada@example.org, bo@example.org",
      "Ada Example",
      "ada@example",
      "ada@",
      "",
      "Ada <ada@example.org>",
    ]) {
      expect(singleEmail(cell), cell).toBeNull();
    }
  });
});

describe("validOrcid", () => {
  it("accepts an iD with a correct ISO 7064 MOD 11-2 check digit, bare or as an address", () => {
    expect(validOrcid("0000-0002-1825-0097")).toBe("0000-0002-1825-0097");
    expect(validOrcid(" https://orcid.org/0000-0002-1694-233x ")).toBe("0000-0002-1694-233X");
  });

  it("refuses an iD whose check digit is wrong, and anything of another shape", () => {
    for (const cell of ["0000-0002-1825-0098", "0000-0002-1694-2330", "0000000218250097", "orcid", ""]) {
      expect(validOrcid(cell), cell).toBeNull();
    }
    expect(personEvidence.orcid("0000-0002-1825-0098")).toBeNull();
  });
});

describe("IdentityResolver.resolvePerson", () => {
  it("creates no person from a name alone", async () => {
    const { db } = fakeFirestore({});
    const resolver = new IdentityResolver(db, SECRET);
    expect(await resolver.resolvePerson([])).toEqual({ status: "unresolved" });
    const byName = personEvidence.nameAffiliation("Ada Example", "University of Nowhere");
    expect(byName).not.toBeNull();
    expect(await resolver.resolvePerson(byName === null ? [] : [byName])).toEqual({ status: "unresolved" });
  });

  it("derives the identifier of a new person from the first evidence key, in the order website, email, ORCID", async () => {
    const resolver = new IdentityResolver(fakeFirestore({}).db, SECRET);
    const email = personEvidence.email("ada@example.org");
    const orcid = personEvidence.orcid("0000-0002-1825-0097");
    const website = personEvidence.websiteMembers("ada-example");
    if (email === null || orcid === null) throw new Error("the fixture evidence is valid");
    expect(await resolver.resolvePerson([orcid, email])).toEqual({
      status: "new",
      personId: importedPersonId(personEvidenceKey.email("ada@example.org"), SECRET),
      basis: "email",
    });
    expect(await resolver.resolvePerson([orcid, email, website])).toEqual({
      status: "new",
      personId: importedPersonId(personEvidenceKey.websiteMembers("ada-example"), SECRET),
      basis: "websitePersonId",
    });
    // The same evidence gives the same identifier on every run, and another secret gives another.
    expect(importedPersonId(website.key, SECRET)).toBe(importedPersonId(website.key, SECRET));
    expect(importedPersonId(website.key, `${SECRET}!`)).not.toBe(importedPersonId(website.key, SECRET));
  });

  it("finds an existing person again through any of their keys", async () => {
    const email = personEvidenceKey.email("ada@example.org");
    const { db } = fakeFirestore({ [keyPath("email", email)]: active("p__known") });
    const resolver = new IdentityResolver(db, SECRET);
    const evidence = personEvidence.email("ADA@example.org");
    expect(
      await resolver.resolvePerson(evidence === null ? [] : [personEvidence.websitePeople("aexample"), evidence]),
    ).toEqual({
      status: "existing",
      personId: "p__known",
      basis: "email",
    });
  });

  it("attaches nothing when the keys of a row name two people", async () => {
    const { db } = fakeFirestore({
      [keyPath("websitePersonId", personEvidenceKey.websitePeople("aexample"))]: active("p__one"),
      [keyPath("email", personEvidenceKey.email("ada@example.org"))]: active("p__two"),
    });
    const email = personEvidence.email("ada@example.org");
    const resolution = await new IdentityResolver(db, SECRET).resolvePerson(
      email === null ? [] : [personEvidence.websitePeople("aexample"), email],
    );
    expect(resolution).toEqual({ status: "ambiguous", personIds: ["p__one", "p__two"], basis: "websitePersonId" });
  });

  it("links a row with a name and an affiliation to exactly one existing person, and creates none on that basis", async () => {
    const key = personEvidenceKey.nameAffiliation("Ada Example", "University of Nowhere") ?? "";
    const one = new IdentityResolver(
      fakeFirestore({ [keyPath("nameAffiliation", key)]: active("p__known") }).db,
      SECRET,
    );
    const evidence = personEvidence.nameAffiliation("ada  EXAMPLE", "University of Nowhère");
    expect(await one.resolvePerson(evidence === null ? [] : [evidence])).toEqual({
      status: "existing",
      personId: "p__known",
      basis: "nameAffiliation",
    });
    const two = new IdentityResolver(
      fakeFirestore({ [keyPath("nameAffiliation", key)]: active("p__a", "p__b") }).db,
      SECRET,
    );
    expect(await two.resolvePerson(evidence === null ? [] : [evidence])).toMatchObject({ status: "ambiguous" });
    // A middle initial makes another key, so the row links to nobody.
    const other = personEvidence.nameAffiliation("Ada B. Example", "University of Nowhere");
    expect(await one.resolvePerson(other === null ? [] : [other])).toEqual({ status: "unresolved" });
  });

  it("never recreates an erased person, and follows a merged key to the person it was merged into", async () => {
    const erased = personEvidenceKey.websiteMembers("gone-person");
    const merged = personEvidenceKey.websiteMembers("merged-person");
    const { db } = fakeFirestore({
      [keyPath("websitePersonId", erased)]: { entityIds: ["p__gone"], status: "erased", mergedIntoId: null },
      [keyPath("websitePersonId", merged)]: { entityIds: ["p__old"], status: "merged", mergedIntoId: "p__kept" },
    });
    const resolver = new IdentityResolver(db, SECRET);
    expect(await resolver.resolvePerson([personEvidence.websiteMembers("gone-person")])).toEqual({ status: "erased" });
    expect(await resolver.resolvePerson([personEvidence.websiteMembers("merged-person")])).toMatchObject({
      status: "existing",
      personId: "p__kept",
    });
  });

  it("resolves a later row of the same plan to the person an earlier row declared", async () => {
    const { db, reads } = fakeFirestore({});
    const resolver = new IdentityResolver(db, SECRET);
    const evidence = personEvidence.websiteMembers("ada-example");
    const first = await resolver.resolvePerson([evidence]);
    if (first.status !== "new") throw new Error("the first row creates the person");
    const [key] = resolver.keyDocuments(first.personId, [evidence], "record-1");
    expect(key).toMatchObject({
      collection: "identityKeys",
      ids: [resolver.keyId(evidence)],
      fixed: { entityType: "person", keyKind: "websitePersonId", status: "active", mergedIntoId: null },
      union: { entityIds: [first.personId] },
    });
    expect(await resolver.resolvePerson([evidence])).toEqual({
      status: "existing",
      personId: first.personId,
      basis: "websitePersonId",
    });
    // The stored key is read once and then remembered.
    expect(reads).toHaveLength(1);
    const slug = resolver.slugDocument(first.personId, "ada-example", "record-1");
    expect(slug.fixed).toMatchObject({ keyKind: "slug" });
    expect(await resolver.holdersOfSlug("ada-example")).toEqual([first.personId]);
  });
});

describe("institutions and laboratories", () => {
  it("are found when a reviewer has confirmed them, and are never created by the resolver", async () => {
    const { db } = fakeFirestore({
      [keyPath("nameAffiliation", "universityofnowhere#GB", "institution")]: active("inst__1"),
      [keyPath("nameAffiliation", "inst__1#examplelab", "laboratory")]: active("lab__1"),
    });
    const resolver = new IdentityResolver(db, SECRET);
    expect(await resolver.resolveInstitution("University of Nowhere", "GB")).toBe("inst__1");
    expect(await resolver.resolveInstitution("University of Nowhere", "DE")).toBeNull();
    expect(await resolver.resolveLaboratory("inst__1", "Example Lab")).toBe("lab__1");
    expect(await resolver.resolveLaboratory("inst__1", "Another Lab")).toBeNull();
  });
});
