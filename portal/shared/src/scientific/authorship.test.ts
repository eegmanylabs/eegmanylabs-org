// Synthetic people and affiliations on invented institutions.
import { describe, expect, it } from "vitest";
import type { AuthorshipEntryDoc } from "../schemas/outputs";
import {
  authorshipText,
  confirmationSummary,
  creditRolesFromRow,
  entryChanged,
  entryConfirmation,
  orderEntries,
} from "./authorship";
import { stamped } from "./test-support";

function entry(personId: string, overrides: Partial<AuthorshipEntryDoc> = {}): AuthorshipEntryDoc {
  return {
    ...stamped("2026-01-01T00:00:00Z"),
    manuscriptId: "manuscript-1",
    personId,
    contributorId: null,
    kind: "author",
    position: 1,
    displayName: personId,
    affiliations: [],
    creditRoles: [],
    contributionRoles: [],
    isCorresponding: false,
    entryRevision: 1,
    confirmation: { status: "pending", revision: 0, respondedAt: null },
    replicationId: "SyntheticStudy2001",
    laboratoryId: null,
    scopeKeys: ["rep:SyntheticStudy2001"],
    ...overrides,
  };
}

describe("creditRolesFromRow", () => {
  it("takes a ticked cell as a role and leaves any other value for a lead to decide", () => {
    const { roles, toReview } = creditRolesFromRow({
      creditRoles: { investigation: true, writingOriginalDraft: "only the methods", software: false, methodology: "" },
    });
    expect(roles).toEqual(["investigation"]);
    expect(toReview).toEqual([{ role: "writingOriginalDraft", valueSource: "only the methods" }]);
  });

  it("gives nothing for a row without roles", () => {
    expect(creditRolesFromRow({ creditRoles: {} })).toEqual({ roles: [], toReview: [] });
  });
});

describe("orderEntries", () => {
  const entries = [
    entry("c", { displayName: "Cara Zed", position: 1 }),
    entry("a", { displayName: "Abe Young", position: 2 }),
    entry("b", { displayName: "Bea Example", position: 3 }),
  ];

  it("keeps the leads' positions for an order by contribution", () => {
    expect(orderEntries(entries, "contribution").map((item) => item.personId)).toEqual(["c", "a", "b"]);
  });

  it("orders by surname for an alphabetical rule", () => {
    expect(orderEntries(entries, "alphabetical").map((item) => item.personId)).toEqual(["b", "a", "c"]);
  });

  it("keeps the leads first, then orders the others by surname", () => {
    const order = orderEntries(entries, "leadsFirstThenAlphabetical", (item) => item.personId === "c");
    expect(order.map((item) => item.personId)).toEqual(["c", "b", "a"]);
  });
});

describe("confirmations", () => {
  it("count a confirmation only while it names the entry's current revision", () => {
    const confirmed = entry("a", {
      entryRevision: 2,
      confirmation: { status: "confirmed", revision: 2, respondedAt: null },
    });
    const outdated = entry("b", {
      entryRevision: 3,
      confirmation: { status: "confirmed", revision: 2, respondedAt: null },
    });
    const contested = entry("c", {
      entryRevision: 1,
      confirmation: { status: "changesRequested", revision: 1, respondedAt: null, note: "My affiliation changed." },
    });
    expect(entryConfirmation(outdated)).toBe("pending");
    expect(confirmationSummary([confirmed, outdated, contested])).toEqual({
      total: 3,
      confirmed: 1,
      pending: 1,
      changesRequested: 1,
    });
  });

  it("change when what the person confirms changes, and not otherwise", () => {
    const before = entry("a", { creditRoles: ["investigation"] });
    expect(entryChanged(before, { ...before })).toBe(false);
    expect(entryChanged(before, { ...before, creditRoles: ["investigation", "software"] })).toBe(true);
    expect(entryChanged(before, { ...before, position: 2 })).toBe(true);
  });
});

describe("authorshipText", () => {
  it("writes the author line, numbered affiliations, iDs, CRediT, contributions and acknowledgements", () => {
    const text = authorshipText(
      { orderingRule: "contribution", orderingNote: "The leads come first." },
      [
        entry("a", {
          displayName: "Ada Sample",
          position: 1,
          affiliations: ["Institute of Invented Studies", "Example University"],
          orcid: "0000-0002-1825-0097",
          isCorresponding: true,
          creditRoles: ["writingOriginalDraft", "conceptualization"],
          contributionRoles: ["writing", "analysis"],
        }),
        entry("b", {
          displayName: "Ben Mock",
          position: 2,
          affiliations: ["Example University"],
          creditRoles: ["investigation"],
          contributionRoles: ["dataCollection"],
        }),
        entry("c", { displayName: "Cy Placeholder", kind: "acknowledgement", contributionRoles: ["recruitment"] }),
      ],
      { title: "A synthetic replication" },
    );
    expect(text).toContain("Ada Sample [1,2 *], Ben Mock [2]");
    expect(text).toContain("1. Institute of Invented Studies\n2. Example University");
    expect(text).toContain("* Corresponding author: Ada Sample");
    expect(text).toContain("Ada Sample: https://orcid.org/0000-0002-1825-0097");
    expect(text).toContain("Ada Sample: Conceptualization, Writing – original draft.");
    expect(text).toContain("Ben Mock: data collection.");
    expect(text).toContain("We thank Cy Placeholder (recruitment) for their contributions.");
    expect(text).toContain("Author order: By contribution, as the leads ordered it. The leads come first.");
    expect(text).not.toContain("Cy Placeholder [");
  });

  it("puts a lead at the head of the author line under leads first, then alphabetical", () => {
    // The save stores the place that the rule gives each person, the lead first.
    const stored = [
      entry("lead", { displayName: "Ben Sample", position: 1, affiliations: ["Example University"] }),
      entry("eli", { displayName: "Eli Madeup", position: 2 }),
      entry("ivy", { displayName: "Ivy Pretend", position: 3 }),
    ];
    const text = authorshipText({ orderingRule: "leadsFirstThenAlphabetical" }, [...stored].reverse(), {
      title: "Synthetic",
    });
    expect(text).toContain("Ben Sample [1], Eli Madeup, Ivy Pretend");
    expect(orderEntries(stored, "leadsFirstThenAlphabetical", (item) => item.personId === "lead")[0]?.personId).toBe(
      "lead",
    );
  });

  it("adds nothing the list does not hold", () => {
    const text = authorshipText({ orderingRule: "alphabetical" }, [entry("a", { displayName: "Ada Sample" })], {
      title: "Bare",
    });
    expect(text).toBe("Bare\n\nAuthors\nAda Sample\n\nAuthor order: Alphabetical by surname.\n");
  });
});
