// The published wordings of consent to holding gender and ethnicity: each has a name of its own
// and a day the page can show, and the current one names the condition and the privacy notice.
import { describe, expect, it } from "vitest";
import { isoDateSchema } from "../schemas/base";
import { CURRENT_DEMOGRAPHICS_CONSENT, DEMOGRAPHICS_CONSENT_WORDINGS } from "./demographics-consent";

describe("the wordings of consent", () => {
  it("have distinct versions and a publication day that is a real date", () => {
    const versions = DEMOGRAPHICS_CONSENT_WORDINGS.map((wording) => wording.version);
    expect(new Set(versions).size).toBe(versions.length);
    for (const wording of DEMOGRAPHICS_CONSENT_WORDINGS) {
      expect(isoDateSchema.safeParse(wording.publishedOn).success, wording.version).toBe(true);
      expect(Number.isNaN(new Date(`${wording.publishedOn}T12:00:00Z`).getTime()), wording.version).toBe(false);
    }
  });

  it("names, in the current wording, the condition, the privacy notice and the reading of one member's values", () => {
    const text = CURRENT_DEMOGRAPHICS_CONSENT.sections.map((section) => section.text).join(" ");
    expect(text).toContain("Article 9(2)(a)");
    expect(text).toContain("privacy notice");
    expect(text).toContain("the values of one member at a time");
  });
});
