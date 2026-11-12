// SYNTHETIC DATA. Nothing listed here exists in any Google account.
//
// The Drive that the Google Workspace fake starts with in the emulator: a shared drive holding
// the templates of generated documents and the folder their copies go to, two spreadsheets that
// mappings of `seed:demo` synchronise, and folders that records of the demonstration world link
// to. Every identifier is an invented lower-case word, every name says "synthetic", and the
// account the fake answers as is on the example.org domain. The laboratories and chains of
// equipment are those of `tools/src/fixtures/demo-world.ts`.
import { sectionTag } from "@eegml/shared";
import { DOCS_MIME_TYPE, DRIVE_FOLDER_MIME_TYPE, SHEETS_MIME_TYPE } from "../types";
import type { FakeCell, FakeFile, FakeRow, FakeState } from "./state";

export const FAKE_ACCOUNT = "google-workspace-fake@example.org";
export const FAKE_OWNER = "Synthetic Drive Owner";
/**
 * The synthetic people who may edit the team folder of DemoAlpha2001: the lead of the
 * demonstration world (`tools/src/fixtures/demo-world.ts`), who may therefore link it.
 */
export const FAKE_ALPHA_EDITORS = ["ben.sample@example.org"] as const;

/** The identifiers of the fixtures, for the seed, the tests and the documentation. */
export const FAKE_FILES = {
  sharedDriveRoot: "fake-shared-drive-root",
  generatedFolder: "fake-generated-documents",
  templatesFolder: "fake-templates",
  equipmentRegister: "fake-equipment-register",
  laboratoryDirectory: "fake-laboratory-directory",
  alphaFolder: "fake-alpha-team-folder",
  alphaDrafts: "fake-alpha-stage-one-drafts",
  alphaStageOne: "fake-alpha-stage-one-report",
  alphaTracker: "fake-alpha-recruitment-tracker",
  alphaEthics: "fake-alpha-ethics-approval",
  cognitionFolder: "fake-cognition-lab-folder",
  privateProtocol: "fake-private-protocol",
  /** An Excel workbook kept in Drive, which the Sheets interface refuses. */
  workbook: "fake-historical-workbook",
} as const;

/** The template of each kind of generated document. */
export const FAKE_TEMPLATES = {
  programmeProgress: "fake-template-programme-progress",
  replicationProgress: "fake-template-replication-progress",
  laboratoryProgress: "fake-template-laboratory-progress",
  recruitment: "fake-template-recruitment",
  meetings: "fake-template-meetings",
  milestones: "fake-template-milestones",
} as const;

export const SHARED_DRIVE_ID = "fake-shared-drive";

/** The text that people keep in every template, outside the managed sections. */
export const HUMAN_TEXT = "Notes from the team. The portal never changes this paragraph.";

const HEADER_FORMAT = { bold: true, backgroundColor: "#f3eeea" };

const at = Date.UTC(2026, 9, 1, 9, 0, 0);

function cell(value: FakeCell["v"], extra: Omit<FakeCell, "v"> = {}): FakeCell {
  return { v: value, ...extra };
}

function row(values: readonly (FakeCell | FakeCell["v"])[]): FakeRow {
  return {
    cells: values.map((value) =>
      value !== null && typeof value === "object" ? value : value === null ? null : cell(value),
    ),
    meta: [],
  };
}

function file(
  spec: Omit<FakeFile, "trashed" | "modifiedTime" | "version" | "lastModifier" | "shared"> & {
    readonly shared?: boolean;
  },
): FakeFile {
  return { trashed: false, modifiedTime: at, version: 1, lastModifier: FAKE_OWNER, shared: true, ...spec };
}

function template(id: string, name: string, sections: readonly string[]): FakeFile {
  const lines = [
    `${name} (synthetic template)`,
    ...sections.flatMap((section, index) => [sectionTag(section), ...(index === 0 ? [HUMAN_TEXT] : [])]),
  ];
  return file({
    id,
    name: `${name} (synthetic template)`,
    mimeType: DOCS_MIME_TYPE,
    parents: [FAKE_FILES.templatesFolder],
    driveId: SHARED_DRIVE_ID,
    doc: { body: `${lines.join("\n")}\n`, revision: 1, namedRanges: [], suggestions: [] },
  });
}

/** The state the fake starts from. */
export function initialFakeState(): FakeState {
  const files: FakeFile[] = [
    file({
      id: FAKE_FILES.sharedDriveRoot,
      name: "EEGManyLabs shared drive (synthetic)",
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: [],
      driveId: SHARED_DRIVE_ID,
    }),
    file({
      id: FAKE_FILES.generatedFolder,
      name: "Generated documents (synthetic)",
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: [FAKE_FILES.sharedDriveRoot],
      driveId: SHARED_DRIVE_ID,
    }),
    file({
      id: FAKE_FILES.templatesFolder,
      name: "Templates (synthetic)",
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: [FAKE_FILES.sharedDriveRoot],
      driveId: SHARED_DRIVE_ID,
    }),
    template(FAKE_TEMPLATES.programmeProgress, "Programme progress", ["summary", "replications"]),
    template(FAKE_TEMPLATES.replicationProgress, "Replication progress", ["overview", "laboratories"]),
    template(FAKE_TEMPLATES.laboratoryProgress, "Laboratory progress", ["profile", "participations", "equipment"]),
    template(FAKE_TEMPLATES.recruitment, "Recruitment", ["recruitment"]),
    template(FAKE_TEMPLATES.meetings, "Meetings", ["meetings"]),
    template(FAKE_TEMPLATES.milestones, "Milestones", ["milestones"]),
    file({
      id: FAKE_FILES.equipmentRegister,
      name: "Equipment register (synthetic)",
      mimeType: SHEETS_MIME_TYPE,
      parents: [FAKE_FILES.sharedDriveRoot],
      driveId: SHARED_DRIVE_ID,
      sheet: {
        timeZone: "Europe/London",
        meta: [],
        tabs: [
          {
            sheetId: 0,
            title: "Equipment",
            columnMeta: [],
            rows: [
              row(
                [
                  "Configuration key",
                  "Laboratory",
                  "Configuration",
                  "EEG channels",
                  "Sampling rates in hertz",
                  "Cap",
                  "Channels per rate",
                  "Notes from the laboratory",
                ].map((text) => cell(text, { fmt: HEADER_FORMAT })),
              ),
              row([
                "demo-cognition-lab:demo-equipment-cognition-1",
                "Demo Cognition Laboratory",
                "Booth A",
                cell(64, { fmt: { numberFormat: "0" } }),
                "250, 500, 1000",
                null,
                cell(21.333333333333332, { f: "=D2/3" }),
                cell("Cap sizes checked in spring.", { note: "Written by the laboratory (synthetic)." }),
              ]),
              row([
                "demo-attention-lab:demo-equipment-attention-1",
                "Demo Attention Laboratory",
                "Main recording room",
                cell(128, { fmt: { numberFormat: "0" } }),
                "500, 1000, 2000",
                "Gel cap",
                cell(42.666666666666664, { f: "=D3/3" }),
                "Booked on Tuesdays.",
              ]),
            ],
          },
        ],
      },
    }),
    file({
      id: FAKE_FILES.laboratoryDirectory,
      name: "Laboratory directory (synthetic)",
      mimeType: SHEETS_MIME_TYPE,
      parents: [FAKE_FILES.sharedDriveRoot],
      driveId: SHARED_DRIVE_ID,
      sheet: {
        timeZone: "Europe/London",
        meta: [],
        tabs: [
          {
            sheetId: 0,
            title: "Laboratories",
            columnMeta: [],
            rows: [
              row(
                ["Laboratory key", "Name", "City", "Website", "Contact notes"].map((text) =>
                  cell(text, { fmt: HEADER_FORMAT }),
                ),
              ),
              row([
                "demo-attention-lab",
                "Demo Attention Laboratory",
                "Northfield",
                null,
                "Front desk on the ground floor.",
              ]),
              row(["demo-memory-lab", "Demo Memory Laboratory", "Northfield", null, null]),
              row(["demo-signal-lab", "Demo Signal Laboratory", "Harbourtown", null, "Call before visiting."]),
              row(["demo-cognition-lab", "Demo Cognition Laboratory", "Ridgeway", null, null]),
            ],
          },
        ],
      },
    }),
    file({
      id: FAKE_FILES.alphaFolder,
      name: "DemoAlpha2001 team folder (synthetic)",
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: [],
      ownerName: FAKE_OWNER,
      editors: [...FAKE_ALPHA_EDITORS],
    }),
    file({
      id: FAKE_FILES.alphaDrafts,
      name: "Stage 1 drafts (synthetic)",
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: [FAKE_FILES.alphaFolder],
      ownerName: FAKE_OWNER,
    }),
    file({
      id: FAKE_FILES.alphaStageOne,
      name: "Stage 1 report draft (synthetic)",
      mimeType: DOCS_MIME_TYPE,
      parents: [FAKE_FILES.alphaDrafts],
      ownerName: FAKE_OWNER,
      doc: {
        body: "Stage 1 report draft\nIntroduction. This synthetic draft exists only in the emulator.\n",
        revision: 4,
        namedRanges: [],
        suggestions: [],
      },
    }),
    file({
      id: FAKE_FILES.alphaTracker,
      name: "Recruitment tracker (synthetic)",
      mimeType: SHEETS_MIME_TYPE,
      parents: [FAKE_FILES.alphaFolder],
      ownerName: FAKE_OWNER,
      sheet: {
        timeZone: "Europe/London",
        meta: [],
        tabs: [
          {
            sheetId: 0,
            title: "Sites",
            columnMeta: [],
            rows: [row(["Site", "Tested"]), row(["Demo Memory Laboratory", 12]), row(["Demo Signal Laboratory", 9])],
          },
        ],
      },
    }),
    file({
      id: FAKE_FILES.alphaEthics,
      name: "Ethics approval (synthetic).pdf",
      mimeType: "application/pdf",
      parents: [FAKE_FILES.alphaFolder],
      ownerName: FAKE_OWNER,
    }),
    file({
      id: FAKE_FILES.cognitionFolder,
      name: "Demo Cognition Laboratory folder (synthetic)",
      mimeType: DRIVE_FOLDER_MIME_TYPE,
      parents: [],
      ownerName: FAKE_OWNER,
    }),
    file({
      id: FAKE_FILES.privateProtocol,
      name: "Protocol not shared with the portal (synthetic)",
      mimeType: DOCS_MIME_TYPE,
      parents: [],
      ownerName: FAKE_OWNER,
      shared: false,
      doc: { body: "Not shared.\n", revision: 1, namedRanges: [], suggestions: [] },
    }),
    file({
      id: FAKE_FILES.workbook,
      name: "Historical workbook (synthetic).xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      parents: [],
      ownerName: FAKE_OWNER,
    }),
  ];
  return {
    schema: 1,
    account: FAKE_ACCOUNT,
    files: Object.fromEntries(files.map((item) => [item.id, item])),
    changes: [],
    channels: {},
    outbox: [],
    faults: [],
    outage: [],
    quotaPerMinute: 60,
    quota: {},
    metadataFollowsSort: false,
    replaceDropsRange: false,
    nextId: 1_000,
  };
}
