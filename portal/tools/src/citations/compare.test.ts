// Unit tests of the comparison of a stored reference with what a registry returns. Every title,
// author and DOI here is invented.
import { describe, expect, it } from "vitest";
import { compareCitation, firstAuthorPart, plainTitle, type RetrievedWork, statusOfComparison } from "./compare";

const work = (fields: Partial<RetrievedWork> = {}): RetrievedWork => ({
  doi: "10.1000/invented.2001.01",
  title: "An invented study of nothing in particular",
  subtitle: null,
  years: [2001],
  firstAuthorFamily: "Invented",
  firstAuthorGiven: "Ada",
  containerTitle: "Journal of Synthetic Results",
  type: "journal-article",
  ...fields,
});
const stored = {
  title: "An invented study of nothing in particular",
  year: 2001,
  authors: "Invented, A., & Authors, B.",
};

describe("compareCitation", () => {
  it("finds a reference that agrees in title, year and first author", () => {
    const comparison = compareCitation(stored, work());
    expect(comparison).toEqual({ title: "same", year: "same", firstAuthor: "same" });
    expect(statusOfComparison(comparison)).toBe("verified");
  });

  it("reads a title without regard to case, punctuation, diacritics and markup", () => {
    const title = "AN INVENTED STUDY – of nöthing, in particular.";
    expect(compareCitation({ ...stored, title }, work()).title).toBe("same");
    const marked = work({ title: "An <i>invented</i> study of nothing &amp; in particular" });
    expect(compareCitation(stored, marked).title).toBe("same");
    expect(compareCitation(stored, work({ title: "An invented study of something in particular" })).title).toBe(
      "differs",
    );
    expect(plainTitle("An <i>invented</i>  study &amp; more &#233;")).toBe("An invented study & more é");
    // A registry may hold an ampersand that was encoded twice. It is one ampersand, and no word of the title.
    const twice = work({ title: "An invented study of nothing &amp;amp; in particular" });
    expect(plainTitle(twice.title ?? "")).toBe("An invented study of nothing & in particular");
    expect(compareCitation(stored, twice).title).toBe("same");
  });

  it("accepts a title with or without the subtitle that the registry keeps apart, and nothing shorter", () => {
    const split = work({ title: "An invented study", subtitle: "Of nothing in particular" });
    expect(compareCitation(stored, split).title).toBe("same");
    expect(compareCitation({ ...stored, title: "An invented study" }, split).title).toBe("same");
    expect(compareCitation({ ...stored, title: "An invented" }, split).title).toBe("differs");
  });

  it("accepts any year that the registry gives for the work, and no other", () => {
    expect(compareCitation(stored, work({ years: [2000, 2001] })).year).toBe("same");
    const comparison = compareCitation(stored, work({ years: [2002] }));
    expect(comparison.year).toBe("differs");
    expect(statusOfComparison(comparison)).toBe("mismatch");
  });

  it("finds the first author in an author string of any of the usual styles", () => {
    for (const authors of [
      "Invented, A., & Authors, B.",
      "A. Invented and B. Authors",
      "Invented A; Authors B",
      "Invented et al.",
    ]) {
      expect(compareCitation({ ...stored, authors }, work()).firstAuthor, authors).toBe("same");
    }
    expect(compareCitation({ ...stored, authors: "Authors, B., & Invented, A." }, work()).firstAuthor).toBe("differs");
    // A family name of several words is found whichever part the registry files under the family name.
    expect(
      compareCitation({ ...stored, authors: "Del Mockup, C." }, work({ firstAuthorFamily: "Mockup" })).firstAuthor,
    ).toBe("same");
    expect(firstAuthorPart("Invented, A., & Authors, B.")).toBe("Invented");
  });

  it("leaves a citation unverified where a field cannot be compared, and never calls it verified", () => {
    const withoutAuthor = compareCitation(stored, work({ firstAuthorFamily: null }));
    expect(withoutAuthor.firstAuthor).toBe("notRetrieved");
    expect(statusOfComparison(withoutAuthor)).toBe("unverified");
    const withoutYear = compareCitation({ title: stored.title, authors: stored.authors }, work());
    expect(withoutYear.year).toBe("notStated");
    expect(statusOfComparison(withoutYear)).toBe("unverified");
    // A difference counts even where another field could not be compared.
    expect(statusOfComparison(compareCitation({ title: "Another title", authors: stored.authors }, work()))).toBe(
      "mismatch",
    );
  });
});
