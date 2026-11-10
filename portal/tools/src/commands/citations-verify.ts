// citations:verify looks up the DOI of every cited work at Crossref and records whether the
// stored reference agrees with what the registry holds.
//
//   citations:verify [--dry-run] [--api <address>]
//
// | What is checked                 | DOI           | Compared with the registry                        |
// |---------------------------------|---------------|---------------------------------------------------|
// | The original study of a replication | `originalDoi` | `originalTitle`, `originalYear`, `originalAuthors` |
// | A manuscript of the programme   | `doi`         | `title`, the year of `publishedAt`, `authorsShort` |
//
// | Result of the look-up                                   | Status written                      |
// |---------------------------------------------------------|-------------------------------------|
// | Title, year and first author all agree                  | `verified`                          |
// | One of them differs                                     | `mismatch`                          |
// | No registry holds the DOI                               | `notFound`                          |
// | Another agency registered the DOI, such as DataCite     | stays `unverified`, with the name of the agency |
// | Nothing differs, and a field could not be compared      | stays `unverified`, with what was retrieved |
// | The registry could not be asked                         | nothing is written                  |
//
// The command writes the status and the retrieved metadata, and never a field of the reference
// itself: a mismatch is for a person to settle. A request names the DOI and carries no address,
// no name and no credential. Everything printed is a count, a field name or a document path.
import { isDeepStrictEqual } from "node:util";
import { COLLECTIONS, systemActor, systemWriteContext } from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { connectToEmulators } from "../admin";
import {
  type CitationComparison,
  compareCitation,
  type StoredReference,
  statusOfComparison,
} from "../citations/compare";
import { CROSSREF_SOURCE, type CrossrefAnswer, lookUpDoi, worksAddress } from "../citations/crossref";
import type { Command } from "../command";
import { requireEmulatorTarget, requireRunningEmulators, ToolRefusal } from "../environment";
import { entryOf, validated } from "../import/context";

/** The actor recorded on everything this command writes. */
export const CITATION_CHECK_ACTOR = systemActor("citationCheck");

const EXIT_INCOMPLETE = 3;
/** The registry asks for no more than five requests a second from one client, one at a time. */
const PAUSE_MS = 250;

type CitedCollection = "replications" | "manuscripts";
type CitationStatus = "unverified" | "verified" | "mismatch" | "notFound";

export interface CitationCounts {
  /** Documents that state a DOI. */
  withDoi: number;
  withoutDoi: number;
  verified: number;
  mismatch: number;
  notFound: number;
  /** Looked up, nothing differs, and a field could not be compared: the citation stays unverified. */
  incomplete: number;
  /** The DOI is registered with another agency, which holds its metadata: the citation stays unverified. */
  otherAgency: number;
  /** The registry could not be asked. Nothing is written and the citation stays as it was. */
  notChecked: number;
  written: number;
  unchanged: number;
}

export interface CitationReport {
  readonly counts: Readonly<Record<CitedCollection, CitationCounts>>;
  /** The documents whose reference differs from the registry, each with the fields that differ. */
  readonly mismatches: readonly { readonly path: string; readonly fields: readonly string[] }[];
  readonly notFound: readonly string[];
  /** The documents whose DOI another agency registered. */
  readonly otherAgency: readonly string[];
  /** The number of requests sent. One DOI is asked once, however many documents cite it. */
  readonly requests: number;
}

export interface VerifyCitationsOptions {
  /** Looks up one DOI. The default asks Crossref. */
  readonly lookUp?: (doi: string) => Promise<CrossrefAnswer>;
  /** True to compare and report without writing. */
  readonly dryRun?: boolean;
  /** The pause between two requests. */
  readonly pauseMs?: number;
  readonly now?: Date;
}

interface Cited {
  readonly collection: CitedCollection;
  readonly path: string;
  readonly data: Record<string, unknown>;
  readonly doi: string | null;
  readonly stored: StoredReference;
}

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

function citedOf(collection: CitedCollection, path: string, data: Record<string, unknown>): Cited {
  if (collection === "replications") {
    const year = data.originalYear;
    const title = stringOf(data.originalTitle);
    const authors = stringOf(data.originalAuthors);
    return {
      collection,
      path,
      data,
      doi: stringOf(data.originalDoi) ?? null,
      stored: {
        ...(title === undefined ? {} : { title }),
        ...(typeof year === "number" ? { year } : {}),
        ...(authors === undefined ? {} : { authors }),
      },
    };
  }
  const published = data.publishedAt instanceof Timestamp ? data.publishedAt.toDate().getUTCFullYear() : undefined;
  const title = stringOf(data.title);
  const authors = stringOf(data.authorsShort);
  return {
    collection,
    path,
    data,
    doi: stringOf(data.doi) ?? null,
    stored: {
      ...(title === undefined ? {} : { title }),
      ...(published === undefined ? {} : { year: published }),
      ...(authors === undefined ? {} : { authors }),
    },
  };
}

/** What the check found, as a record keeps it: the retrieved fields that hold a value, and the comparison. */
function metadataOf(answer: CrossrefAnswer & { status: "found" }, comparison: CitationComparison) {
  const { work } = answer;
  return {
    doi: work.doi,
    ...(work.title === null ? {} : { title: work.title }),
    ...(work.subtitle === null ? {} : { subtitle: work.subtitle }),
    years: [...work.years],
    ...(work.firstAuthorFamily === null ? {} : { firstAuthorFamily: work.firstAuthorFamily }),
    ...(work.firstAuthorGiven === null ? {} : { firstAuthorGiven: work.firstAuthorGiven }),
    ...(work.containerTitle === null ? {} : { containerTitle: work.containerTitle }),
    ...(work.type === null ? {} : { type: work.type }),
    comparison: { ...comparison },
  };
}

const emptyCounts = (): CitationCounts => ({
  withDoi: 0,
  withoutDoi: 0,
  verified: 0,
  mismatch: 0,
  notFound: 0,
  incomplete: 0,
  otherAgency: 0,
  notChecked: 0,
  written: 0,
  unchanged: 0,
});

/**
 * Checks every citation that states a DOI. A second run on unchanged data writes nothing: a
 * record is written only when its status or what the registry returned has changed.
 */
export async function verifyCitations(db: Firestore, options: VerifyCitationsOptions = {}): Promise<CitationReport> {
  const lookUp = options.lookUp ?? ((doi: string) => lookUpDoi(doi));
  const now = Timestamp.fromDate(options.now ?? new Date());
  const pauseMs = options.pauseMs ?? PAUSE_MS;
  const counts = { replications: emptyCounts(), manuscripts: emptyCounts() };
  const mismatches: { path: string; fields: string[] }[] = [];
  const notFound: string[] = [];
  const elsewhere: string[] = [];
  const answers = new Map<string, CrossrefAnswer>();

  const cited: Cited[] = [];
  for (const collection of ["replications", "manuscripts"] as const) {
    const stored = await db.collection(COLLECTIONS[collection].collectionPath()).get();
    for (const doc of stored.docs) cited.push(citedOf(collection, doc.ref.path, doc.data()));
  }
  cited.sort((a, b) => (a.path < b.path ? -1 : 1));

  for (const entry of cited) {
    const tally = counts[entry.collection];
    if (entry.doi === null) {
      tally.withoutDoi += 1;
      continue;
    }
    tally.withDoi += 1;
    const key = entry.doi.trim().toLowerCase();
    let answer = answers.get(key);
    if (answer === undefined) {
      if (answers.size > 0 && pauseMs > 0) await new Promise((resolve) => setTimeout(resolve, pauseMs));
      answer = await lookUp(entry.doi.trim());
      answers.set(key, answer);
    }
    if (answer.status === "unavailable") {
      tally.notChecked += 1;
      continue;
    }

    let status: CitationStatus;
    let metadata: Record<string, unknown>;
    if (answer.status === "notFound") {
      status = "notFound";
      metadata = { doi: entry.doi.trim() };
      tally.notFound += 1;
      notFound.push(entry.path);
    } else if (answer.status === "otherAgency") {
      status = "unverified";
      metadata = { doi: entry.doi.trim(), registrationAgency: answer.agency };
      tally.otherAgency += 1;
      elsewhere.push(entry.path);
    } else {
      const comparison = compareCitation(entry.stored, answer.work);
      status = statusOfComparison(comparison);
      metadata = metadataOf(answer, comparison);
      if (status === "verified") tally.verified += 1;
      else if (status === "unverified") tally.incomplete += 1;
      else {
        tally.mismatch += 1;
        mismatches.push({
          path: entry.path,
          fields: Object.entries(comparison).flatMap(([field, result]) => (result === "differs" ? [field] : [])),
        });
      }
    }

    // A manuscript has no fields of its own for the source and the time of the check, so its metadata names them.
    const previous = (entry.data.citationMetadata as Record<string, unknown> | undefined) ?? {};
    const { source: _source, checkedAt: _checkedAt, ...previousFound } = previous;
    const same =
      entry.data.citationStatus === status &&
      isDeepStrictEqual(entry.collection === "manuscripts" ? previousFound : previous, metadata);
    if (same) {
      tally.unchanged += 1;
      continue;
    }
    const patch =
      entry.collection === "replications"
        ? {
            citationStatus: status,
            citationCheckedAt: now,
            citationSource: CROSSREF_SOURCE,
            citationMetadata: metadata,
          }
        : {
            citationStatus: status,
            citationMetadata: { ...metadata, source: CROSSREF_SOURCE, checkedAt: now.toDate().toISOString() },
          };
    const standard = { updatedAt: now, updatedBy: CITATION_CHECK_ACTOR, writeContext: systemWriteContext() };
    validated(entryOf(entry.collection), entry.path, { ...entry.data, ...patch, ...standard });
    if (options.dryRun !== true) await db.doc(entry.path).update({ ...patch, ...standard });
    tally.written += 1;
  }
  return { counts, mismatches, notFound, otherAgency: elsewhere, requests: answers.size };
}

export const citationsVerifyCommand: Command = {
  name: "citations:verify",
  summary: "Look up the DOI of every cited work at Crossref and record whether the stored reference agrees.",
  async run(args) {
    let dryRun = false;
    let apiBase: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const argument = args[index];
      if (argument === "--dry-run") dryRun = true;
      else if (argument === "--api" && args[index + 1] !== undefined) {
        apiBase = args[index + 1];
        index += 1;
      } else throw new ToolRefusal("Usage: citations:verify [--dry-run] [--api <address>]");
    }
    // Refuses a registry address that would not travel encrypted, before anything is read.
    worksAddress(apiBase);
    const target = requireEmulatorTarget();
    await requireRunningEmulators(target, process.env, 1_000, ["firestore"]);
    const report = await verifyCitations(connectToEmulators(target).db, {
      dryRun,
      lookUp: (doi) => lookUpDoi(doi, apiBase === undefined ? {} : { apiBase }),
    });
    console.log(
      `citations:verify against ${target.projectId} (emulator)${dryRun ? ", dry run" : ""}: ${report.requests} DOIs asked at ${CROSSREF_SOURCE}.`,
    );
    for (const [collection, tally] of Object.entries(report.counts)) {
      console.log(
        `  ${collection}: ${tally.withDoi} with a DOI, ${tally.withoutDoi} without. ` +
          `${tally.verified} verified, ${tally.mismatch} mismatch, ${tally.notFound} not found, ` +
          `${tally.incomplete} left unverified because a field could not be compared, ` +
          `${tally.otherAgency} left unverified because another agency registered the DOI, ${tally.notChecked} not checked. ` +
          `${tally.written} ${dryRun ? "would be written" : "written"}, ${tally.unchanged} unchanged.`,
      );
    }
    for (const mismatch of report.mismatches) {
      console.log(`  Differs from the registry in ${mismatch.fields.join(", ")}: ${mismatch.path}`);
    }
    for (const path of report.notFound) console.log(`  No work under its DOI: ${path}`);
    for (const path of report.otherAgency) {
      console.log(`  Registered with another agency than ${CROSSREF_SOURCE}: ${path}`);
    }
    const notChecked = Object.values(report.counts).reduce((sum, tally) => sum + tally.notChecked, 0);
    if (notChecked === 0) return undefined;
    console.log(`${notChecked} citations could not be checked and stay as they were. Run the command again.`);
    return EXIT_INCOMPLETE;
  },
};
