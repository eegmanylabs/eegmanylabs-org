// UNVERIFIED. Written from the Sheets API v4 reference and never run (see http.ts).
//
// One read returns entered values, computed values and the row and column metadata of a tab
// (`getByDataFilter` with grid data). Writes use the values interface with raw input, address a
// row by its developer metadata, skip nulls and ask for the written values back.
import type { SheetScalar } from "@eegml/shared";
import type { DeveloperMetadata, GridCell, SheetsAdapter, SpreadsheetInfo, TabGrid } from "../types";
import { asArray, asNumber, asObject, asString, googleRequest, type Json } from "./http";

const API = "https://sheets.googleapis.com/v4/spreadsheets";

function scalar(value: Json): SheetScalar {
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.numberValue === "number") return value.numberValue;
  if (typeof value.boolValue === "boolean") return value.boolValue;
  return null;
}

function metadataOf(json: Json): DeveloperMetadata {
  const location = asObject(json.location);
  const range = asObject(location.dimensionRange);
  const id = asNumber(json.metadataId);
  const base = { metadataId: id, metadataKey: asString(json.metadataKey), metadataValue: asString(json.metadataValue) };
  if (location.spreadsheet === true || location.dimensionRange === undefined)
    return { ...base, location: { kind: "spreadsheet" } };
  return {
    ...base,
    location: {
      kind: range.dimension === "COLUMNS" ? "column" : "row",
      sheetId: asNumber(range.sheetId),
      index: asNumber(range.startIndex),
    },
  };
}

export function realSheets(): SheetsAdapter {
  const info = async (spreadsheetId: string): Promise<SpreadsheetInfo> => {
    const json = await googleRequest(
      "sheets",
      "GET",
      `${API}/${encodeURIComponent(spreadsheetId)}?fields=${encodeURIComponent("spreadsheetId,properties(title,timeZone),sheets(properties(sheetId,title)),developerMetadata")}`,
    );
    const properties = asObject(json.properties);
    return {
      spreadsheetId,
      title: asString(properties.title),
      timeZone: asString(properties.timeZone),
      sheets: asArray(json.sheets).map((sheet) => {
        const props = asObject(asObject(sheet).properties);
        return { sheetId: asNumber(props.sheetId), title: asString(props.title) };
      }),
      metadata: asArray(json.developerMetadata).map((meta) => metadataOf(asObject(meta))),
    };
  };
  return {
    getSpreadsheet: info,
    readTab: async (spreadsheetId, sheetId): Promise<TabGrid> => {
      const json = await googleRequest(
        "sheets",
        "POST",
        `${API}/${encodeURIComponent(spreadsheetId)}:getByDataFilter`,
        {
          dataFilters: [{ gridRange: { sheetId } }],
          includeGridData: true,
        },
      );
      const sheet = asObject(asArray(json.sheets)[0]);
      const data = asObject(asArray(sheet.data)[0]);
      const rows = asArray(data.rowData).map((rowData) =>
        asArray(asObject(rowData).values).map((value): GridCell | undefined => {
          const cell = asObject(value);
          if (cell.effectiveValue === undefined && cell.userEnteredValue === undefined) return undefined;
          const formula = asString(asObject(cell.userEnteredValue).formulaValue);
          const computed = scalar(asObject(cell.effectiveValue));
          return formula === "" ? { value: computed } : { value: computed, formula };
        }),
      );
      const metadata = [
        ...asArray(data.rowMetadata).flatMap((meta) => asArray(asObject(meta).developerMetadata)),
        ...asArray(data.columnMetadata).flatMap((meta) => asArray(asObject(meta).developerMetadata)),
      ].map((meta) => metadataOf(asObject(meta)));
      return {
        sheetId,
        title: asString(asObject(sheet.properties).title),
        rows,
        metadata,
        metadataCharacters: metadata.reduce(
          (total, meta) => total + meta.metadataKey.length + meta.metadataValue.length,
          0,
        ),
      };
    },
    writeRows: async (spreadsheetId, writes) => {
      const json = await googleRequest(
        "sheets",
        "POST",
        `${API}/${encodeURIComponent(spreadsheetId)}/values:batchUpdateByDataFilter`,
        {
          valueInputOption: "RAW",
          includeValuesInResponse: true,
          responseValueRenderOption: "UNFORMATTED_VALUE",
          data: writes.map((write) => ({
            dataFilter:
              write.row.kind === "metadata"
                ? {
                    developerMetadataLookup: {
                      metadataKey: write.row.metadataKey,
                      metadataValue: write.row.metadataValue,
                      locationType: "ROW",
                    },
                  }
                : {
                    gridRange: {
                      sheetId: write.sheetId,
                      startRowIndex: write.row.index,
                      endRowIndex: write.row.index + 1,
                    },
                  },
            majorDimension: "ROWS",
            values: [write.values],
          })),
        },
      );
      return asArray(json.responses).map((response) =>
        asArray(asArray(asObject(asObject(response).updatedData).values)[0]).map(
          (value): GridCell => ({
            value: typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? value : null,
          }),
        ),
      );
    },
    appendRows: async (spreadsheetId, sheetId, rows) => {
      const title = (await info(spreadsheetId)).sheets.find((sheet) => sheet.sheetId === sheetId)?.title ?? "";
      const range = encodeURIComponent(`'${title.replaceAll("'", "''")}'`);
      const json = await googleRequest(
        "sheets",
        "POST",
        `${API}/${encodeURIComponent(spreadsheetId)}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
        { majorDimension: "ROWS", values: rows },
      );
      const updated = asString(asObject(json.updates).updatedRange);
      const match = /![A-Z]+(\d+)/.exec(updated);
      return match === null ? -1 : Number(match[1]) - 1;
    },
    batchUpdate: async (spreadsheetId, requests) => {
      await googleRequest("sheets", "POST", `${API}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
        requests: requests.map((request) => {
          if ("createDeveloperMetadata" in request) {
            const { metadataKey, metadataValue, location } = request.createDeveloperMetadata;
            return {
              createDeveloperMetadata: {
                developerMetadata: {
                  metadataKey,
                  metadataValue,
                  visibility: "DOCUMENT",
                  location:
                    location.kind === "spreadsheet"
                      ? { spreadsheet: true }
                      : {
                          dimensionRange: {
                            sheetId: location.sheetId,
                            dimension: location.kind === "row" ? "ROWS" : "COLUMNS",
                            startIndex: location.index,
                            endIndex: location.index + 1,
                          },
                        },
                },
              },
            };
          }
          if ("updateDeveloperMetadata" in request) {
            return {
              updateDeveloperMetadata: {
                dataFilters: [{ developerMetadataLookup: { metadataId: request.updateDeveloperMetadata.metadataId } }],
                developerMetadata: { metadataValue: request.updateDeveloperMetadata.metadataValue },
                fields: "metadataValue",
              },
            };
          }
          return {
            deleteDeveloperMetadata: {
              dataFilter: { developerMetadataLookup: { metadataId: request.deleteDeveloperMetadata.metadataId } },
            },
          };
        }),
      });
    },
  };
}
