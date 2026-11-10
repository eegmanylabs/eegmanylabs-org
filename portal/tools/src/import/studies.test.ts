// Unit tests of the one routine through which every source resolves a study. The study
// identifiers are invented.
import { COLLECTIONS } from "@eegml/shared";
import { describe, expect, it } from "vitest";
import { fakeFirestore } from "./fixtures/fake-firestore";
import { STUDY_ID_PATTERN, StudyResolver } from "./studies";

const index = (folded: string, ...replicationIds: string[]) => ({
  [COLLECTIONS.studyAliasIndex.docPath(folded)]: { replicationIds },
});

describe("StudyResolver", () => {
  it("resolves a spelling through its lookup fold: case, diacritics and punctuation make no difference", async () => {
    const resolver = new StudyResolver(fakeFirestore(index("muller2003", "Muller2003")).db);
    for (const spelling of ["Muller2003", "Müller2003", " muller2003 ", "Muller2003_", "Müller 2003"]) {
      expect(await resolver.resolve(spelling), spelling).toEqual({ status: "resolved", replicationId: "Muller2003" });
    }
  });

  it("leaves a spelling unresolved that the lookup does not hold, and matches nothing by similarity", async () => {
    const resolver = new StudyResolver(fakeFirestore(index("alphamaster2008", "AlphaMaster2008")).db);
    expect(await resolver.resolve("AlphaMaster2007")).toEqual({ status: "unresolved" });
    expect(await resolver.resolve("AlphaMaster")).toEqual({ status: "unresolved" });
    expect(await resolver.resolve("  ")).toEqual({ status: "unresolved" });
  });

  it("reports a spelling that two replications carry, as one BIDS name does", async () => {
    const resolver = new StudyResolver(fakeFirestore(index("alph", "AlphaGamma2002", "AlphaBeta2001")).db);
    expect(await resolver.resolve("Alph")).toEqual({
      status: "ambiguous",
      replicationIds: ["AlphaBeta2001", "AlphaGamma2002"],
    });
  });

  it("resolves the parts of a combined cell one by one and keeps the cell combined", async () => {
    const resolver = new StudyResolver(fakeFirestore(index("alphabeta2001", "AlphaBeta2001")).db);
    expect(await resolver.resolve("AlphaBeta2001 + AlphaGamma2007")).toEqual({
      status: "combined",
      parts: [
        { raw: "AlphaBeta2001", resolution: { status: "resolved", replicationId: "AlphaBeta2001" } },
        { raw: "AlphaGamma2007", resolution: { status: "unresolved" } },
      ],
    });
  });

  it("resolves what the current plan has declared, beside what is stored", async () => {
    const { db, reads } = fakeFirestore(index("alph", "AlphaBeta2001"));
    const resolver = new StudyResolver(db);
    resolver.declare("Delta1999", "Delta1999");
    resolver.declare("Alph", "AlphaGamma2002");
    expect(await resolver.resolve("delta1999")).toEqual({ status: "resolved", replicationId: "Delta1999" });
    expect(await resolver.resolve("Alph")).toMatchObject({ status: "ambiguous" });
    await resolver.resolve("Alph");
    expect(reads.filter((path) => path.endsWith("/alph"))).toHaveLength(1);
  });

  it("knows the shape of a programme study identifier", () => {
    expect(["AmodioJost2007", "DonkersvanBoxtel2004", "Luck1996"].every((id) => STUDY_ID_PATTERN.test(id))).toBe(true);
    expect(
      ["amodio2007", "Müller2003", "Hajcak2005a", "Vidal2000_", "Luck96"].some((id) => STUDY_ID_PATTERN.test(id)),
    ).toBe(false);
  });
});
