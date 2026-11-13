// Fixtures are synthetic: invented names and accounts.
import { describe, expect, it } from "vitest";
import {
  COMMENT_MENTIONS_MAX,
  commentMention,
  commentMentionUids,
  commentPlainText,
  commentSegments,
  pageFileContentType,
  pageFilePath,
  pageFileServedType,
  WORKFLOW_TITLE_MAX,
  workflowTitle,
} from "./page-blocks";

describe("a comment body", () => {
  it("holds mentions that are found again, in order and once each", () => {
    const body = `Thanks ${commentMention("uid-ada", "Ada Example")}, and ${commentMention("uid-ben", "Ben Sample")} and ${commentMention("uid-ada", "Ada Example")}.`;
    expect(commentMentionUids(body)).toEqual(["uid-ada", "uid-ben"]);
    expect(commentPlainText(body)).toBe("Thanks @Ada Example, and @Ben Sample and @Ada Example.");
    expect(commentSegments(body)[1]).toEqual({ kind: "mention", uid: "uid-ada", label: "Ada Example" });
  });

  it("keeps a name with brackets from breaking the mention, and reads text without mentions as text", () => {
    expect(commentMention("uid-x", "Odd [Name]")).toBe("@[Odd  Name](uid-x)");
    expect(commentSegments("Plain text only")).toEqual([{ kind: "text", text: "Plain text only" }]);
    expect(commentMentionUids("@[Name](has spaces)")).toEqual([]);
  });

  it("names at most the cap of mentions", () => {
    const body = Array.from({ length: COMMENT_MENTIONS_MAX + 5 }, (_, index) =>
      commentMention(`uid-${index}`, `Person ${index}`),
    ).join(" ");
    expect(commentMentionUids(body)).toHaveLength(COMMENT_MENTIONS_MAX);
  });
});

describe("pageFilePath", () => {
  it("puts a file beneath its page, with a name that holds no separator", () => {
    expect(pageFilePath("pageOne", "AbCdEfGhIjKlMnOpQrSt", "results/figure 1.png")).toBe(
      "pages/pageOne/files/AbCdEfGhIjKlMnOpQrSt/results-figure 1.png",
    );
    expect(() => pageFilePath("page/one", "AbCdEfGhIjKlMnOpQrSt", "a.png")).toThrow(RangeError);
    expect(() => pageFilePath("pageOne", "short", "a.png")).toThrow(RangeError);
  });
});

describe("the type of a file of a page", () => {
  it("is stored as bytes where a browser would run it as a document", () => {
    for (const type of ["text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "text/javascript", ""]) {
      expect(pageFileContentType(type)).toBe("application/octet-stream");
    }
    expect(pageFileContentType("image/PNG")).toBe("image/png");
    expect(pageFileContentType("application/pdf")).toBe("application/pdf");
    expect(pageFileContentType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
  });

  it("is given to a reader as an image only for the images a page shows, and as bytes otherwise", () => {
    expect(pageFileServedType("image/webp")).toBe("image/webp");
    expect(pageFileServedType("application/pdf")).toBe("application/octet-stream");
    expect(pageFileServedType("text/html")).toBe("application/octet-stream");
  });
});

describe("the title a workflow button gives", () => {
  it("puts the day in place of {date}, and falls back on the label", () => {
    expect(workflowTitle({ title: "Weekly check {date}", label: "Add a check" }, "2026-11-13")).toBe(
      "Weekly check 2026-11-13",
    );
    expect(workflowTitle({ title: "  ", label: "Report an issue" }, "2026-11-13")).toBe("Report an issue");
    expect(workflowTitle({ title: "{date} and {date}", label: "x" }, "2026-01-02")).toBe("2026-01-02 and 2026-01-02");
  });

  it("never exceeds the longest title", () => {
    expect(workflowTitle({ title: "x".repeat(500), label: "" }, "2026-11-13")).toHaveLength(WORKFLOW_TITLE_MAX);
  });
});
