// Integration tests of the importer of the recruitment and contact workbook (source F) against
// the Firestore emulator. The workbook and the website data it is matched against are synthetic:
// every person, address (on example.org), date, result, note and number in them is invented.
// Only the study identifiers, the tab titles and the column headers are the real, public ones.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  COLLECTION_ENTRIES,
  historicalAggregateId,
  identityKeyId,
  lookupFold,
  outreachContactId,
  outreachGroupKey,
  outreachNameHash,
  personEmailIndexId,
  personEvidenceKey,
  replicationMembershipId,
  sourceTabKey,
  studyAliasId,
} from "@eegml/shared";
import type { DocumentData } from "firebase-admin/firestore";
import { Timestamp } from "firebase-admin/firestore";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { emulatorEnvironment } from "../../scripts/ports.mjs";
import { createdFields } from "../../tools/src/import/context";
import {
  LITERATURE_POINTER,
  QUOTED_REPLY,
  RECIPIENT_LIST,
  RECRUITMENT_STUDIES,
  type RecruitmentFixture,
  recruitmentDoi,
  recruitmentFixture,
  recruitmentWorkbook,
} from "../../tools/src/import/fixtures/recruitment";
import { websiteFixture, writeWebsiteFixture } from "../../tools/src/import/fixtures/website";
import { itemBuilders } from "../../tools/src/import/reconcile";
import { importer as recruitment } from "../../tools/src/import/sources/recruitment-contacts";
import { importer as website } from "../../tools/src/import/sources/website-data";
import { adminDb } from "../support/admin";
import { PORTAL_ROOT, PORTS, PROJECT_ID } from "../support/emulators";
import {
  allDocuments,
  baselineOf,
  differences,
  documentsOf,
  freshDatabase,
  itemCounts,
  OBSERVED_ON,
  reconciliationItems,
  recordApplied,
  removeTemporaryDirectories,
  run,
  type StoredDocument,
  schemaProblems,
  TEST_HASH_KEY,
  temporaryDirectory,
  verify,
} from "./import-support";

const COUNTS = sourceTabKey("numberOfLabsPerReplication");
const LEADS = sourceTabKey("leadsEmails");
const items = itemBuilders(TEST_HASH_KEY);
/** The claim that marks the one known study of the combined row of the fixture as a part of that row. */
const COMBINED_PART = { source: "combined/part", value: "AmodioJost2007" };

/** Applies the synthetic website data with the studies of the workbook. Each has the invented lead `Ada Example`. */
async function applyWebsite(): Promise<void> {
  const fixture = websiteFixture();
  const [template] = fixture.replications;
  for (const studyId of RECRUITMENT_STUDIES) {
    fixture.replications.push({ ...template, StudyId: studyId, PublicationId: "", Doi: recruitmentDoi(studyId) });
  }
  await run(website, writeWebsiteFixture(temporaryDirectory(), fixture), "apply");
}

async function workbookFile(change: (fixture: RecruitmentFixture) => void = () => {}): Promise<string> {
  const fixture = recruitmentFixture();
  change(fixture);
  const file = path.join(temporaryDirectory(), "recruitment.xlsx");
  writeFileSync(file, await recruitmentWorkbook(fixture));
  return file;
}

/** The outreach tab of a fixture by its title. */
function outreach(fixture: RecruitmentFixture, title: string) {
  const found = fixture.outreach.find((tab) => tab.title === title);
  if (found === undefined) throw new Error(`The fixture has no tab ${title}.`);
  return found;
}

type Row = Record<string, unknown> & {
  readonly id: string;
  readonly rowKey: string;
  readonly raw: Record<string, unknown>;
};

/** The current source records of one tab, by its title. */
async function records(title: string): Promise<Row[]> {
  const snapshot = await adminDb
    .collection("sourceRecords")
    .where("sourceKey", "==", "f")
    .where("tabKey", "==", sourceTabKey(title))
    .get();
  return snapshot.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }) as Row)
    .filter((record) => (record.supersededById ?? null) === null);
}

const record = async (title: string, rowKey: string): Promise<Row> => {
  const found = (await records(title)).find((entry) => entry.rowKey === rowKey);
  if (found === undefined) throw new Error(`No source record ${rowKey} in tab ${title}.`);
  return found;
};

const contactKey = (name: string, ordinal = 1) => `contact__${outreachNameHash(name, TEST_HASH_KEY)}__${ordinal}`;
const contactId = (title: string, name: string, ordinal = 1) =>
  outreachContactId("f", sourceTabKey(title), name, ordinal, TEST_HASH_KEY);

async function contact(title: string, name: string): Promise<DocumentData> {
  const data = (await adminDb.doc(`outreachContacts/${contactId(title, name)}`).get()).data();
  if (data === undefined) throw new Error(`No outreach contact for that row of tab ${title}.`);
  return data;
}

interface Candidate {
  readonly key: string;
  readonly valueSource?: string;
  readonly sourceRecordId?: string;
}
const candidatesOf = (item: DocumentData | undefined): Candidate[] => (item?.candidates ?? []) as Candidate[];

/** The open items of the workbook of one kind, optionally about one field. */
async function itemsOf(kind: string, field?: string) {
  return (await reconciliationItems()).filter(
    (item) => item.sourceKey === "f" && item.kind === kind && (field === undefined || item.field === field),
  );
}

async function aggregates(): Promise<DocumentData[]> {
  return [...(await documentsOf("historicalAggregates")).values()];
}

/** Whether members can read a stored document: its collection is public or for members, and no flag restricts it. */
function membersCanRead(documentPath: string, data: DocumentData): boolean {
  const segments = documentPath.split("/");
  const entry = COLLECTION_ENTRIES.find((candidate) => {
    const template = candidate.path.split("/");
    return (
      template.length === segments.length &&
      template.every((part, index) => part.startsWith("{") || part === segments[index])
    );
  });
  if (entry === undefined) throw new Error(`No registry entry for ${documentPath}.`);
  return ["public", "member"].includes(entry.dataClass) && data.restricted !== true;
}

/** Every text of the fixture that is personal or restricted: names, addresses, dates, results, notes, links, annotations. */
function restrictedValues(fixture: RecruitmentFixture): string[] {
  const values = new Set<string>();
  const add = (input: unknown) => {
    const value =
      typeof input === "object" && input !== null ? (input as { v?: unknown; link?: unknown }) : { v: input };
    for (const text of [value.v, value.link]) {
      if (typeof text === "string" && text.trim().length > 3) values.add(text.trim());
    }
  };
  for (const row of fixture.counts.rows) add(row.leader);
  for (const row of fixture.leads.rows)
    for (const cell of [row.oldLeader, row.leader, row.email, row.additional]) add(cell);
  for (const entry of [...fixture.counts.timeline, fixture.counts.note]) add(entry);
  for (const tab of fixture.outreach) {
    for (const line of tab.preamble) {
      const text = typeof line === "object" && line !== null ? String(line.v) : String(line);
      // The name on a lead line and a line that is nothing but a name are personal. A study line cites a public paper.
      if (text.startsWith("Lead Replicating Lab:")) add(text.slice("Lead Replicating Lab:".length));
      else if (!text.startsWith("Study:") && !text.startsWith("A search of")) add(text);
    }
    for (const row of tab.rows) for (const cell of row ?? []) add(cell);
  }
  // A surname is also searched for by itself, so that a document that holds only a part of a name is found.
  // A short one, or one that is an everyday word of the portal's own vocabulary, would be found where no name is.
  for (const value of [...values]) {
    if (!/^[A-Z][a-z]+ [A-Z][a-z]+\??$/.test(value)) continue;
    const surname = value.replace("?", "").split(" ")[1] ?? "";
    if (surname.length >= 5 && !EVERYDAY_WORDS.includes(surname)) values.add(surname);
  }
  // The invented lead is public through the website data, and these results are words of the model itself.
  for (const allowed of ["Ada Example", "declined", "accepted", "agreed"]) values.delete(allowed);
  return [...values];
}

/** Invented surnames that are everyday words. They are searched for as part of the full name only. */
const EVERYDAY_WORDS = [
  "Added",
  "Contact",
  "Dated",
  "Example",
  "Filled",
  "First",
  "Green",
  "Later",
  "Listed",
  "Orphan",
  "Pasted",
  "Quoted",
  "Reader",
  "Sample",
  "Second",
  "Shared",
  "Staff",
  "Struck",
  "Yellow",
];

const cliEnvironment = (): Record<string, string | undefined> => ({
  ...process.env,
  GCLOUD_PROJECT: undefined,
  GOOGLE_CLOUD_PROJECT: undefined,
  GOOGLE_APPLICATION_CREDENTIALS: undefined,
  ...emulatorEnvironment(PORTS, PROJECT_ID),
});

/** Runs the import command line in a process of its own, as a person would. */
function cli(args: string[]) {
  const result = spawnSync(path.join(PORTAL_ROOT, "node_modules", ".bin", "tsx"), ["src/cli.ts", "import", ...args], {
    cwd: path.join(PORTAL_ROOT, "tools"),
    env: cliEnvironment(),
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

/** Stores the identity key that says that an address belongs to a person, as an earlier source would have. */
async function knowAddress(address: string, ...personIds: string[]): Promise<void> {
  const id = identityKeyId("person", "email", personEvidenceKey.email(address), TEST_HASH_KEY);
  await adminDb.doc(`identityKeys/${id}`).set({
    ...createdFields(Timestamp.now()),
    schemaVersion: 1,
    entityType: "person",
    keyKind: "email",
    status: "active",
    mergedIntoId: null,
    entityIds: personIds,
  });
}

/** The person that the website data created under a website identifier. */
async function websitePerson(websiteId: string): Promise<string> {
  const snapshot = await adminDb.collection("persons").where("websitePersonId", "==", websiteId).get();
  const [doc] = snapshot.docs;
  if (doc === undefined) throw new Error(`The website fixture has no person ${websiteId}.`);
  return doc.id;
}

beforeEach(async () => {
  await freshDatabase();
  await applyWebsite();
});
afterAll(removeTemporaryDirectories);

describe("reading the recruitment and contact workbook", () => {
  it("reads every tab, hidden ones included, and accounts for every row of every tab", async () => {
    const report = await run(recruitment, await workbookFile(), "apply");
    expect(report.status).toBe("applied");
    expect(report.tabs).toHaveLength(23);
    const tab = (title: string) => report.tabs.find((entry) => entry.tabKey === sourceTabKey(title));
    expect(tab("numberOfLabsPerReplication")).toMatchObject({
      rows: { header: 1, banner: 0, data: 12, annotation: 0, derived: 3, placeholder: 0, filler: 0, blank: 4 },
      // The record of the tab, and seven cells of the timeline and its note beside the table.
      cellAnnotations: 8,
      // Nine rows with numbers of one study. The combined row, the row of an unknown study and a struck row wait.
      imported: 9,
      queued: 3,
      rawOnly: {},
    });
    expect(tab("leadsEmails")).toMatchObject({
      rows: expect.objectContaining({ header: 1, data: 12, blank: 0 }),
      imported: 0,
      queued: 6,
      // A lead claim that agrees with everything and whose person is not known stays in its source record.
      rawOnly: { leadClaim: 6 },
    });
    // A tab with blank rows inside its data, a pasted list and a pointer to a paper.
    expect(tab("Miltner1999")).toMatchObject({
      rows: expect.objectContaining({ header: 1, banner: 2, data: 3, annotation: 2, blank: 2 }),
      imported: 3,
    });
    expect(tab("DelCul2007")).toMatchObject({
      rows: expect.objectContaining({ banner: 3, data: 3, annotation: 1, blank: 2 }),
      imported: 3,
    });
    expect(tab("HajcakMoser2005")).toMatchObject({ rows: expect.objectContaining({ data: 6, annotation: 1 }) });
    expect(tab("Carretie2004")).toMatchObject({ rows: expect.objectContaining({ banner: 3, data: 0 }), imported: 0 });
    for (const entry of report.tabs) {
      const raw = Object.values(entry.rawOnly).reduce((sum, count) => sum + count, 0);
      expect(entry.unaccounted, entry.tabKey).toBe(0);
      expect(entry.imported + entry.queued + raw, entry.tabKey).toBe(entry.rows.data);
    }
    // 12 study rows in each summary tab and 47 contact rows in the 21 outreach tabs.
    expect(report.tabs.reduce((sum, entry) => sum + entry.rows.data, 0)).toBe(12 + 12 + 47);
    expect(report.collections.outreachContacts).toMatchObject({ created: 47 });
    expect(await schemaProblems()).toEqual([]);
  });

  it("records each tab with its visibility and the row of its header, on row 3 or on row 4", async () => {
    await run(recruitment, await workbookFile(), "preview");
    const tabs = [...(await documentsOf("tabs", true)).values()].filter((tab) => tab.sourceKey === "f");
    expect(tabs).toHaveLength(23);
    expect(tabs.filter((tab) => tab.visibility === "hidden")).toHaveLength(17);
    const byName = new Map(tabs.map((tab) => [tab.name as string, tab]));
    expect(byName.get("Vidal2000")).toMatchObject({ headerRow: 3, visibility: "hidden", rowCount: 3 });
    expect(byName.get("Vidal2000_")).toMatchObject({ headerRow: 4, visibility: "visible", rowCount: 1 });
    expect(byName.get("Boksem2006_labs")).toMatchObject({ headerRow: 3, rowCount: 5 });
    expect(byName.get("Müller2003 replicating labs sea")).toMatchObject({ headerRow: 4 });
    expect(byName.get("leadsEmails")).toMatchObject({ headerRow: 1, importerKey: "recruitmentContacts" });
    // The record of a tab keeps its title, its kind and its colour, which decides nothing.
    expect((await record("Vidal2000", "tab")).raw).toEqual({
      tab: { v: "Vidal2000", t: "tab", kind: "outreach", visibility: "hidden", tabColour: "DD0000" },
    });
    expect((await record("leadsEmails", "tab")).raw).toEqual({
      tab: { v: "leadsEmails", t: "tab", kind: "leads", visibility: "visible" },
    });
    // A preview stores what the workbook says and writes no entity.
    expect((await documentsOf("outreachContacts")).size).toBe(0);
    expect(await aggregates()).toHaveLength(0);
  });

  it("stores the cells of the summary tabs verbatim, with strike-through, and keys a row by its folded identifier", async () => {
    await run(recruitment, await workbookFile(), "preview");
    expect((await record("numberOfLabsPerReplication", "carretie2004")).raw).toEqual({
      A: { v: "Carretie2004", t: "string", strike: true },
      B: { v: "Cy Invented", t: "string", strike: true },
      C: null,
      D: null,
      E: null,
      F: null,
      G: null,
    });
    // An explicit zero is a cell with the number zero. A blank beside a count is no cell at all.
    expect((await record("numberOfLabsPerReplication", "inzlicht2009")).raw).toMatchObject({
      B: { v: "Ada Example ", t: "string" },
      F: { v: 101, t: "number" },
      G: { v: 0, t: "number" },
    });
    expect((await record("numberOfLabsPerReplication", "hajcak2003")).raw).toMatchObject({ F: { v: 372 }, G: null });
    const combined = await record("leadsEmails", "amodiojost2007amodiomaster2007");
    expect(combined.raw).toMatchObject({
      A: { v: "AmodioJost2007 + AmodioMaster2007" },
      B: { v: "Hal Pretend", strike: true },
      C: { v: "Gus Mock", t: "string" },
    });
    // The second address stands under no header and stays in the record of its row.
    expect((await record("leadsEmails", "hajcak2003")).raw).toMatchObject({
      C: { v: "Ada Example, Fay Sample" },
      E: { v: "fay.sample@example.org", t: "string" },
    });
    // A total keeps its formula and its cached value, and is no data row.
    const derived = (await records("numberOfLabsPerReplication")).filter((row) => row.rowKey.startsWith("below__"));
    expect(derived).toHaveLength(3);
    expect(
      derived
        .map((row) => (row.raw.C as { f?: string } | null)?.f)
        .filter(Boolean)
        .sort(),
    ).toEqual(["MEDIAN(C2:C13)", "SUM(C2:C13)"]);
    // The timeline beside the table: each cell is a record of its own, keyed by a hash.
    const side = (await records("numberOfLabsPerReplication")).filter((row) => row.rowKey.startsWith("side__"));
    expect(side).toHaveLength(7);
    expect(side.map((row) => Object.keys(row.raw).join()).sort()).toEqual(["I", "I", "I", "I", "I", "J", "J"]);
  });

  it("stores an outreach row under a key without its name, with fills, links, dates and merged ranges as the file holds them", async () => {
    await run(recruitment, await workbookFile(), "preview");
    const bea = await record("Vidal2000", contactKey("Bea Contact"));
    expect(bea.rowKey).not.toMatch(/bea|contact__.*contact/i);
    expect(bea.rowNumber).toBe(4);
    expect(bea.raw).toEqual({
      A: { v: "Bea Contact", t: "string" },
      B: { v: "bea.contact@example.org", t: "string" },
      C: { v: "05.03.21", t: "string" },
      D: { v: "19.04.21", t: "string" },
      E: { v: "no reply", t: "string", fill: "FF0000", fillSource: "rgb:FFFF0000" },
      F: null,
    });
    // A theme colour is resolved through the theme, and a true date stays the number under its date format.
    const eda = await record("HajcakMoser2005", contactKey("Eda Twice"));
    expect(eda.raw).toMatchObject({
      C: { v: 44278, t: "number", z: "d/m/yy" },
      D: { v: 44333, t: "number", z: "d/m" },
      E: { v: "no reply", fill: "C0504D", fillSource: "theme:5" },
    });
    // A fill on an empty cell is kept, and the row still holds one name and one result.
    expect((await record("HajcakMoser2005", contactKey("Ida Filled"))).raw).toMatchObject({
      B: { v: null, t: "empty", fill: "FF0000" },
    });
    const eve = await record("DonkersvanBoxtel2004 lead", contactKey("Eve Unreal"));
    expect(eve.raw).toMatchObject({
      F: { l: "https://papers.example.org/doi/full/10.1000/invented?casa_token=AN-INVENTED-TOKEN" },
      G: {
        v: "https://articles.example.org/an-invented-article#",
        l: "https://articles.example.org/an-invented-article",
      },
    });
    // The merged ranges are stored on the cells they cover, in the upper row and in the lower one.
    expect((await record("Miltner1999", contactKey("Lou Forwarder"))).raw).toMatchObject({
      C: { v: "27.09.21", merge: "C4:C5" },
      E: { v: "accepted", merge: "E4:E5" },
    });
    const list = (await records("Miltner1999")).find((row) => row.rowKey.startsWith("list__"));
    expect(list?.raw).toMatchObject({
      A: { v: RECIPIENT_LIST, l: "mailto:vic.sham@example.org", merge: "A5:B5" },
      C: { v: null, merge: "C4:C5" },
    });
    // The lines above the header are keyed by their kind.
    expect((await records("Vidal2000_")).map((row) => row.rowKey).sort()).toEqual([
      contactKey("Yan Stub"),
      "header",
      "preamble__labSearch",
      "preamble__lead",
      "preamble__study",
      "tab",
    ]);
    expect((await records("Miltner1999")).map((row) => row.rowKey)).toContain("preamble__other");
  });

  it("keys the rows with the secret that the run was given: another secret gives other keys for the same file", async () => {
    const file = await workbookFile();
    const input = { path: file, observedOn: OBSERVED_ON };
    const keysOf = async (secret: string) =>
      (await recruitment.read(input, { secret })).tabs
        .find((tab) => tab.name === "Vidal2000")
        ?.rows.map((row) => row.rowKey);
    const first = await keysOf(TEST_HASH_KEY);
    expect(first).toContain(contactKey("Bea Contact"));
    expect(first).toEqual(await keysOf(TEST_HASH_KEY));
    const other = await keysOf(`${TEST_HASH_KEY}-of-another-environment`);
    expect(other).not.toContain(contactKey("Bea Contact"));
    expect(other?.filter((key) => key.startsWith("contact__"))).toHaveLength(3);
  });
});

describe("the summary figures", () => {
  it("stores each number as a historical aggregate of its replication, with no date and each metric by itself", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const stored = await aggregates();
    expect(stored).toHaveLength(26);
    const row = await record("numberOfLabsPerReplication", "inzlicht2009");
    const byId = await documentsOf("historicalAggregates");
    expect(byId.get(historicalAggregateId("nLabsSigned", row.id))).toMatchObject({
      replicationIds: ["Inzlicht2009"],
      metricKey: "nLabsSigned",
      valueSource: "2",
      valueNumeric: 2,
      sourceRecordId: row.id,
      sourceRecordIds: [row.id],
      isCurrent: true,
      dataOrigin: "importedHistorical",
    });
    // The numbers carry no date, so no aggregate has a snapshot date. The day of the export is on the batch.
    expect(stored.filter((aggregate) => "snapshotDate" in aggregate)).toEqual([]);
    expect(new Set(stored.map((aggregate) => aggregate.metricKey))).toEqual(
      new Set(["nLabsSigned", "totalNToBeRun", "nLabsFinished", "totalNMainCollected", "totalNRest"]),
    );
    // The main experiment and the resting state are two figures. Nothing adds them.
    const inzlicht = stored.filter((aggregate) => (aggregate.replicationIds as string[]).includes("Inzlicht2009"));
    expect(inzlicht.map((aggregate) => [aggregate.metricKey, aggregate.valueNumeric]).sort()).toEqual([
      ["nLabsFinished", 2],
      ["nLabsSigned", 2],
      ["totalNMainCollected", 101],
      ["totalNRest", 0],
      ["totalNToBeRun", 96],
    ]);
    // One study has both figures above zero: 251 in the main experiment and 97 at rest. No document holds their sum.
    const vidal = stored.filter((aggregate) => (aggregate.replicationIds as string[]).includes("Vidal2000"));
    expect(vidal.map((aggregate) => [aggregate.metricKey, aggregate.valueNumeric])).toEqual(
      expect.arrayContaining([
        ["totalNMainCollected", 251],
        ["totalNRest", 97],
      ]),
    );
    expect(stored.map((aggregate) => aggregate.valueNumeric)).not.toContain(251 + 97);
    expect(stored.every((aggregate) => (aggregate.replicationIds as string[]).length === 1)).toBe(true);
  });

  it("keeps a blank apart from zero: 29 blank cells give nothing, and the one explicit zero is stored as zero", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const stored = await aggregates();
    const cells = recruitmentFixture().counts.rows.flatMap((row) => row.numbers);
    expect(cells.filter((value) => value === null)).toHaveLength(29);
    expect(cells.filter((value) => value === 0)).toHaveLength(1);
    const zeros = stored.filter((aggregate) => aggregate.valueNumeric === 0);
    expect(zeros).toHaveLength(1);
    expect(zeros[0]).toMatchObject({ replicationIds: ["Inzlicht2009"], metricKey: "totalNRest", valueSource: "0" });
    // The study with a count of the main experiment and a blank beside it has no resting-state figure at all.
    const hajcak = stored.filter((aggregate) => (aggregate.replicationIds as string[]).includes("Hajcak2003"));
    expect(hajcak.map((aggregate) => aggregate.metricKey).sort()).toEqual([
      "nLabsFinished",
      "nLabsSigned",
      "totalNMainCollected",
      "totalNToBeRun",
    ]);
    const [blank] = await itemsOf("unparsedValue", "totalNRest");
    expect(blank?.id).toBe(
      items.unparsedValue({
        subject: "Hajcak2003",
        field: "totalNRest",
        claims: [{ source: `f/${COUNTS}/totalNRest/blank`, value: "blank" }],
      }).fingerprint,
    );
    // 26 numbers of single studies are written. The five of the combined row are not.
    expect(stored.length + 5).toBe(cells.filter((value) => value !== null).length);
  });

  it("writes the numbers of a row that names two studies beneath neither, and queues the row and the unknown identifier", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const stored = await aggregates();
    expect(stored.filter((aggregate) => (aggregate.replicationIds as string[]).includes("AmodioJost2007"))).toEqual([]);
    expect(stored.map((aggregate) => aggregate.valueNumeric)).not.toContain(505);
    const row = await record("numberOfLabsPerReplication", "amodiojost2007amodiomaster2007");
    const expected = items.unmatchedIdentifier({
      subject: `f/${COUNTS}/amodiojost2007amodiomaster2007`,
      claims: [
        { source: `f/${COUNTS}/StudyID`, value: "AmodioJost2007 + AmodioMaster2007" },
        { source: `f/${COUNTS}/nLabsSigned`, value: "9" },
        { source: `f/${COUNTS}/totalNToBeRun`, value: "410" },
        { source: `f/${COUNTS}/nLabsFinished`, value: "12" },
        { source: `f/${COUNTS}/totalNMainCollected`, value: "505" },
        { source: `f/${COUNTS}/totalNRest`, value: "505" },
        COMBINED_PART,
      ],
    });
    const item = (await itemsOf("unmatchedIdentifier")).find((entry) => entry.id === expected.fingerprint);
    // The numbers stay with the row in the queue. The study that the cell does name is marked as a part of it.
    expect(item).toMatchObject({
      status: "open",
      entityRefs: [{ entityType: "replication", entityId: "AmodioJost2007" }],
    });
    expect(candidatesOf(item).map((candidate) => candidate.valueSource)).toEqual([
      "AmodioJost2007 + AmodioMaster2007",
      "9",
      "410",
      "12",
      "505",
      "505",
      "AmodioJost2007",
    ]);
    expect(candidatesOf(item).at(-1)?.key).toMatch(/^combined\/part:/);
    expect(
      candidatesOf(item)
        .slice(0, -1)
        .every((candidate) => candidate.sourceRecordId === row.id),
    ).toBe(true);
    // The identifier that occurs in no other source is one item, with the cell of each summary tab.
    const unknown = items.unmatchedIdentifier({
      subject: "f/identifier/amodiomaster2007",
      claims: [
        { source: `f/${COUNTS}/StudyID`, value: "AmodioMaster2007" },
        { source: `f/${LEADS}/StudyID`, value: "AmodioMaster2007" },
      ],
    });
    expect((await itemsOf("unmatchedIdentifier")).map((entry) => entry.id)).toContain(unknown.fingerprint);
    // No replication is created for it, and none for the study that the website data does not hold.
    expect((await adminDb.doc("replications/AmodioMaster2007").get()).exists).toBe(false);
    expect((await adminDb.doc("replications/Frank2005").get()).exists).toBe(false);
  });

  it("resolves an identifier that is spelt with a diacritic, stores the spelling as an alias and asks once about it", async () => {
    const file = await workbookFile((fixture) => {
      for (const rows of [fixture.counts.rows, fixture.leads.rows]) {
        const muller = rows.find((row) => row.study === "Muller2003");
        if (muller) muller.study = "Müller2003";
      }
    });
    await run(recruitment, file, "apply");
    // The row is keyed by its folded identifier, and its numbers are written beneath the study it resolves to.
    const row = await record("numberOfLabsPerReplication", "muller2003");
    const figures = (await aggregates()).filter((aggregate) => aggregate.sourceRecordId === row.id);
    expect(figures.map((aggregate) => aggregate.replicationIds)).toEqual([["Muller2003"], ["Muller2003"]]);
    const alias = await adminDb.doc(`replications/Muller2003/aliases/${studyAliasId("programme", "Müller2003")}`).get();
    expect(alias.data()).toMatchObject({ alias: "Müller2003", scheme: "programme", isCanonical: false });
    // Nothing is renamed, and the spelling of both tabs is one question.
    expect((await adminDb.doc("replications/Müller2003").get()).exists).toBe(false);
    expect((await itemsOf("aliasConfirmation")).map((item) => item.id)).toContain(
      items.aliasConfirmation({
        subject: "f/identifier/muller2003",
        claims: [
          { source: `f/${COUNTS}/StudyID`, value: "Müller2003" },
          { source: `f/${LEADS}/StudyID`, value: "Müller2003" },
        ],
      }).fingerprint,
    );
    expect(await itemsOf("aliasConfirmation")).toHaveLength(2);
    expect((await verify(recruitment, file)).filter((check) => !check.passed)).toEqual([]);
  });

  it("keeps a summary tab without its headers raw, and still imports the other tabs", async () => {
    const file = await workbookFile((fixture) => {
      fixture.counts.headers[2] = "LabsSigned";
    });
    const report = await run(recruitment, file, "apply");
    expect(report.status).toBe("applied");
    const tab = report.tabs.find((entry) => entry.tabKey === COUNTS);
    // No row is read as a study row, so no number is read under a header that is not there.
    expect(tab?.rows.data).toBe(0);
    expect(await aggregates()).toHaveLength(0);
    expect(report.collections.outreachContacts).toMatchObject({ created: 47 });
    expect((await itemsOf("structureChange")).map((item) => item.id)).toEqual([
      items.structureChange({
        subject: `f/${COUNTS}/layout`,
        claims: [
          { source: "expected", value: "counts" },
          { source: "found", value: "unknown" },
        ],
      }).fingerprint,
    ]);
    // The lead claims of the other summary tab are still compared with the leads held already.
    expect((await itemsOf("conflictingLead")).filter((item) => item.field === "formerLead")).toHaveLength(3);
    expect((await verify(recruitment, file)).filter((check) => !check.passed)).toEqual([]);
  });

  it("reviews numbers that contradict one another, and reads no text, fraction or negative number as a count", async () => {
    await run(recruitment, await workbookFile(), "apply");
    // More labs finished than signed, in the combined row and in one study.
    expect((await itemsOf("valueConflict", "nLabsFinished")).map((item) => item.id).sort()).toEqual(
      [
        items.valueConflict({
          subject: "Hajcak2003",
          field: "nLabsFinished",
          claims: [
            { source: `f/${COUNTS}/nLabsSigned`, value: "11" },
            { source: `f/${COUNTS}/nLabsFinished`, value: "13" },
          ],
        }).fingerprint,
        items.valueConflict({
          subject: "f/study/amodiojost2007amodiomaster2007",
          field: "nLabsFinished",
          claims: [
            { source: `f/${COUNTS}/nLabsSigned`, value: "9" },
            { source: `f/${COUNTS}/nLabsFinished`, value: "12" },
            COMBINED_PART,
          ],
        }).fingerprint,
      ].sort(),
    );

    await freshDatabase();
    await applyWebsite();
    await run(
      recruitment,
      await workbookFile((fixture) => {
        const numbers = (study: string) => fixture.counts.rows.find((row) => row.study === study)?.numbers ?? [];
        numbers("Luck1996")[1] = "about 250";
        numbers("Muller2003")[1] = 75.5;
        numbers("Onton2005")[0] = -3;
        numbers("Miltner1999")[4] = 99;
      }),
      "apply",
    );
    const unparsed = await itemsOf("unparsedValue");
    expect(unparsed.filter((item) => item.field === "totalNToBeRun")).toHaveLength(2);
    expect(unparsed.filter((item) => item.field === "nLabsSigned")).toHaveLength(1);
    const stored = await aggregates();
    const of = (study: string) =>
      stored.filter((aggregate) => (aggregate.replicationIds as string[]).includes(study)).map((a) => a.metricKey);
    // The cell that cannot be read gives no figure. The other number of its row is still written.
    expect(of("Luck1996")).toEqual(["nLabsSigned"]);
    expect(of("Muller2003")).toEqual(["nLabsSigned"]);
    expect(of("Onton2005")).toEqual(["totalNToBeRun"]);
    expect(stored.map((aggregate) => aggregate.valueNumeric)).not.toContain(75.5);
    // A resting-state count without a count of the main experiment is written as it stands.
    expect(of("Miltner1999").sort()).toEqual(["nLabsSigned", "totalNRest", "totalNToBeRun"]);
  });

  it("never imports a total as data, recomputes it, and reports one that is stale or put together by hand", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const derived = (await records("numberOfLabsPerReplication")).filter((row) => row.rowKey.startsWith("below__"));
    const ids = new Set(derived.map((row) => row.id));
    expect((await aggregates()).filter((aggregate) => ids.has(aggregate.sourceRecordId as string))).toEqual([]);
    // The totals and the medians agree with their cached values. The projection adds single cells of two columns.
    const reported = await itemsOf("annotationReview", "D");
    expect(reported).toHaveLength(1);
    expect(candidatesOf(reported[0]).map((candidate) => candidate.valueSource)).toEqual(["SUM(D3,F2,D2)"]);
    expect(candidatesOf(reported[0])[0]?.key).toContain("/derived/handBuilt/formula:");

    await run(
      recruitment,
      await workbookFile((fixture) => {
        fixture.counts.staleTotal = 999;
      }),
      "apply",
    );
    const [stale] = await itemsOf("annotationReview", "C");
    expect(candidatesOf(stale).map((candidate) => candidate.valueSource)).toEqual(["999", "59"]);
    expect(await aggregates()).toHaveLength(26);
  });

  it("asks what became of a struck-through study and changes no status, also where a lead is still listed", async () => {
    const before = (await adminDb.doc("replications/Carretie2004").get()).data();
    await run(recruitment, await workbookFile(), "apply");
    const questions = await itemsOf("statusQuestion");
    expect(questions.map((item) => item.id).sort()).toEqual(
      ["Carretie2004", "f/study/frank2005"]
        .map(
          (subject) =>
            items.statusQuestion({
              subject,
              field: "status",
              claims: [
                { source: `f/${COUNTS}/strike/study`, value: "struck" },
                { source: `f/${COUNTS}/strike/leader`, value: "struck" },
                { source: `f/${LEADS}/leader/listed`, value: "listed" },
              ],
            }).fingerprint,
        )
        .sort(),
    );
    const after = (await adminDb.doc("replications/Carretie2004").get()).data();
    expect(after?.statusKey).toEqual(before?.statusKey);
    expect(after?.updatedAt).toEqual(before?.updatedAt);
    // The struck rows are the rows without sign-up numbers, so no row is a signal of its own.
    expect(await itemsOf("formattingSignal", "strike")).toEqual([]);

    await run(
      recruitment,
      await workbookFile((fixture) => {
        // A struck row that still has numbers, and a row without numbers that is not struck.
        const boksem = fixture.counts.rows.find((row) => row.study === "Boksem2006");
        if (boksem) boksem.study = { v: "Boksem2006", strike: true };
        const vidal = fixture.counts.rows.find((row) => row.study === "Vidal2000");
        if (vidal) vidal.numbers = [null, null, null, null, null];
      }),
      "apply",
    );
    expect((await itemsOf("formattingSignal", "strike")).map((item) => item.entityRefs)).toEqual(
      expect.arrayContaining([
        [{ entityType: "replication", entityId: "Boksem2006" }],
        [{ entityType: "replication", entityId: "Vidal2000" }],
      ]),
    );
  });

  it("adds new figures when a row changes, and keeps the earlier ones as no longer current", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const earlier = await record("numberOfLabsPerReplication", "onton2005");
    const file = await workbookFile((fixture) => {
      const onton = fixture.counts.rows.find((row) => row.study === "Onton2005");
      if (onton) onton.numbers = [4, 90, 2, 61, null];
    });
    const report = await run(recruitment, file, "apply");
    // Two rows have a new revision: the row of the study, and the totals beneath the table.
    expect(report.sourceRecords).toMatchObject({ created: 2, superseded: 2 });
    // Four new figures, and the two earlier ones marked. Nothing is deleted and nothing counts as gone.
    expect(report.collections.historicalAggregates).toMatchObject({ created: 4, changed: 2 });
    expect(report.collections.historicalAggregates?.fields).toEqual({ isCurrent: 2 });
    const current = await record("numberOfLabsPerReplication", "onton2005");
    const byId = await documentsOf("historicalAggregates");
    expect(byId.get(historicalAggregateId("nLabsSigned", earlier.id))).toMatchObject({
      valueNumeric: 2,
      isCurrent: false,
    });
    expect(byId.get(historicalAggregateId("nLabsSigned", current.id))).toMatchObject({
      valueNumeric: 4,
      isCurrent: true,
    });
    expect(byId.get(historicalAggregateId("totalNMainCollected", current.id))).toMatchObject({ valueNumeric: 61 });
    expect(await itemsOf("missingFromSource")).toEqual([]);
    const again = await run(recruitment, file, "apply");
    expect(again.documentsWritten).toBe(0);
    expect((await itemsOf("missingFromSource")).length).toBe(0);
    expect((await verify(recruitment, file)).filter((check) => !check.passed)).toEqual([]);
  });

  it("keeps the timeline beside the table as restricted annotations, and parses nothing in it", async () => {
    const before = await allDocuments();
    await run(recruitment, await workbookFile(), "apply");
    const review = await itemsOf("privacyReview");
    const side = review.filter((item) => candidatesOf(item).some((candidate) => candidate.key.includes("/side:")));
    // One item for each column without a header. It names the first cell and shows no content.
    expect(side.map((item) => item.id).sort()).toEqual(
      ["I", "J"]
        .map(
          (column) =>
            items.privacyReview({
              subject: `f/${COUNTS}/side/${column}`,
              claims: [{ source: `f/${COUNTS}/side`, value: column }],
            }).fingerprint,
        )
        .sort(),
    );
    expect(side.flatMap((item) => candidatesOf(item).map((candidate) => candidate.valueSource))).toEqual([
      undefined,
      undefined,
    ]);
    const { created } = differences(before, await allDocuments());
    const after = await allDocuments();
    const holders = created.filter((documentPath) =>
      JSON.stringify(after.get(documentPath)?.data).includes("joined an invented committee"),
    );
    expect(holders).toHaveLength(1);
    expect(holders[0]).toMatch(/^sourceRecords\//);
  });
});

describe("the lead claims", () => {
  it("queues former leads and conflicting leads, and writes no membership, no person and no address for them", async () => {
    const before = await allDocuments();
    await run(recruitment, await workbookFile(), "apply");
    const after = await allDocuments();
    const { created, rewritten } = differences(before, after);
    for (const collection of ["persons/", "identityKeys/", "personEmailIndex/", "laboratories/", "participations/"]) {
      expect(created.filter((documentPath) => documentPath.startsWith(collection))).toEqual([]);
    }
    expect(created.filter((documentPath) => documentPath.includes("/memberships/"))).toEqual([]);
    // The leads that the website confirmed for the four studies in question are lowered, and nothing else of them
    // changes. The study that the combined row names beside another keeps its lead: what that row says is given to neither.
    const lowered = rewritten.filter((documentPath) => documentPath.includes("/memberships/"));
    expect(lowered.map((documentPath) => documentPath.split("/")[1])).toEqual([
      "Boksem2006",
      "Carretie2004",
      "DelCul2007",
      "Hajcak2003",
    ]);
    for (const documentPath of lowered) {
      const was = before.get(documentPath)?.data ?? {};
      const is = after.get(documentPath)?.data ?? {};
      expect([was.reviewStatus, is.reviewStatus]).toEqual(["confirmed", "needsReview"]);
      expect([is.personId, is.role, is.isCurrent, is.sourceRecordIds]).toEqual([
        was.personId,
        was.role,
        was.isCurrent,
        was.sourceRecordIds,
      ]);
    }

    const leads = await itemsOf("conflictingLead");
    expect(leads).toHaveLength(9);
    const fold = lookupFold;
    const expected = [
      // An old leader is recorded, in strike-through, beside another person as the leader.
      items.conflictingLead({
        subject: "DelCul2007",
        field: "formerLead",
        claims: [
          { source: `f/${LEADS}/oldLeader`, value: fold("Jo Specimen") },
          { source: `f/${LEADS}/leader`, value: fold("Ada Example") },
        ],
      }),
      items.conflictingLead({
        subject: "f/study/amodiojost2007amodiomaster2007",
        field: "formerLead",
        claims: [
          { source: `f/${LEADS}/oldLeader`, value: fold("Hal Pretend") },
          { source: `f/${LEADS}/leader`, value: fold("Gus Mock") },
          COMBINED_PART,
        ],
      }),
      // The two summary tabs name different people, and one of them is not the lead that the website names.
      items.conflictingLead({
        subject: "Boksem2006",
        field: "lead",
        claims: [
          { source: `f/${COUNTS}/leader`, value: fold("Ada Example") },
          { source: `f/${LEADS}/leader`, value: fold("Eli Madeup") },
          { source: "held/lead", value: fold("Ada Example") },
        ],
      }),
      // One tab names nobody and the other somebody.
      items.conflictingLead({
        subject: "f/study/amodiojost2007amodiomaster2007",
        field: "lead",
        claims: [
          { source: `f/${COUNTS}/leader`, value: "" },
          { source: `f/${LEADS}/leader`, value: fold("Gus Mock") },
          COMBINED_PART,
        ],
      }),
      // One name against two.
      items.conflictingLead({
        subject: "Hajcak2003",
        field: "lead",
        claims: [
          { source: `f/${COUNTS}/leader`, value: fold("Ada Example") },
          { source: `f/${LEADS}/leader`, value: fold("Ada Example") },
          { source: `f/${LEADS}/leader`, value: fold("Fay Sample") },
          { source: "held/lead", value: fold("Ada Example") },
        ],
      }),
      // The lead line of a tab names the old leader.
      items.conflictingLead({
        subject: "DelCul2007",
        field: "leadLine",
        claims: [
          { source: `f/${sourceTabKey("DelCul2007")}/leadLine`, value: fold("Jo Specimen") },
          { source: `f/${LEADS}/leader`, value: fold("Ada Example") },
          { source: `f/${LEADS}/oldLeader`, value: fold("Jo Specimen") },
        ],
      }),
      // The lead line of the tab without a study names somebody who leads no study now.
      items.conflictingLead({
        subject: `f/${sourceTabKey("AmodioMaster20072008")}`,
        field: "leadLine",
        claims: [
          { source: `f/${sourceTabKey("AmodioMaster20072008")}/leadLine`, value: fold("Hal Pretend") },
          { source: `f/${LEADS}/oldLeader`, value: fold("Hal Pretend") },
        ],
      }),
    ];
    const raised = leads.map((item) => item.id);
    for (const item of expected) expect(raised, `${item.subject}`).toContain(item.fingerprint);
    // A trailing space in a name is no difference, so the six studies whose tabs agree raise nothing.
    expect(leads.filter((item) => item.field === "lead")).toHaveLength(4);
    expect(leads.filter((item) => item.field === "formerLead")).toHaveLength(3);
    const boksem = leads.find((item) => item.id === expected[2]?.fingerprint);
    expect(boksem?.entityRefs).toEqual([
      { entityType: "replication", entityId: "Boksem2006" },
      { entityType: "person", entityId: await websitePerson("aexample") },
    ]);
    // The membership that the website data wrote stays, and its confirmation is lowered while the question is open.
    const membership = await adminDb
      .doc(`replications/Boksem2006/memberships/${replicationMembershipId(await websitePerson("aexample"), "lead")}`)
      .get();
    expect(membership.data()).toMatchObject({ reviewStatus: "needsReview", isCurrent: true });
    const reason = await adminDb.doc(`sourceRecords/${membership.get("fieldSources").reviewStatus}`).get();
    expect(reason.get("sourceKey")).toBe("f");
    // A study about whose lead the workbook raises nothing keeps its confirmed lead, and so does the study that the
    // combined row names: a question that rests on a cell which names several studies writes to none of them.
    for (const studyId of ["Luck1996", "AmodioJost2007"]) {
      const untouched = await adminDb
        .doc(`replications/${studyId}/memberships/${replicationMembershipId(await websitePerson("aexample"), "lead")}`)
        .get();
      expect(untouched.data(), studyId).toMatchObject({ reviewStatus: "confirmed", isCurrent: true });
      expect(untouched.get("fieldSources").reviewStatus, studyId).not.toBe(reason.id);
    }
    const combined = leads.filter((item) => JSON.stringify(item.candidates).includes("combined/part:"));
    expect(combined.map((item) => item.field).sort()).toEqual(["formerLead", "lead"]);
    for (const item of combined) {
      expect(item.entityRefs).toEqual([{ entityType: "replication", entityId: "AmodioJost2007" }]);
    }
  });

  it("names the study proposed for an unresolved identifier in the question about the identifier, and writes to neither study of the combined row", async () => {
    await freshDatabase();
    const fixture = websiteFixture();
    const [template] = fixture.replications;
    for (const studyId of [...RECRUITMENT_STUDIES, "AmodioMaster2008"]) {
      fixture.replications.push({ ...template, StudyId: studyId, PublicationId: "", Doi: recruitmentDoi(studyId) });
    }
    await run(website, writeWebsiteFixture(temporaryDirectory(), fixture), "apply");
    const file = await workbookFile();
    const before = await documentsOf("memberships", true);
    await run(recruitment, file, "apply");
    const after = await documentsOf("memberships", true);
    expect(after.size).toBe(before.size);

    // The identifier differs from one study by its year alone. The question names that study as a proposal.
    const unknown = (await itemsOf("unmatchedIdentifier")).find((item) =>
      candidatesOf(item).some(
        (candidate) => candidate.key.startsWith(`f/${COUNTS}/StudyID:`) && candidate.valueSource === "AmodioMaster2007",
      ),
    );
    expect(unknown?.entityRefs).toEqual([{ entityType: "replication", entityId: "AmodioMaster2008" }]);
    expect(candidatesOf(unknown).filter((candidate) => candidate.key.startsWith("proposal/otherYear:"))).toEqual([
      expect.objectContaining({ valueSource: "AmodioMaster2008" }),
    ]);
    const tab = (await itemsOf("unmatchedIdentifier")).find((item) =>
      candidatesOf(item).some((candidate) => candidate.valueSource === "AmodioMaster20072008"),
    );
    expect(tab?.entityRefs).toEqual([{ entityType: "replication", entityId: "AmodioMaster2008" }]);

    // The lead of the combined row is compared with the leads of neither study, and no question is raised for one
    // of them alone. Every item about the row names both studies, each marked as what it is.
    expect(await itemsOf("conflictingLead", "leadByProposal")).toEqual([]);
    const ofRow = (await reconciliationItems()).filter((item) =>
      candidatesOf(item).some((candidate) => candidate.key.startsWith("combined/part:")),
    );
    expect(ofRow.length).toBeGreaterThanOrEqual(5);
    for (const item of ofRow) {
      expect(item.entityRefs, `${item.kind} ${item.field}`).toEqual([
        { entityType: "replication", entityId: "AmodioJost2007" },
        { entityType: "replication", entityId: "AmodioMaster2008" },
      ]);
      const marks = candidatesOf(item)
        .filter((candidate) => /^(combined\/part|proposal\/otherYear):/.test(candidate.key))
        .map((candidate) => `${candidate.key.split(":")[0]} ${candidate.valueSource}`);
      expect(marks, `${item.kind} ${item.field}`).toEqual([
        "combined/part AmodioJost2007",
        "proposal/otherYear AmodioMaster2008",
      ]);
    }
    expect(ofRow.filter((item) => item.kind === "conflictingLead").map((item) => item.field).sort()).toEqual([
      "formerLead",
      "lead",
    ]);
    // The leads that the website confirmed for the two studies stay confirmed: nothing is written on a proposal
    // or on a cell that names two studies.
    for (const studyId of ["AmodioJost2007", "AmodioMaster2008"]) {
      const path = `replications/${studyId}/memberships/${replicationMembershipId(await websitePerson("aexample"), "lead")}`;
      expect(after.get(path), studyId).toEqual(before.get(path));
      expect(after.get(path), studyId).toMatchObject({ reviewStatus: "confirmed", isCurrent: true });
    }

    // A proposal is no match: the study gets no alias, no figure, no contact and no lead from the workbook.
    const aliases = [...(await documentsOf("aliases", true)).entries()].filter(([documentPath]) =>
      documentPath.startsWith("replications/AmodioMaster2008/"),
    );
    expect(aliases.map(([, alias]) => alias.alias)).toEqual(["AmodioMaster2008"]);
    expect(
      (await aggregates()).filter((entry) =>
        (entry.replicationIds as string[]).some((id) => ["AmodioMaster2008", "AmodioJost2007"].includes(id)),
      ),
    ).toEqual([]);
    const contacts = [...(await documentsOf("outreachContacts")).values()];
    expect(contacts.filter((entry) => entry.replicationId === "AmodioMaster2008")).toEqual([]);
    expect((await run(recruitment, file, "apply")).documentsWritten).toBe(0);
  });

  it("offers two names in one cell as co-lead candidates, and pairs the second address as a suggestion only", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const [candidates] = await itemsOf("candidateLink", "coLead");
    expect(candidates?.id).toBe(
      items.candidateLink({
        subject: "Hajcak2003",
        field: "coLead",
        claims: [
          { source: `f/${LEADS}/leader/1`, value: lookupFold("Ada Example") },
          { source: `f/${LEADS}/leader/2`, value: lookupFold("Fay Sample") },
          { source: `f/${LEADS}/additionalAddress/2`, value: "fay.sample@example.org" },
        ],
      }).fingerprint,
    );
    // The names are shown to the reviewer. The address is named by its record and is not copied into the item.
    expect(candidatesOf(candidates).map((candidate) => candidate.valueSource)).toEqual([
      "Ada Example",
      "Fay Sample",
      undefined,
    ]);
    expect(JSON.stringify(candidates)).not.toContain("@");
    // No co-lead is written, and the address is used for no matching.
    expect([...(await documentsOf("memberships", true)).values()].filter((entry) => entry.role === "coLead")).toEqual(
      [],
    );
  });

  it("links a lead to a person only where one name stands beside one address that already names that person", async () => {
    const ada = await websitePerson("aexample");
    const other = await websitePerson("bfictional");
    await knowAddress("ada.example@example.org", ada);
    await knowAddress("eli.madeup@example.org", other);
    await knowAddress("gus.mock@example.org", other);
    const before = await allDocuments();
    const file = await workbookFile();
    const report = await run(recruitment, file, "apply");
    const after = await allDocuments();
    const { created } = differences(before, after);
    // No person is created from the workbook, and no identity key.
    expect(created.filter((documentPath) => /^(persons|identityKeys)\/[^/]+$/.test(documentPath))).toEqual([]);
    // The person whom another address already names gets a membership that needs review.
    const membership = `replications/Boksem2006/memberships/${replicationMembershipId(other, "lead")}`;
    expect(after.get(membership)?.data).toMatchObject({
      replicationId: "Boksem2006",
      personId: other,
      role: "lead",
      isCurrent: true,
      reviewStatus: "needsReview",
      sourceRecordIds: [(await record("leadsEmails", "boksem2006")).id],
    });
    // The lead whom the website confirmed is the person this claim names. The membership stays one document, and
    // its confirmation is lowered in the same write, because the workbook records a former lead for the study.
    const confirmed = `replications/DelCul2007/memberships/${replicationMembershipId(ada, "lead")}`;
    expect(after.get(confirmed)?.data).toMatchObject({ reviewStatus: "needsReview", isCurrent: true });
    expect(((after.get(confirmed)?.data.sourceRecordIds ?? []) as string[]).length).toBe(2);
    // The combined row gives its lead to neither study, and two names in one cell link nobody.
    expect(created.filter((documentPath) => documentPath.includes("/memberships/"))).toEqual([membership]);
    expect(report.collections.replicationMemberships).toMatchObject({ created: 1 });

    // The address goes to the restricted contact document and to the index that no client reads.
    expect(after.get(`persons/${other}/private/contact`)?.data.emails).toEqual([
      {
        email: "eli.madeup@example.org",
        kind: "secondary",
        sourceRecordId: (await record("leadsEmails", "boksem2006")).id,
        verifiedAt: null,
        claimEligible: true,
      },
    ]);
    const index = `personEmailIndex/${personEmailIndexId("eli.madeup@example.org", TEST_HASH_KEY)}`;
    expect(after.get(index)?.data).toMatchObject({ personIds: [other], claimEligiblePersonIds: [other] });
    expect(index).not.toContain("@");
    // One address, in whatever case and with whatever space, is one entry.
    expect(((after.get(`persons/${ada}/private/contact`)?.data.emails ?? []) as unknown[]).length).toBe(1);
    const second = await run(recruitment, file, "apply");
    expect(second.documentsWritten).toBe(0);
    expect((await verify(recruitment, file)).filter((check) => !check.passed)).toEqual([]);
  });

  it("attaches nothing where an address names two people, and sends it to review without the address", async () => {
    await knowAddress("eli.madeup@example.org", await websitePerson("aexample"), await websitePerson("bfictional"));
    await run(recruitment, await workbookFile(), "apply");
    const [ambiguous] = await itemsOf("ambiguousEmail");
    expect(ambiguous).toMatchObject({ field: "email", status: "open" });
    expect(((ambiguous?.entityRefs ?? []) as { entityType: string }[]).map((ref) => ref.entityType)).toEqual([
      "replication",
      "person",
      "person",
    ]);
    expect(JSON.stringify(ambiguous)).not.toContain("eli.madeup");
    expect((await documentsOf("personEmailIndex")).size).toBe(0);
    const memberships = [...(await documentsOf("memberships", true)).keys()].filter((documentPath) =>
      documentPath.startsWith("replications/Boksem2006/"),
    );
    expect(memberships).toHaveLength(1);
  });
});

describe("the outreach tabs", () => {
  it("resolves a tab through the reviewed table of exact titles, whatever its title looks like", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const study = async (title: string, name: string) => (await contact(title, name)).replicationId;
    // A trailing underscore, a suffix, a title cut at 31 characters, and a diacritic that the identifier lacks.
    expect(await study("Vidal2000", "Bea Contact")).toBe("Vidal2000");
    expect(await study("Vidal2000_", "Yan Stub")).toBe("Vidal2000");
    expect(await study("Boksem2006_labs", "Zoe Added")).toBe("Boksem2006");
    expect(await study("DonkersvanBoxtel2004 lead", "Eve Unreal")).toBe("DonkersvanBoxtel2004");
    expect(await study("Miltner1999 replicating labs se", "Ned Maybe?")).toBe("Miltner1999");
    expect(await study("Müller2003 replicating labs sea", "Udo Dated")).toBe("Muller2003");
    // Each resolved title is an alias of its replication, in the scheme of tab titles.
    const alias = async (studyId: string, title: string) =>
      (await adminDb.doc(`replications/${studyId}/aliases/${studyAliasId("sourceTab", title)}`).get()).data();
    expect(await alias("Vidal2000", "Vidal2000_")).toMatchObject({
      alias: "Vidal2000_",
      scheme: "sourceTab",
      aliasFolded: "vidal2000",
      isCanonical: false,
      sourceRecordIds: [(await record("Vidal2000_", "tab")).id],
    });
    expect(await alias("Muller2003", "Müller2003 replicating labs sea")).toMatchObject({ scheme: "sourceTab" });
    const written = [...(await documentsOf("aliases", true)).values()].filter((entry) => entry.scheme === "sourceTab");
    expect(written).toHaveLength(18);
    // The two fixed title lines are the vocabulary of purposes. A remark after one stays in the source record.
    const purposes = [...(await documentsOf("vocabularyTerms")).values()].filter(
      (term) => term.kind === "outreachPurpose",
    );
    expect(purposes.map((term) => term.name).sort()).toEqual([
      "A search of Lead Replicating Lab",
      "A search of Replicating Labs",
    ]);
  });

  it("leaves the tab that runs two years together unresolved, and the tabs of a study that does not exist yet", async () => {
    await run(recruitment, await workbookFile(), "apply");
    // The row is stored, restricted to administrators, with no replication and no group.
    const unplaced = await contact("AmodioMaster20072008", "Xia Unplaced");
    expect(unplaced).toMatchObject({ replicationId: null, scopeKeys: [], contactEmail: "xia.unplaced@example.org" });
    expect(unplaced).not.toHaveProperty("groupKey");
    expect(await contact("Frank2005 lead", "Jay Orphan")).toMatchObject({ replicationId: null, scopeKeys: [] });
    const tabs = (await itemsOf("unmatchedIdentifier")).map((item) => item.id);
    const amodio = sourceTabKey("AmodioMaster20072008");
    expect(tabs).toContain(
      items.unmatchedIdentifier({
        subject: `f/${amodio}/study`,
        claims: [
          { source: `f/${amodio}/title`, value: "AmodioMaster20072008" },
          { source: `f/${amodio}/studyLine`, value: "amodio" },
        ],
      }).fingerprint,
    );
    const frank = sourceTabKey("Frank2005 lead");
    expect(tabs).toContain(
      items.unmatchedIdentifier({
        subject: `f/${frank}/study`,
        claims: [
          { source: `f/${frank}/title`, value: "Frank2005 lead" },
          { source: `f/${frank}/studyLine`, value: "frank" },
          { source: "reviewed", value: "Frank2005" },
        ],
      }).fingerprint,
    );
    // Seven identifiers and titles wait: two combined rows, two unknown identifiers and three tabs.
    expect(tabs).toHaveLength(7);
    expect([...(await documentsOf("aliases", true)).values()].map((entry) => entry.alias)).not.toContain(
      "AmodioMaster20072008",
    );
  });

  it("follows a reviewer's stored decision about a tab on the next import, and closes the question", async () => {
    const file = await workbookFile();
    await run(recruitment, file, "apply");
    const title = "AmodioMaster20072008";
    await adminDb.doc(`replications/AmodioJost2007/aliases/${studyAliasId("sourceTab", title)}`).set({
      ...createdFields(Timestamp.now()),
      schemaVersion: 1,
      replicationId: "AmodioJost2007",
      alias: title,
      aliasFolded: lookupFold(title),
      scheme: "sourceTab",
      isCanonical: false,
    });
    const report = await run(recruitment, file, "apply");
    expect(report.collections.outreachContacts).toMatchObject({ changed: 1 });
    expect(report.collections.outreachContacts?.fields).toEqual({ replicationId: 1, scopeKeys: 1, groupKey: 1 });
    expect(await contact(title, "Xia Unplaced")).toMatchObject({
      replicationId: "AmodioJost2007",
      scopeKeys: ["rep:AmodioJost2007"],
      groupKey: outreachGroupKey("AmodioJost2007", "Xia Unplaced", TEST_HASH_KEY),
    });
    const question = items.unmatchedIdentifier({
      subject: `f/${sourceTabKey(title)}/study`,
      claims: [
        { source: `f/${sourceTabKey(title)}/title`, value: title },
        { source: `f/${sourceTabKey(title)}/studyLine`, value: "amodio" },
      ],
    });
    const stored = (await reconciliationItems()).find((item) => item.id === question.fingerprint);
    expect(["cleared", "superseded"]).toContain(stored?.status);
    expect((await run(recruitment, file, "apply")).documentsWritten).toBe(0);
  });

  it("asks about a study line that begins with another name than the study of its tab", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const tab = sourceTabKey("Vidal2000_");
    const confirmations = await itemsOf("aliasConfirmation");
    expect(confirmations.map((item) => item.id)).toEqual([
      items.aliasConfirmation({
        subject: `f/${tab}/studyLine`,
        claims: [
          { source: `f/${tab}/title`, value: "Vidal2000_" },
          { source: `f/${tab}/studyLine`, value: "amodio" },
        ],
      }).fingerprint,
    ]);
    expect(confirmations[0]?.entityRefs).toEqual([{ entityType: "replication", entityId: "Vidal2000" }]);
    // A surname with a diacritic or of two words is the beginning of its identifier all the same.
    expect(candidatesOf(confirmations[0]).map((candidate) => candidate.valueSource)).toEqual(["Vidal2000_", "Amodio"]);
  });

  it("blocks only the tab whose study line names the paper of another study", async () => {
    const file = await workbookFile((fixture) => {
      const luck = outreach(fixture, "Luck1996");
      luck.preamble[2] = String(luck.preamble[2]).replace(recruitmentDoi("Luck1996"), recruitmentDoi("Onton2005"));
    });
    const report = await run(recruitment, file, "apply");
    expect(report.status).toBe("applied");
    expect(report.blocking).toEqual([]);
    const tab = report.tabs.find((entry) => entry.tabKey === sourceTabKey("Luck1996"));
    expect(tab).toMatchObject({ imported: 0, queued: 0, rawOnly: { tabBlocked: 2 } });
    expect(report.collections.outreachContacts).toMatchObject({ created: 45 });
    await expect(contact("Luck1996", "Sam Listed")).rejects.toThrow(/No outreach contact/);
    const key = sourceTabKey("Luck1996");
    const expected = items.unmatchedIdentifier({
      subject: `f/${key}/doi`,
      claims: [
        { source: `f/${key}/studyLine/doi`, value: recruitmentDoi("Onton2005") },
        { source: "replication/originalDoi", value: recruitmentDoi("Luck1996") },
      ],
    });
    expect((await itemsOf("unmatchedIdentifier")).map((item) => item.id)).toContain(expected.fingerprint);
    // No alias is written for a tab that is blocked, and its remark and its strike-through raise nothing.
    const tabAliases = [...(await documentsOf("aliases", true)).values()].filter(
      (entry) => entry.scheme === "sourceTab",
    );
    expect(tabAliases.map((entry) => entry.alias)).not.toContain("Luck1996");
    expect(tabAliases).toHaveLength(17);
    expect((await verify(recruitment, file)).filter((check) => !check.passed)).toEqual([]);
  });

  it("keeps a tab without the header row raw, sends it to review, and imports the others", async () => {
    const file = await workbookFile((fixture) => {
      outreach(fixture, "Onton2005").headers[4] = "outcome";
    });
    const report = await run(recruitment, file, "apply");
    expect(report.status).toBe("applied");
    const tab = report.tabs.find((entry) => entry.tabKey === sourceTabKey("Onton2005"));
    // Every row of the tab is kept as an annotation, and none is read as a contact.
    expect(tab).toMatchObject({ rows: expect.objectContaining({ header: 0, data: 0, annotation: 6 }), imported: 0 });
    expect(report.collections.outreachContacts).toMatchObject({ created: 45 });
    const key = sourceTabKey("Onton2005");
    expect((await itemsOf("structureChange")).map((item) => item.id)).toEqual([
      items.structureChange({
        subject: `f/${key}/layout`,
        claims: [
          { source: "expected", value: "outreach" },
          { source: "found", value: "unknown" },
        ],
      }).fingerprint,
    ]);
  });

  it.each<[string, (fixture: RecruitmentFixture) => void]>([
    [
      "a tab is missing",
      (fixture) => {
        fixture.outreach = fixture.outreach.filter((tab) => tab.title !== "Inzlicht2009");
      },
    ],
    [
      "a tab is renamed",
      (fixture) => {
        outreach(fixture, "Luck1996").title = "Luck1996 lead";
      },
    ],
    [
      "a tab is new",
      (fixture) => {
        fixture.extraTabs.push({ ...outreach(fixture, "Luck1996"), title: "Luck1996 lead" });
      },
    ],
    [
      "a summary tab is missing",
      (fixture) => {
        fixture.leads.headers = [];
      },
    ],
  ])("imports nothing when %s, and proposes a study for a new title that its DOI confirms", async (label, change) => {
    const file = await workbookFile(change);
    const preview = await run(recruitment, file, "preview");
    expect(preview.blocking.map((entry) => entry.check)).toEqual(["tabs"]);
    // The message counts the tabs and quotes no title.
    expect(preview.blocking[0]?.message).toMatch(
      /^The workbook does not hold exactly the reviewed tabs: \d are missing and \d are new or renamed\.$/,
    );
    const report = await run(recruitment, file, "apply");
    expect(report.status).toBe("failed");
    expect((await documentsOf("outreachContacts")).size).toBe(0);
    expect(await aggregates()).toHaveLength(0);
    const [block] = await itemsOf("structureChange");
    expect(await itemCounts()).toMatchObject({ structureChange: 1 });
    const keys = candidatesOf(block).map((candidate) => candidate.key.split(":")[0]);
    if (label === "a tab is missing") expect(keys).toEqual(["expected"]);
    if (label === "a summary tab is missing") expect(keys).toEqual(["expected"]);
    if (label === "a tab is renamed")
      expect(keys).toEqual(["expected", "found", `proposal/${sourceTabKey("Luck1996 lead")}`]);
    if (label === "a tab is new") {
      expect(keys).toEqual(["found", `proposal/${sourceTabKey("Luck1996 lead")}`]);
      // The proposal is a candidate of the item. Nothing is resolved by it.
      expect(candidatesOf(block).map((candidate) => candidate.valueSource)).toEqual(["Luck1996 lead", "Luck1996"]);
    }
    expect((await verify(recruitment, file)).find((check) => check.key === "structure")?.passed).toBe(false);
  });

  it("stores each contact row as a restricted outreach contact, with every cell verbatim and its readings beside it", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const row = await record("Vidal2000", contactKey("Bea Contact"));
    const bea = await contact("Vidal2000", "Bea Contact");
    expect(bea).toMatchObject({
      replicationId: "Vidal2000",
      // Only the leads of the replication and administrators read the row.
      scopeKeys: ["rep:Vidal2000"],
      contactNameSource: "Bea Contact",
      contactEmail: "bea.contact@example.org",
      firstContactSource: "05.03.21",
      firstContactDate: "2021-03-05",
      followUpSource: "19.04.21",
      followUpDate: "2021-04-19",
      resultSource: "no reply",
      formatting: { struckThrough: false, fillColour: "red" },
      groupKey: outreachGroupKey("Vidal2000", "Bea Contact", TEST_HASH_KEY),
      sourceRecordId: row.id,
      sourceRecordIds: [row.id],
    });
    // The importer proposes no category, creates no laboratory and links no person. A reviewer does.
    for (const field of ["resultCategory", "laboratoryId", "labNameSource", "personId", "notes", "links"]) {
      expect(bea, field).not.toHaveProperty(field);
    }
    expect(contactId("Vidal2000", "Bea Contact")).toMatch(/^oc__f__[0-9a-f]{20}__[0-9a-f]{20}__1$/);
    // A tentative name keeps its question mark, and a date with four digits of the year is read like one with two.
    expect(await contact("Vidal2000", "Cal Sample?")).toMatchObject({
      contactNameSource: "Cal Sample?",
      firstContactSource: "16.06.2021",
      firstContactDate: "2021-06-16",
      resultSource: "declined",
    });
    // An address is kept as written, trailing space included.
    expect((await contact("Onton2005 lead", "Oda Pair, Pat Pair")).contactEmail).toBe("oda.pair@example.org ");
    // A name-only row is a contact with a name and nothing else.
    const dot = await contact("Vidal2000", "Dot Imagined");
    expect(
      Object.keys(dot)
        .filter((field) => field.endsWith("Source") || field.endsWith("Date"))
        .sort(),
    ).toEqual(["contactNameSource"]);
    expect(dot.formatting).toEqual({ struckThrough: false });
  });

  it("reads a true date only where it can be read in one way, and keeps the cell as written in any case", async () => {
    await run(recruitment, await workbookFile(), "apply");
    // The day number of the file is kept. The fourteenth of a month can only be day first.
    expect(await contact("HajcakMoser2005", "Eda Twice")).toMatchObject({
      firstContactSource: "44278",
      firstContactDate: "2021-03-23",
      followUpSource: "44333",
      followUpDate: "2021-05-17",
    });
    // The ninth of March may have been typed as the third of September, so no date is stored.
    const ambiguous = await contact("HajcakMoser2005", "Hed Ambiguous");
    expect(ambiguous.firstContactSource).toBe("44264");
    expect(ambiguous).not.toHaveProperty("firstContactDate");
    const id = contactId("HajcakMoser2005", "Hed Ambiguous");
    const tab = sourceTabKey("HajcakMoser2005");
    expect((await itemsOf("unparsedValue", "firstContactDate")).map((item) => item.id)).toEqual([
      items.unparsedValue({
        subject: id,
        field: "firstContactDate",
        personal: true,
        claims: [{ source: `f/${tab}/firstContact/ambiguous`, value: "44264" }],
      }).fingerprint,
    ]);
    // A follow-up before the first contact is stored as read, and reviewed.
    const eve = await contact("DonkersvanBoxtel2004 lead", "Eve Unreal");
    expect(eve).toMatchObject({ firstContactDate: "2021-11-18", followUpDate: "2021-02-07" });
    const lead = sourceTabKey("DonkersvanBoxtel2004 lead");
    expect((await itemsOf("unparsedValue", "followUpOrder")).map((item) => item.id)).toEqual([
      items.unparsedValue({
        subject: contactId("DonkersvanBoxtel2004 lead", "Eve Unreal"),
        field: "followUpOrder",
        personal: true,
        claims: [
          { source: `f/${lead}/firstContact`, value: "2021-11-18" },
          { source: `f/${lead}/followUp`, value: "2021-02-07" },
        ],
      }).fingerprint,
    ]);
  });

  it("captures strike-through and fill colour as formatting flags, and reviews a colour that stands alone or contradicts", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const formatting = async (title: string, name: string) => (await contact(title, name)).formatting;
    expect(await formatting("Luck1996", "Tia Struck")).toEqual({ struckThrough: true });
    expect(await formatting("Boksem2006", "Kit Placeholder")).toEqual({ struckThrough: false, fillColour: "green" });
    // A colour of the theme is a red like any other, and a fill over empty cells is the fill of the row.
    expect(await formatting("HajcakMoser2005", "Eda Twice")).toEqual({ struckThrough: false, fillColour: "red" });
    expect(await formatting("HajcakMoser2005", "Ida Filled")).toEqual({ struckThrough: false, fillColour: "red" });
    expect(await formatting("HajcakMoser2005", "Jun Green")).toEqual({ struckThrough: false, fillColour: "green" });
    // White is a pasted background, and any other colour is kept as other.
    expect(await formatting("HajcakMoser2005", "Kai Pasted")).toEqual({ struckThrough: false });
    expect(await formatting("HajcakMoser2005", "Lin Yellow")).toEqual({ struckThrough: false, fillColour: "other" });

    const tab = sourceTabKey("HajcakMoser2005");
    const onton = sourceTabKey("Onton2005");
    const signal = (title: string, name: string, key: string, check: string, value: string) =>
      items.formattingSignal({
        subject: contactId(title, name),
        field: "fill",
        personal: true,
        claims: [{ source: `f/${key}/fill/${check}`, value }],
      }).fingerprint;
    expect((await itemsOf("formattingSignal")).map((item) => item.id).sort()).toEqual(
      [
        signal("HajcakMoser2005", "Jun Green", tab, "withoutResult", "green"),
        signal("HajcakMoser2005", "Lin Yellow", tab, "other", "rgb:FFFFFF00|null"),
        signal("Onton2005", "Val Second", onton, "contradicts", "red:accepted"),
      ].sort(),
    );
    // The strike-through of a candidate changes nothing and raises nothing: the flag is the record of it.
    expect(await contact("Luck1996", "Tia Struck")).toMatchObject({ notes: "wrote about an invented topic" });
  });

  it("offers an accepting result, and a row that is marked by a green fill alone, as a candidate that only a reviewer may link", async () => {
    const before = await allDocuments();
    await run(recruitment, await workbookFile(), "apply");
    const candidates = (await itemsOf("candidateLink")).filter((item) => item.field !== "coLead");
    const link = (title: string, name: string, field: string, part: string, value: string) =>
      items.candidateLink({
        subject: contactId(title, name),
        field,
        personal: true,
        claims: [{ source: `f/${sourceTabKey(title)}/${part}`, value }],
      }).fingerprint;
    expect(candidates.map((item) => item.id).sort()).toEqual(
      [
        // An acceptance in a search for a lead is a candidate lead. In a search for labs it is a candidate participation.
        link("Boksem2006", "Kit Placeholder", "lead", "result", "agreed"),
        link("Boksem2006_labs", "Kit Placeholder", "participation", "result", "agreed"),
        link("Miltner1999", "Lou Forwarder", "participation", "result", "accepted"),
        link("Onton2005", "Val Second", "participation", "result", "agreed"),
        link("HajcakMoser2005", "Jun Green", "participation", "fill", "green"),
      ].sort(),
    );
    // The result as written is restricted to the contact. An item says that it reads as accepting, and shows no more.
    expect(
      [...new Set(candidates.flatMap((item) => candidatesOf(item).map((candidate) => candidate.valueSource)))].sort(),
    ).toEqual(["accepted", "green"]);
    // No result creates a participation, a membership, a laboratory, a person or an invitation.
    const { created } = differences(before, await allDocuments());
    const collections = new Set(created.map((documentPath) => documentPath.split("/")[0]));
    expect([...collections].sort()).toEqual([
      "historicalAggregates",
      "importBatches",
      "outreachContacts",
      "reconciliationItems",
      "replications",
      "sourceRecords",
      "sources",
      "studyAliasIndex",
      "vocabularyTerms",
    ]);
    expect(
      created
        .filter((documentPath) => documentPath.startsWith("replications/"))
        .every((documentPath) => documentPath.includes("/aliases/")),
    ).toBe(true);
    expect((await contact("Boksem2006", "Kit Placeholder")).resultSource).toBe("agreed");
  });

  it("sends a result that it cannot read as a status to review, once for each distinct text, and shows none of them", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const results = await itemsOf("vocabularyReview", "result");
    expect(results).toHaveLength(3);
    // A result is restricted to the outreach contact. The item names the first row that holds it and shows no text,
    // neither a short status nor a long account of a person's conduct.
    const shown = results.flatMap((item) => candidatesOf(item).map((candidate) => candidate.valueSource));
    expect(shown).toEqual([undefined, undefined, undefined]);
    expect(results.every((item) => candidatesOf(item).every((candidate) => candidate.sourceRecordId !== undefined))).toBe(
      true,
    );
    expect(JSON.stringify(results)).not.toMatch(/busy with another invented project|a long invented account/);
    // The result itself is stored verbatim on the restricted contact, whatever it says.
    expect((await contact("BuschVanRullen2010", "Rui Staff")).resultSource).toMatch(/^a long invented account/);
  });

  it("keeps a recipient list, a section label, a note and a cell with two people as annotations, and expands none", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const contacts = [...(await documentsOf("outreachContacts")).values()];
    expect(contacts).toHaveLength(47);
    const text = JSON.stringify(contacts);
    // No address of the pasted list becomes a contact, and no annotation becomes a name.
    for (const absent of [
      "vic.sham",
      "wyn.faux",
      "xan.bogus",
      "More invented names",
      "Mentor",
      "invented call",
      "Yul Phantom",
    ]) {
      expect(text).not.toContain(absent);
    }
    const miltner = sourceTabKey("Miltner1999");
    const list = (await records("Miltner1999")).find((row) => row.rowKey.startsWith("list__"));
    const anchor = await record("Miltner1999", contactKey("Lou Forwarder"));
    const privacy = (await itemsOf("privacyReview")).find((item) =>
      candidatesOf(item).some((candidate) => candidate.sourceRecordId === list?.id),
    );
    // The list waits for a privacy review. The item names the row above, whose merged cells cover it, and shows nothing.
    expect(candidatesOf(privacy).map((candidate) => [candidate.key.split(":")[0], candidate.sourceRecordId])).toEqual([
      [`f/${miltner}/list`, list?.id],
      [`f/${miltner}/mergedWith`, anchor.id],
    ]);
    expect(candidatesOf(privacy).every((candidate) => candidate.valueSource === undefined)).toBe(true);
    const kinds = (await itemsOf("annotationReview"))
      .flatMap((item) =>
        candidatesOf(item).map((candidate) => candidate.key.split(":")[0]?.split("/").slice(2).join("/")),
      )
      .sort();
    expect(kinds).toEqual([
      "derived/handBuilt/formula",
      // The stray cell beside the notes that holds nothing but an address.
      "extra/G",
      // The label of the rows below it.
      "label",
      // The pointer to a paper, in two tabs, and the note to self.
      "note",
      "note",
      "note",
      // Two people in one cell, with a role.
      "people",
      // The first line of a tab that is nothing but a name, and the tab that states no purpose.
      "preamble",
      "purpose",
    ]);
    // The rows below the section label are contacts with a name alone.
    expect(await contact("DelCul2007", "Cam Later")).toMatchObject({ contactNameSource: "Cam Later" });
  });

  it("gives the value of a merged range to its upper row alone, and names that row for the row below", async () => {
    const file = await workbookFile((fixture) => {
      // The lower row of the merged ranges is a contact here, and no pasted list.
      const miltner = outreach(fixture, "Miltner1999");
      miltner.rows[1] = ["Moe Below", null, null, null, null, null];
      miltner.merges = ["C4:C5", "D4:D5", "E4:E5"];
    });
    await run(recruitment, file, "apply");
    const upper = await contact("Miltner1999", "Lou Forwarder");
    const lower = await contact("Miltner1999", "Moe Below");
    expect(upper).toMatchObject({ firstContactDate: "2021-09-27", resultSource: "accepted" });
    // Nothing is copied down: the lower row has no date and no result of its own.
    expect(Object.keys(lower).filter((field) => /^(firstContact|followUp|result)/.test(field))).toEqual([]);
    // The lower cells show the green fill of the row above, which is no signal of the row below.
    expect((await record("Miltner1999", contactKey("Moe Below"))).raw).toMatchObject({
      E: { v: null, fill: "8FCB7A", merge: "E4:E5" },
    });
    expect(lower.formatting).toEqual({ struckThrough: false });
    expect(await itemsOf("formattingSignal")).toHaveLength(3);
    const [merged] = await itemsOf("annotationReview", "merged");
    expect(candidatesOf(merged).map((candidate) => candidate.sourceRecordId)).toEqual([
      lower.sourceRecordId,
      upper.sourceRecordId,
    ]);
    expect(merged?.id).toBe(
      items.annotationReview({
        subject: contactId("Miltner1999", "Moe Below"),
        field: "merged",
        personal: true,
        claims: [
          { source: `f/${sourceTabKey("Miltner1999")}/merged`, value: contactKey("Moe Below") },
          { source: `f/${sourceTabKey("Miltner1999")}/mergedWith`, value: contactKey("Lou Forwarder") },
        ],
      }).fingerprint,
    );
  });

  it("reviews a name cell that holds more than one plain name, without splitting it and without copying it", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const names = await itemsOf("unparsedValue", "contactName");
    const name = (title: string, cell: string, check: string, value = check) =>
      items.unparsedValue({
        subject: contactId(title, cell),
        field: "contactName",
        personal: true,
        claims: [{ source: `f/${sourceTabKey(title)}/contactName/${check}`, value }],
      }).fingerprint;
    expect(names.map((item) => item.id).sort()).toEqual(
      [
        name("Vidal2000", "Cal Sample?", "tentative"),
        name("Miltner1999", "Ned Maybe?", "tentative"),
        name("Miltner1999 replicating labs se", "Ned Maybe?", "tentative"),
        name("DonkersvanBoxtel2004 lead", "f.unreal", "addressForm"),
        name("Onton2005 lead", "Oda Pair, Pat Pair", "comma"),
        // Two people between semicolons: the item says how many, and the row stays one contact.
        name("DelCul2007", "Abe First; Bex First", "semicolon", "2"),
      ].sort(),
    );
    expect(JSON.stringify(names)).not.toMatch(/Sample|Maybe|unreal|Pair|First/);
    expect((await contact("DelCul2007", "Abe First; Bex First")).contactNameSource).toBe("Abe First; Bex First");
  });

  it("keeps a reversed address as written, queues it without showing it, and matches on neither", async () => {
    await knowAddress("unreal@example.org", await websitePerson("aexample"));
    await run(recruitment, await workbookFile(), "apply");
    const reversed = await contact("DonkersvanBoxtel2004 lead", "f.unreal");
    expect(reversed.contactEmail).toBe("gro.elpmaxe@laernu");
    expect(reversed).not.toHaveProperty("personId");
    const tab = sourceTabKey("DonkersvanBoxtel2004 lead");
    const defects = await itemsOf("identifierDefect");
    expect(defects.map((item) => item.id).sort()).toEqual(
      [
        ["f.unreal", "unreal@example.org"],
        ["Gil Unreal", "gilunreal@example.org"],
      ]
        .map(
          ([cell = "", decoded = ""]) =>
            items.identifierDefect({
              subject: contactId("DonkersvanBoxtel2004 lead", cell),
              field: "contactEmail",
              personal: true,
              claims: [{ source: `f/${tab}/contactEmail/reversed`, value: decoded }],
            }).fingerprint,
        )
        .sort(),
    );
    // The address is shown in no item, decoded or not. A reviewer reads the cell in its source record.
    expect(defects.flatMap((item) => candidatesOf(item).map((candidate) => candidate.valueSource))).toEqual([
      undefined,
      undefined,
    ]);
    expect(JSON.stringify(await reconciliationItems())).not.toMatch(/@example\.org|gro\.elpmaxe/);
  });

  it("links a contact to a person only through an address that already names that person, and creates nobody", async () => {
    const known = await websitePerson("bfictional");
    await knowAddress("bea.contact@example.org", known);
    await knowAddress("oda.pair@example.org", known);
    const people = (await documentsOf("persons")).size;
    await run(recruitment, await workbookFile(), "apply");
    expect((await contact("Vidal2000", "Bea Contact")).personId).toBe(known);
    // The address is trimmed and lower-cased for matching only.
    expect((await contact("Onton2005 lead", "Oda Pair, Pat Pair")).personId).toBe(known);
    expect(await contact("Vidal2000", "Cal Sample?")).not.toHaveProperty("personId");
    expect((await documentsOf("persons")).size).toBe(people);
    expect((await documentsOf("personEmailIndex")).size).toBe(0);
  });

  it("keeps the links of the notes with the contact, without access tokens and session parameters, and reports those", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const eve = await contact("DonkersvanBoxtel2004 lead", "Eve Unreal");
    expect(eve.links).toEqual([
      {
        urlSource: "https://papers.example.org/doi/full/10.1000/invented?casa_token=AN-INVENTED-TOKEN",
        url: "https://papers.example.org/doi/full/10.1000/invented",
      },
      // The stray cell beside the notes: the target of its hyperlink is preferred over its text, which ends with `#`.
      {
        urlSource: "https://articles.example.org/an-invented-article",
        url: "https://articles.example.org/an-invented-article",
      },
    ]);
    // The note itself is stored as written.
    expect(eve.notes).toBe("https://papers.example.org/doi/full/10.1000/invented?casa_token=AN-INVENTED-TOKEN");
    expect((await contact("Onton2005 lead", "Oda Pair, Pat Pair")).links).toEqual([
      {
        urlSource: "https://papers.example.org/science/article/pii/INVENTED?via%3Dihub",
        url: "https://papers.example.org/science/article/pii/INVENTED",
      },
    ]);
    expect((await contact("Onton2005 lead", "Quy Reader")).links).toEqual([
      {
        urlSource: "https://journals.example.org/article/1/2/3?login=false",
        url: "https://journals.example.org/article/1/2/3",
      },
    ]);
    // An address inside a sentence is found as well, and an address in a mail link is no link.
    expect((await contact("DonkersvanBoxtel2004 lead", "Gil Unreal")).links).toEqual([
      { urlSource: "https://staff.example.org/people/gil-unreal", url: "https://staff.example.org/people/gil-unreal" },
    ]);
    expect(await contact("Miltner1999", "Lou Forwarder")).not.toHaveProperty("links");
    const defects = await itemsOf("linkDefect");
    expect(defects).toHaveLength(3);
    expect(JSON.stringify(defects)).not.toMatch(/casa_token|INVENTED|https?:/);
    // A link of this kind can name the person, so none becomes a document link that a wider audience reads.
    expect((await documentsOf("documentLinks")).size).toBe(
      [...(await documentsOf("documentLinks")).values()].filter(
        (link) => !String(link.url).includes("example.org/people"),
      ).length,
    );
    expect(
      [...(await documentsOf("documentLinks")).values()].filter((link) =>
        String(link.url).includes("papers.example.org/doi"),
      ),
    ).toEqual([]);
  });

  it("withholds a note that may quote correspondence, and a remark in a column without a header, until a reviewer decides", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const quoted = await contact("Miltner1999", "Moe Quoted");
    expect(quoted).not.toHaveProperty("notes");
    expect(quoted).toMatchObject({ resultSource: "declined", contactEmail: "moe.quoted@example.org" });
    const struck = await contact("Luck1996", "Tia Struck");
    expect(JSON.stringify(struck)).not.toContain("nobody should read");
    const privacy = await itemsOf("privacyReview");
    // Two quoted notes, in the two tabs that hold the row, one stray remark, the pasted list and the two side columns.
    expect(privacy).toHaveLength(6);
    expect(privacy.filter((item) => item.field === "notes")).toHaveLength(2);
    expect(privacy.filter((item) => item.field === "extraG")).toHaveLength(1);
    const everything = JSON.stringify([privacy, [...(await documentsOf("outreachContacts")).values()]]);
    expect(everything).not.toContain("Uma Nemo");
    expect(everything).not.toContain("nobody should read");
    // The cells themselves are where they were found: in the restricted source records.
    expect(JSON.stringify((await record("Miltner1999", contactKey("Moe Quoted"))).raw)).toContain("Uma Nemo");
  });

  it("links the copies of one contact in the tabs of one study by a group key, compares them, and merges nothing", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const group = outreachGroupKey("Boksem2006", "Kit Placeholder", TEST_HASH_KEY);
    const lead = await contact("Boksem2006", "Kit Placeholder");
    const labs = await contact("Boksem2006_labs", "Kit Placeholder");
    expect(lead.groupKey).toBe(group);
    expect(labs.groupKey).toBe(group);
    // Two rows stay two contacts, each with its own source record.
    expect(lead.sourceRecordId).not.toBe(labs.sourceRecordId);
    // The same name in the tabs of two studies is no copy.
    expect((await contact("Hajcak2006", "Eda Twice")).groupKey).not.toBe(
      (await contact("HajcakMoser2005", "Eda Twice")).groupKey,
    );
    const conflicts = (await itemsOf("valueConflict")).filter((item) =>
      ["content", "purpose"].includes(item.field as string),
    );
    // Three rows with a date or a result were copied from the search for a lead into the search for labs.
    expect(conflicts.filter((item) => item.field === "purpose")).toHaveLength(3);
    const purposes = conflicts.find((item) =>
      candidatesOf(item).some((candidate) => candidate.sourceRecordId === lead.sourceRecordId),
    );
    expect(purposes).toMatchObject({
      field: "purpose",
      entityRefs: [{ entityType: "replication", entityId: "Boksem2006" }],
    });
    expect(candidatesOf(purposes).map((candidate) => candidate.key.split(":")[0])).toEqual([
      `f/${sourceTabKey("Boksem2006")}/leadSearch`,
      `f/${sourceTabKey("Boksem2006_labs")}/labSearch`,
    ]);
    // A copied row without a date and a result says nothing of either search, and an exact copy elsewhere is no conflict.
    const copied = [
      (await contact("Boksem2006", "Nia Fake")).sourceRecordId,
      (await contact("DonkersvanBoxtel2004", "Ian Shared")).sourceRecordId,
    ];
    expect(
      conflicts.filter((item) => candidatesOf(item).some((candidate) => copied.includes(candidate.sourceRecordId))),
    ).toEqual([]);
    // One person with other content in two tabs of one study: both values are kept and a person decides.
    const differing = conflicts.filter((item) => item.field === "content");
    expect(differing).toHaveLength(2);
    const hua = [
      (await contact("DonkersvanBoxtel2004 lead", "Hua Shared")).sourceRecordId,
      (await contact("DonkersvanBoxtel2004", "Hua Shared")).sourceRecordId,
    ];
    expect(differing.map((item) => candidatesOf(item).map((candidate) => candidate.sourceRecordId))).toContainEqual(
      hua,
    );
    expect(JSON.stringify(conflicts)).not.toMatch(/Hua|Kit|Lou|example\.org/);
    expect((await contact("DonkersvanBoxtel2004 lead", "Hua Shared")).resultSource).toBe("declined");
    expect(await contact("DonkersvanBoxtel2004", "Hua Shared")).not.toHaveProperty("resultSource");
  });
});

describe("the recruitment and contact workbook before its studies exist", () => {
  it("creates no replication, places nothing beneath a study, and still stores and accounts for every row", async () => {
    await freshDatabase();
    const file = await workbookFile();
    const report = await run(recruitment, file, "apply");
    expect(report.status).toBe("applied");
    expect((await documentsOf("replications")).size).toBe(0);
    expect(await aggregates()).toHaveLength(0);
    // Every contact row is stored, restricted to administrators, until its tab has a study.
    const contacts = [...(await documentsOf("outreachContacts")).values()];
    expect(contacts).toHaveLength(47);
    expect(contacts.every((entry) => entry.replicationId === null && (entry.scopeKeys as string[]).length === 0)).toBe(
      true,
    );
    expect(contacts.some((entry) => "groupKey" in entry)).toBe(false);
    expect([...(await documentsOf("aliases", true)).values()]).toEqual([]);
    for (const tab of report.tabs) expect(tab.unaccounted, tab.tabKey).toBe(0);
    // Each study row of the two summary tabs waits in the queue with its identifier.
    const summary = report.tabs.filter((tab) => [COUNTS, LEADS].includes(tab.tabKey));
    expect(summary.map((tab) => [tab.imported, tab.queued])).toEqual([
      [0, 12],
      [0, 12],
    ]);
    expect((await verify(recruitment, file)).filter((check) => !check.passed)).toEqual([]);

    // Once the studies exist, the same file gives the rows their replications.
    await applyWebsite();
    const later = await run(recruitment, file, "apply");
    expect(later.collections.historicalAggregates).toMatchObject({ created: 26 });
    expect(later.collections.outreachContacts).toMatchObject({ created: 0, changed: 45 });
    expect((await contact("Vidal2000", "Bea Contact")).scopeKeys).toEqual(["rep:Vidal2000"]);
    expect((await verify(recruitment, file)).filter((check) => !check.passed)).toEqual([]);
  });
});

describe("a later import of the recruitment and contact workbook", () => {
  it("raises each kind of item once, and writes nothing on a second run or on another copy of the file", async () => {
    const file = await workbookFile();
    const first = await run(recruitment, file, "apply");
    expect(first.items.raise).toEqual({
      aliasConfirmation: 1,
      annotationReview: 9,
      candidateLink: 6,
      conflictingLead: 9,
      formattingSignal: 3,
      identifierDefect: 2,
      linkDefect: 3,
      privacyReview: 6,
      statusQuestion: 2,
      unmatchedIdentifier: 7,
      unparsedValue: 9,
      valueConflict: 7,
      vocabularyReview: 3,
    });
    const before = await allDocuments();
    const second = await run(recruitment, file, "apply");
    expect(second.documentsWritten).toBe(0);
    expect(second.changesCommitted).toBe(0);
    expect(second.sourceRecords).toMatchObject({ created: 0, superseded: 0, missing: 0 });
    expect(second.items.raise).toEqual({});
    expect(second.items.standing).toBe(67);
    const { created, removed, rewritten } = differences(before, await allDocuments());
    expect(created).toEqual([`importBatches/${second.batchId}`]);
    expect(removed).toEqual([]);
    expect(rewritten).toEqual([]);
    const copy = await run(recruitment, await workbookFile(), "apply");
    expect(copy.documentsWritten).toBe(0);
    const checks = await verify(recruitment, file);
    expect(checks.map((check) => check.key)).toHaveLength(11);
    expect(checks.filter((check) => !check.passed)).toEqual([]);
  });

  it("follows a changed cell of a row, keeps the earlier record, and leaves what a reviewer set", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const id = contactId("Vidal2000", "Dot Imagined");
    const earlier = await record("Vidal2000", contactKey("Dot Imagined"));
    // A reviewer sets the category, which the importer never writes.
    await adminDb.doc(`outreachContacts/${id}`).update({ resultCategory: "declined" });
    const file = await workbookFile((fixture) => {
      outreach(fixture, "Vidal2000").rows[2] = ["Dot Imagined", null, "06.12.21", null, "declined", null];
    });
    const report = await run(recruitment, file, "apply");
    expect(report.sourceRecords).toMatchObject({ created: 1, superseded: 1 });
    expect(report.collections.outreachContacts).toMatchObject({ created: 0, changed: 1, unchanged: 46 });
    expect(report.collections.outreachContacts?.fields).toEqual({
      firstContactSource: 1,
      firstContactDate: 1,
      resultSource: 1,
      sourceRecordId: 1,
    });
    const current = await record("Vidal2000", contactKey("Dot Imagined"));
    expect(await contact("Vidal2000", "Dot Imagined")).toMatchObject({
      resultSource: "declined",
      firstContactDate: "2021-12-06",
      resultCategory: "declined",
      sourceRecordId: current.id,
      sourceRecordIds: [current.id],
    });
    expect((await adminDb.doc(`sourceRecords/${earlier.id}`).get()).data()).toMatchObject({
      supersededById: current.id,
    });
    // The change log of the batch holds the state before and after, where only those who run imports read it.
    const changes = await adminDb.collection(`importBatches/${report.batchId}/changes`).get();
    const logged = changes.docs
      .map((doc) => doc.data())
      .find((change) => change.documentPath === `outreachContacts/${id}`);
    expect(logged).toMatchObject({ operation: "update", relation: "updated", after: { resultSource: "declined" } });
    expect(((logged?.before ?? {}) as DocumentData).resultSource).toBeUndefined();
  });

  it("never overwrites a field that was edited in the portal, and raises one conflict for it", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const id = contactId("Luck1996", "Sam Listed");
    await adminDb.doc(`outreachContacts/${id}`).update({ notes: "a note that an invented lead wrote in the portal" });
    const file = await workbookFile((fixture) => {
      outreach(fixture, "Luck1996").rows[0] = [
        "Sam Listed",
        null,
        null,
        null,
        null,
        "a note that the invented sheet now holds",
      ];
    });
    const report = await run(recruitment, file, "apply");
    expect(report.conflicts).toBe(1);
    const stored = await contact("Luck1996", "Sam Listed");
    expect(stored.notes).toBe("a note that an invented lead wrote in the portal");
    expect(stored.importedValues).toMatchObject({ notes: "a note that the invented sheet now holds" });
    const conflicts = (await itemsOf("valueConflict")).filter((item) => item.field === "notes");
    expect(conflicts).toHaveLength(1);
    await run(recruitment, file, "apply");
    expect((await itemsOf("valueConflict")).filter((item) => item.field === "notes")).toHaveLength(1);
  });

  it("deletes nothing when a row disappears: the contact stays, and one item names it", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const id = contactId("Vidal2000", "Dot Imagined");
    const file = await workbookFile((fixture) => {
      outreach(fixture, "Vidal2000").rows.pop();
    });
    const report = await run(recruitment, file, "apply");
    expect(report.sourceRecords).toMatchObject({ missing: 1 });
    expect((await adminDb.doc(`outreachContacts/${id}`).get()).exists).toBe(true);
    const [missing] = await itemsOf("missingFromSource");
    expect(candidatesOf(missing).map((candidate) => candidate.valueSource)).toContain(`outreachContacts/${id}`);
    expect(JSON.stringify(missing)).not.toContain("Imagined");
  });

  it("closes an item whose condition has gone from the workbook, and raises one for a condition that is new", async () => {
    await run(recruitment, await workbookFile(), "apply");
    const file = await workbookFile((fixture) => {
      // The old leader is removed, and a reversed address is corrected.
      const delcul = fixture.leads.rows.find((row) => row.study === "DelCul2007");
      if (delcul) delcul.oldLeader = null;
      const row = outreach(fixture, "DonkersvanBoxtel2004 lead").rows[1];
      if (row) row[1] = "unreal@example.org";
    });
    const report = await run(recruitment, file, "apply");
    const closed = Object.values(report.items.clear).reduce((sum, count) => sum + (count ?? 0), 0);
    const superseded = Object.values(report.items.supersede).reduce((sum, count) => sum + (count ?? 0), 0);
    // The former lead of the study, the lead line that named him, and the defect of the address.
    expect(closed + superseded).toBe(3);
    expect((await itemsOf("identifierDefect")).filter((item) => item.status === "open")).toHaveLength(1);
    // The lead line still names somebody other than the leader, so the question about it is asked anew.
    expect(report.items.raise).toEqual({ conflictingLead: 1 });
    expect((await contact("DonkersvanBoxtel2004 lead", "f.unreal")).contactEmail).toBe("unreal@example.org");
  });
});

describe("personal data of the recruitment and contact workbook", () => {
  it("writes no name, address, date, result, note or link to a document that members can read", async () => {
    await knowAddress("eli.madeup@example.org", await websitePerson("bfictional"));
    const before = await allDocuments();
    await run(recruitment, await workbookFile(), "apply");
    const after = await allDocuments();
    const { created, rewritten } = differences(before, after);
    const written = [...created, ...rewritten];
    const readable = written.filter((documentPath) =>
      membersCanRead(documentPath, (after.get(documentPath) as StoredDocument).data),
    );
    // The figures, the aliases of the tab titles, the purposes and the membership that needs review.
    expect(
      new Set(
        readable.map((documentPath) =>
          documentPath
            .split("/")
            .slice(0, -1)
            .filter((_part, index) => index % 2 === 0)
            .join("/"),
        ),
      ),
    ).toEqual(
      new Set([
        "historicalAggregates",
        "replications/aliases",
        "replications/memberships",
        "studyAliasIndex",
        "vocabularyTerms",
      ]),
    );
    const restricted = restrictedValues(recruitmentFixture());
    expect(restricted.length).toBeGreaterThan(120);
    expect(restricted).toContain("bea.contact@example.org");
    expect(restricted).toContain("Placeholder");
    expect(restricted).toContain(QUOTED_REPLY);
    expect(restricted).toContain(LITERATURE_POINTER);
    for (const documentPath of readable) {
      const text = JSON.stringify(after.get(documentPath)?.data);
      for (const value of restricted)
        expect(text, `${documentPath} holds a restricted value`).not.toContain(JSON.stringify(value).slice(1, -1));
      expect(text, documentPath).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]/);
    }
    // No identifier of a document holds a name or an address, in whatever case.
    const tokens = restricted.filter((value) => /^[A-Za-z]{5,}$/.test(value)).map((value) => value.toLowerCase());
    for (const documentPath of written) {
      expect(documentPath).not.toContain("@");
      const id = documentPath.toLowerCase();
      // A study identifier or a tab title may be part of a path. A name of a contact may not.
      for (const token of tokens) expect(id, `${documentPath} names ${token}`).not.toContain(token);
    }
    // An address is stored in restricted documents only, and in the index under a keyed hash.
    const holders = written.filter((documentPath) =>
      /@example\.org/.test(JSON.stringify(after.get(documentPath)?.data)),
    );
    // No item of the review queue holds one: whoever works the queue reads an address in its source record.
    expect(new Set(holders.map((documentPath) => documentPath.split("/")[0]))).toEqual(
      new Set(["sourceRecords", "outreachContacts", "persons", "importBatches"]),
    );
    expect(
      holders
        .filter((documentPath) => documentPath.startsWith("persons/"))
        .every((documentPath) => documentPath.endsWith("/private/contact")),
    ).toBe(true);
    // Of a batch, only the change log holds one: the states before and after, for those who may run an import.
    expect(
      holders
        .filter((documentPath) => documentPath.startsWith("importBatches/"))
        .every((documentPath) => /^importBatches\/[^/]+\/changes\/\d{6}$/.test(documentPath)),
    ).toBe(true);
    expect(holders.filter((documentPath) => !membersCanRead(documentPath, {}))).toEqual(holders);
    // The queue holds no address, not even the decoded candidates of the two reversed addresses.
    expect(holders.filter((documentPath) => documentPath.startsWith("reconciliationItems/"))).toEqual([]);
  });

  it("stores and prints counts, hashes and identifiers only: nothing personal reaches the batch, its log or the report", async () => {
    const restricted = restrictedValues(recruitmentFixture());
    const blocked = await run(
      recruitment,
      await workbookFile((fixture) => {
        outreach(fixture, "Luck1996").title = "Tia Struck";
      }),
      "apply",
    );
    const applied = await run(recruitment, await workbookFile(), "apply");
    for (const report of [blocked, applied]) {
      const batch = (await adminDb.doc(`importBatches/${report.batchId}`).get()).data();
      const log = await adminDb.collection(`importBatches/${report.batchId}/log`).get();
      const text = JSON.stringify([report, batch?.stats, batch?.inputFiles, log.docs.map((doc) => doc.data())]);
      for (const value of restricted) expect(text).not.toContain(JSON.stringify(value).slice(1, -1));
      expect(text).not.toMatch(/@example\.org|Tia Struck/);
    }
    // The statistics are keyed by the hash of a tab title, never by the title, a name or a cell.
    const stats = (await adminDb.doc(`importBatches/${applied.batchId}`).get()).data()?.stats as Record<string, number>;
    expect(
      Object.keys(stats)
        .filter((key) => key.startsWith("rows:"))
        .every((key) => /^rows:[0-9a-f]{20}:/.test(key)),
    ).toBe(true);
    expect(stats["created:outreachContacts"]).toBe(47);
    expect(stats["created:historicalAggregates"]).toBe(26);
  });

  it("prints nothing personal on the command line, in a preview, an apply, the state of a batch and a verification", async () => {
    const file = await workbookFile();
    const config = path.join(temporaryDirectory(), "sources.json");
    writeFileSync(config, JSON.stringify({ hashKey: TEST_HASH_KEY, sources: {} }));
    const common = ["f", "--input", file, "--observed-on", OBSERVED_ON, "--config", config];
    // The workbook is imported after the website data and the list of studies. Without the second the tool refuses.
    const early = cli(["run", ...common, "--mode", "preview"]);
    expect(early.status).toBe(2);
    expect(early.output).toMatch(/source f is imported after source d /);
    await recordApplied("d");
    const preview = cli(["run", ...common, "--mode", "preview"]);
    const apply = cli(["run", ...common, "--mode", "apply"]);
    expect(preview.status).toBe(0);
    expect(apply.status).toBe(0);
    const batch = /batch (run__[0-9A-Za-z_]+)/.exec(apply.output)?.[1] ?? "";
    const shown = cli(["show", batch, "--config", config]);
    // The verification compares the rows of each tab with the baseline that the configuration states.
    writeFileSync(
      config,
      JSON.stringify({ hashKey: TEST_HASH_KEY, sources: { f: { baseline: await baselineOf(batch) } } }),
    );
    const verified = cli(["verify", ...common]);
    expect(shown.status).toBe(0);
    expect(verified.status).toBe(0);
    expect(verified.output).toMatch(/passed {2}rowBaseline: \d+ counts of 23 tabs compared with the stated baseline, all equal/);
    expect(verified.output).toMatch(/passed {2}blankAndZero: \d+ blank cells are absent, 1 explicit zeros are stored as 0/);
    const output = [preview, apply, shown, verified].map((result) => result.output).join("\n");
    expect(output).toMatch(/outreachContacts/);
    for (const value of restrictedValues(recruitmentFixture())) expect(output).not.toContain(value);
    expect(output).not.toMatch(/@example\.org/);
    // The command line imported exactly what the tests above describe.
    expect((await documentsOf("outreachContacts")).size).toBe(47);
  });
});
