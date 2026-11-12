// Generated documents: the text of every template's sections, and the guard that never writes
// over a hand edit. The records are synthetic.
import { describe, expect, it } from "vitest";
import { type ObservedSection, planSection, sectionTextHash } from "./plan";
import { DOCUMENT_TEMPLATES, provenanceLine, renderSections, sectionTag, withoutProvenance } from "./templates";

const provenance = {
  reportDate: "2026-11-11",
  portalUrl: "https://portal.example.org/#/replications/DemoAlpha2001",
  sources: ["participations", "recruitment reports"],
};

describe("the sections of a template", () => {
  it("end each section with its sources, its report date and a link to the portal", () => {
    const sections = renderSections(
      {
        kind: "replicationProgress",
        studyKey: "DemoAlpha2001",
        title: "Synthetic alpha study",
        status: "Collecting",
        publicStage: null,
        participations: [{ laboratory: "Demo Memory Laboratory", status: "Collecting" }],
      },
      provenance,
    );
    expect(Object.keys(sections)).toEqual(["overview", "laboratories"]);
    for (const text of Object.values(sections)) {
      expect(text.split("\n").at(-1)).toBe(provenanceLine(provenance));
      expect(text).toContain("2026-11-11");
      expect(text).toContain(provenance.portalUrl);
    }
    expect(sections.overview).toContain("Public stage: unknown");
    expect(sections.laboratories).toContain("Demo Memory Laboratory | Collecting");
  });

  it("keep the main experiment, resting state and unique participants apart, with unknown never shown as zero", () => {
    const { recruitment } = renderSections(
      {
        kind: "recruitment",
        asOfDate: "2026-11-11",
        category: "Tested",
        sites: [
          {
            laboratory: "Demo Memory Laboratory",
            main: { reported: 12, verified: 10 },
            rest: { reported: null, verified: null },
            participants: { reported: 12, verified: null },
          },
        ],
      },
      provenance,
    );
    expect(recruitment).toContain(
      "reported 12, verified 10 | reported unknown, verified unknown | reported 12, verified unknown",
    );
    expect(recruitment).not.toContain(" 22");
    expect(recruitment).toContain("never added together");
  });

  it("say so in words where there is nothing to show, so a section is never empty", () => {
    const programme = renderSections({ kind: "programmeProgress", replications: [] }, provenance);
    expect(programme.replications).toContain("No replication is recorded.");
    expect(renderSections({ kind: "meetings", meetings: [] }, provenance).meetings).toContain("No meeting");
    expect(renderSections({ kind: "milestones", milestones: [] }, provenance).milestones).toContain("No milestone");
    const laboratory = renderSections(
      { kind: "laboratoryProgress", name: "Demo Lab", description: null, participations: [], equipment: [] },
      provenance,
    );
    expect(laboratory.profile).toContain("No description is recorded.");
    expect(laboratory.equipment).toContain("No current equipment configuration");
  });

  it("orders meetings by date and milestones by due date, undated last", () => {
    const { milestones = "" } = renderSections(
      {
        kind: "milestones",
        milestones: [
          { title: "Undated", dueDate: null, status: "To do" },
          { title: "Later", dueDate: "2027-01-01", status: "To do" },
          { title: "Sooner", dueDate: "2026-12-01", status: "Done" },
        ],
      },
      provenance,
    );
    expect(milestones.indexOf("Sooner")).toBeLessThan(milestones.indexOf("Later"));
    expect(milestones.indexOf("Later")).toBeLessThan(milestones.indexOf("Undated"));
  });

  it("bind one designated field at most, and only on a laboratory's profile", () => {
    const designated = Object.values(DOCUMENT_TEMPLATES).flatMap((template) =>
      template.sections
        .filter((section) => section.designatedField !== undefined)
        .map((section) => [template.kind, section.name]),
    );
    expect(designated).toEqual([["laboratoryProgress", "profile"]]);
    expect(sectionTag("overview")).toBe("{{portal:overview}}");
  });

  it("read a person's text out of a designated section without its provenance line", () => {
    expect(withoutProvenance(`A new description.\n${provenanceLine(provenance)}`)).toBe("A new description.");
    expect(withoutProvenance("The provenance line was deleted too.")).toBe("The provenance line was deleted too.");
  });
});

describe("the guard of a managed section", () => {
  const generated = `Status: Collecting\n${provenanceLine(provenance)}`;
  const intact = (text: string): ObservedSection => ({ found: true, pieces: 1, text, overlapsSuggestion: false });
  const stored = (text: string) => ({ status: "current" as const, textHash: sectionTextHash(text) });

  it("adopts a section whose tag is in a new copy, and reports a template without the tag", () => {
    const missing: ObservedSection = { found: false, pieces: 0, text: null, overlapsSuggestion: false };
    expect(
      planSection({
        generatedText: generated,
        stored: undefined,
        observed: missing,
        tagPresent: true,
        designated: null,
      }),
    ).toEqual({
      kind: "adopt",
      text: generated,
    });
    expect(
      planSection({
        generatedText: generated,
        stored: undefined,
        observed: missing,
        tagPresent: false,
        designated: null,
      }),
    ).toEqual({
      kind: "noTag",
    });
  });

  it("replaces a section that still holds the text last generated, and leaves an unchanged one alone", () => {
    const old = `Status: Planning\n${provenanceLine(provenance)}`;
    expect(
      planSection({
        generatedText: generated,
        stored: stored(old),
        observed: intact(old),
        tagPresent: false,
        designated: null,
      }),
    ).toEqual({
      kind: "replace",
      text: generated,
    });
    expect(
      planSection({
        generatedText: generated,
        stored: stored(generated),
        observed: intact(generated),
        tagPresent: false,
        designated: null,
      }),
    ).toEqual({ kind: "unchanged" });
  });

  it("never writes over a hand edit, a split range or a pending suggestion", () => {
    const old = `Status: Planning\n${provenanceLine(provenance)}`;
    for (const observed of [
      intact(`Status: Planning, said a person\n${provenanceLine(provenance)}`),
      { found: true, pieces: 2, text: old, overlapsSuggestion: false },
      { found: true, pieces: 1, text: old, overlapsSuggestion: true },
    ]) {
      expect(
        planSection({ generatedText: generated, stored: stored(old), observed, tagPresent: false, designated: null })
          .kind,
      ).toBe("handEdited");
    }
  });

  it("offers the edited text of a designated section as a value for the record, against the base", () => {
    const old = `The old description.\n${provenanceLine(provenance)}`;
    const plan = planSection({
      generatedText: `The old description.\n${provenanceLine(provenance)}`,
      stored: { status: "current", textHash: sectionTextHash(old), base: "The old description." },
      observed: intact(`A description a person wrote.\n${provenanceLine(provenance)}`),
      tagPresent: false,
      designated: { field: "description", appValue: "The old description." },
    });
    expect(plan).toEqual({
      kind: "handEdited",
      documentText: `A description a person wrote.\n${provenanceLine(provenance)}`,
      designated: {
        field: "description",
        documentValue: "A description a person wrote.",
        appValue: "The old description.",
        base: "The old description.",
      },
    });
  });

  it("reports a range that has gone, and writes nothing to a detached section", () => {
    const gone: ObservedSection = { found: false, pieces: 0, text: null, overlapsSuggestion: false };
    expect(
      planSection({
        generatedText: generated,
        stored: stored(generated),
        observed: gone,
        tagPresent: false,
        designated: null,
      }),
    ).toEqual({
      kind: "missing",
    });
    expect(
      planSection({
        generatedText: generated,
        stored: { status: "detached", textHash: "x" },
        observed: intact("Human text"),
        tagPresent: false,
        designated: null,
      }),
    ).toEqual({ kind: "detached" });
  });
});
