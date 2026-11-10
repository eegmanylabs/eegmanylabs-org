// Unit tests of the one routine through which every source resolves a study. The study
// identifiers are invented.
import { type AliasScheme, COLLECTIONS, lookupFold, studyAliasId } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { fakeFirestore } from "./fixtures/fake-firestore";
import { STUDY_ID_PATTERN, StudyResolver } from "./studies";

const index = (folded: string, ...replicationIds: string[]) => ({
  [COLLECTIONS.studyAliasIndex.docPath(folded)]: { replicationIds },
});

/** One alias beneath its replication, as an importer stores it. */
const alias = (replicationId: string, scheme: AliasScheme, spelling: string) => ({
  [COLLECTIONS.replicationAliases.docPath(replicationId, studyAliasId(scheme, spelling))]: {
    replicationId,
    scheme,
    alias: spelling,
    aliasFolded: lookupFold(spelling),
  },
});

/** A study with its identifier as the website and the programme write it. */
const study = (replicationId: string) => ({
  ...index(lookupFold(replicationId), replicationId),
  ...alias(replicationId, "website", replicationId),
});

describe("StudyResolver", () => {
  it("resolves a spelling through its lookup fold: case, diacritics and punctuation make no difference", async () => {
    const resolver = new StudyResolver(fakeFirestore(study("Muller2003")).db);
    for (const spelling of ["Muller2003", "Müller2003", " muller2003 ", "Muller2003_", "Müller 2003"]) {
      expect(await resolver.resolve(spelling), spelling).toEqual({ status: "resolved", replicationId: "Muller2003" });
    }
  });

  it("leaves a spelling unresolved that the lookup does not hold, and matches nothing by similarity", async () => {
    const resolver = new StudyResolver(fakeFirestore(study("AlphaMaster2008")).db);
    expect(await resolver.resolve("AlphaMaster2007")).toEqual({ status: "unresolved" });
    expect(await resolver.resolve("AlphaMaster")).toEqual({ status: "unresolved" });
    expect(await resolver.resolve("  ")).toEqual({ status: "unresolved" });
  });

  it("resolves through an alias of the schemes that hold identifiers, and through no other scheme", async () => {
    const stored = {
      ...index("alph", "AlphaBeta2001", "AlphaGamma2002"),
      ...alias("AlphaBeta2001", "bids", "Alph"),
      ...alias("AlphaGamma2002", "eegnet", "Alph"),
      ...index("alphabeta2001x", "AlphaBeta2001"),
      ...alias("AlphaBeta2001", "programme", "AlphaBeta2001x"),
    };
    const resolver = new StudyResolver(fakeFirestore(stored).db);
    // A name of another naming scheme is no identifier, however many studies carry it.
    expect(await resolver.resolve("Alph")).toEqual({ status: "unresolved" });
    // Another spelling of the identifier, written in an identifier column and stored as such, resolves.
    expect(await resolver.resolve("alphabeta2001X")).toEqual({ status: "resolved", replicationId: "AlphaBeta2001" });
  });

  it("keeps the identifier of a study resolved when the label of a link of another study equals it", async () => {
    // The display text of a link on the row of Delta1999 reads `AlphaBeta2001`: a wrong label, stored as an alias.
    const stored = {
      ...study("AlphaBeta2001"),
      ...study("Delta1999"),
      ...index("alphabeta2001", "AlphaBeta2001", "Delta1999"),
      ...alias("Delta1999", "sourceLabel", "AlphaBeta2001"),
    };
    const resolver = new StudyResolver(fakeFirestore(stored).db);
    expect(await resolver.resolve("AlphaBeta2001")).toEqual({ status: "resolved", replicationId: "AlphaBeta2001" });
    expect(await resolver.resolve("Delta1999")).toEqual({ status: "resolved", replicationId: "Delta1999" });
  });

  it("leaves an identifier unresolved that only the label of a link carries", async () => {
    // The label on the rows of AlphaMaster2008 reads `AlphaMaster2007`, an identifier that the sources leave open.
    const stored = {
      ...study("AlphaMaster2008"),
      ...index("alphamaster2007", "AlphaMaster2008"),
      ...alias("AlphaMaster2008", "sourceLabel", "AlphaMaster2007"),
      ...alias("AlphaMaster2008", "sourceTab", "AlphaMaster2007"),
    };
    const resolver = new StudyResolver(fakeFirestore(stored).db);
    expect(await resolver.resolve("AlphaMaster2007")).toEqual({ status: "unresolved" });
  });

  it("reports a spelling that two replications carry as an identifier", async () => {
    const stored = {
      ...index("alph2001", "AlphaGamma2002", "AlphaBeta2001"),
      ...alias("AlphaGamma2002", "programme", "Alph2001"),
      ...alias("AlphaBeta2001", "programme", "ALPH2001"),
    };
    const resolver = new StudyResolver(fakeFirestore(stored).db);
    expect(await resolver.resolve("Alph2001")).toEqual({
      status: "ambiguous",
      replicationIds: ["AlphaBeta2001", "AlphaGamma2002"],
    });
  });

  it("resolves the parts of a combined cell one by one and keeps the cell combined", async () => {
    const resolver = new StudyResolver(fakeFirestore(study("AlphaBeta2001")).db);
    expect(await resolver.resolve("AlphaBeta2001 + AlphaGamma2007")).toEqual({
      status: "combined",
      parts: [
        { raw: "AlphaBeta2001", resolution: { status: "resolved", replicationId: "AlphaBeta2001" } },
        { raw: "AlphaGamma2007", resolution: { status: "unresolved" } },
      ],
    });
  });

  it("resolves what the current plan has declared as an identifier, beside what is stored", async () => {
    const { db, reads } = fakeFirestore({ ...index("alph2001", "AlphaBeta2001"), ...alias("AlphaBeta2001", "programme", "Alph2001") });
    const resolver = new StudyResolver(db);
    resolver.declare("Delta1999", "Delta1999", "website");
    resolver.declare("Alph2001", "AlphaGamma2002", "programme");
    // A spelling that the plan declares under another scheme resolves nothing.
    resolver.declare("Delt", "Delta1999", "bids");
    resolver.declare("Delta1999", "AlphaGamma2002", "sourceLabel");
    expect(await resolver.resolve("delta1999")).toEqual({ status: "resolved", replicationId: "Delta1999" });
    expect(await resolver.resolve("Delt")).toEqual({ status: "unresolved" });
    expect(await resolver.resolve("Alph2001")).toMatchObject({ status: "ambiguous" });
    await resolver.resolve("Alph2001");
    expect(reads.filter((path) => path.endsWith("/alph2001"))).toHaveLength(1);
  });

  it("knows the shape of a programme study identifier", () => {
    expect(["AmodioJost2007", "DonkersvanBoxtel2004", "Luck1996"].every((id) => STUDY_ID_PATTERN.test(id))).toBe(true);
    expect(
      ["amodio2007", "Müller2003", "Hajcak2005a", "Vidal2000_", "Luck96"].some((id) => STUDY_ID_PATTERN.test(id)),
    ).toBe(false);
  });
});
