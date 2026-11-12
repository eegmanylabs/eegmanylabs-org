// UNVERIFIED. Written from the Docs API v1 reference and never run (see http.ts).
//
// A document is read with suggestions shown inline, the only mode that returns indexes usable
// for a write, and every batch carries the revision it was planned against.
import type { DocsAdapter, DocsDocument, DocsRange } from "../types";
import { asArray, asNumber, asObject, asString, googleRequest } from "./http";

const API = "https://docs.googleapis.com/v1/documents";

export function realDocs(): DocsAdapter {
  return {
    getDocument: async (documentId): Promise<DocsDocument> => {
      const json = await googleRequest(
        "docs",
        "GET",
        `${API}/${encodeURIComponent(documentId)}?suggestionsViewMode=SUGGESTIONS_INLINE`,
      );
      // The plain text of the body, placed at its indexes. Index i of the interface is body[i - 1].
      const characters: string[] = [];
      const suggestions: DocsRange[] = [];
      const visit = (elements: readonly unknown[]) => {
        for (const element of elements) {
          const structural = asObject(element);
          for (const run of asArray(asObject(structural.paragraph).elements)) {
            const item = asObject(run);
            const textRun = asObject(item.textRun);
            const start = asNumber(item.startIndex, 1);
            const content = asString(textRun.content);
            [...content].forEach((character, offset) => {
              characters[start - 1 + offset] = character;
            });
            if (asArray(textRun.suggestedInsertionIds).length + asArray(textRun.suggestedDeletionIds).length > 0) {
              suggestions.push({ startIndex: start, endIndex: asNumber(item.endIndex, start) });
            }
          }
          for (const tableRow of asArray(asObject(structural.table).tableRows)) {
            for (const tableCell of asArray(asObject(tableRow).tableCells)) visit(asArray(asObject(tableCell).content));
          }
        }
      };
      visit(asArray(asObject(json.body).content));
      const namedRanges = Object.values(asObject(json.namedRanges)).flatMap((group) =>
        asArray(asObject(group).namedRanges).map((entry) => {
          const range = asObject(entry);
          return {
            name: asString(range.name),
            namedRangeId: asString(range.namedRangeId),
            ranges: asArray(range.ranges).map((piece) => ({
              startIndex: asNumber(asObject(piece).startIndex),
              endIndex: asNumber(asObject(piece).endIndex),
            })),
          };
        }),
      );
      return {
        documentId,
        title: asString(json.title),
        revisionId: asString(json.revisionId),
        body: Array.from(characters, (character) => character ?? " ").join(""),
        namedRanges,
        suggestions,
      };
    },
    batchUpdate: async (documentId, requests, requiredRevisionId) => {
      const json = await googleRequest("docs", "POST", `${API}/${encodeURIComponent(documentId)}:batchUpdate`, {
        requests: requests.map((request) =>
          "insertText" in request
            ? { insertText: { location: { index: request.insertText.index }, text: request.insertText.text } }
            : request,
        ),
        writeControl: { requiredRevisionId },
      });
      return {
        revisionId: asString(asObject(json.writeControl).requiredRevisionId),
        createdRangeIds: asArray(json.replies).map((reply) => {
          const created = asObject(asObject(reply).createNamedRange);
          return created.namedRangeId === undefined ? null : asString(created.namedRangeId);
        }),
      };
    },
  };
}
