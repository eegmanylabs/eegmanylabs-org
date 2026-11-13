// What the publishing functions share (docs/INTEGRATIONS.md, section 6): the reading of the
// portal's records through the allow-list, the files of a batch, the hash of an export, and the
// text of a pull request.
//
// The reader of records reads directory documents alone: persons, replications, laboratories,
// participations, manuscripts and the recruitment summaries of replications. It never reads a
// `private` or `special` document, a custom-values document, contact details, notes or anything
// about a participant, and each record is projected onto its public fields before it is passed
// on, so a field that the allow-list does not name cannot reach a file.
import {
  COLLECTIONS,
  type PublicationBatchDoc,
  type PublicationFileDoc,
  type PublicInputs,
  parseStoredDocument,
  publicationBatchDocSchema,
  publicationFileDocSchema,
  publicProjection,
  WEBSITE_FILES,
  type WebsiteFileKey,
} from "@eegml/shared";
import type { DocumentReference, Firestore, Transaction } from "firebase-admin/firestore";
import { AppError } from "../framework";
import { GitHubError } from "../integrations/github/types";

/** The most records of one kind the reader reads. */
const READ_LIMIT = 5_000;

/** Reads the public projections of the records an export may draw on. */
export async function readPublicInputs(db: Firestore): Promise<PublicInputs> {
  const all = async (path: string) => (await db.collection(path).limit(READ_LIMIT).get()).docs;
  const [persons, replications, laboratories, participations, manuscripts, summaries] = await Promise.all([
    all(COLLECTIONS.persons.collectionPath()),
    all(COLLECTIONS.replications.collectionPath()),
    all(COLLECTIONS.laboratories.collectionPath()),
    all(COLLECTIONS.participations.collectionPath()),
    all(COLLECTIONS.manuscripts.collectionPath()),
    db
      .collectionGroup(COLLECTIONS.replicationSummaries.collectionId)
      .limit(READ_LIMIT)
      .get()
      .then((found) => found.docs),
  ]);
  return {
    persons: persons.map((document) => publicProjection("person", document.id, document.data())),
    replications: replications.map((document) => publicProjection("replication", document.id, document.data())),
    laboratories: laboratories.map((document) => publicProjection("laboratory", document.id, document.data())),
    participations: participations.map((document) => publicProjection("participation", document.id, document.data())),
    manuscripts: manuscripts.map((document) => publicProjection("manuscript", document.id, document.data())),
    summaries: summaries.map((document) =>
      publicProjection("summary", `${document.get("replicationId") ?? document.id}__${document.id}`, document.data()),
    ),
  };
}

export interface StoredBatch {
  readonly id: string;
  readonly reference: DocumentReference;
  readonly data: PublicationBatchDoc;
}

/** Reads a batch, in a transaction where one is given. */
export async function readBatch(db: Firestore, batchId: string, transaction?: Transaction): Promise<StoredBatch> {
  const reference = db.doc(COLLECTIONS.publicationBatches.docPath(batchId));
  const snapshot = transaction === undefined ? await reference.get() : await transaction.get(reference);
  if (!snapshot.exists) throw new AppError("not-found", "This export does not exist.");
  const parsed = parseStoredDocument(publicationBatchDocSchema, snapshot.data());
  if (!parsed.success) throw new Error("A stored export does not fit its schema.");
  return { id: batchId, reference, data: parsed.data };
}

/** Reads the files of a batch. */
export async function readBatchFiles(db: Firestore, batchId: string): Promise<PublicationFileDoc[]> {
  const found = await db.collection(COLLECTIONS.publicationFiles.collectionPath(batchId)).get();
  return found.docs.flatMap((document) => {
    const parsed = parseStoredDocument(publicationFileDocSchema, document.data());
    return parsed.success ? [parsed.data] : [];
  });
}

const PAGES: Readonly<Record<WebsiteFileKey, string>> = {
  replications: "/replications/",
  publications: "/publications/",
  people: "/people/",
  members: "/members/",
  laboratories: "/assets/data/laboratories.tsv",
  milestones: "/assets/data/milestones.tsv",
  recruitment: "/assets/data/recruitment.tsv",
};

/** The description of the pull request of an export, as the README asks of every change. */
export function pullRequestBody(batch: StoredBatch, files: readonly PublicationFileDoc[], portalUrl: string): string {
  const changed = files.filter((file) => file.diff.bytesChanged);
  return [
    "## Purpose",
    "",
    `A publication from the #EEGManyLabs members' portal, export ${batch.id}: ${batch.data.outputs.join(", ")}.`,
    ...(batch.data.syntheticData
      ? ["", "**This export was made from synthetic demonstration data in the emulator. It must never be merged.**"]
      : []),
    "",
    "## Files changed",
    "",
    ...changed.map(
      (file) =>
        `- \`${file.path}\`${file.diff.created ? " (new)" : ""}: ${file.diff.counts.added} added, ${file.diff.counts.changed} changed and ${file.diff.counts.removed} removed rows`,
    ),
    "",
    "## Data implications",
    "",
    "Only fields on the portal's allow-list of public fields are written. Contact details, demographics, private notes, credentials and participant data are never read by the generator, and a check refused the export had anything shaped like an email address appeared in it.",
    `The site was built from these files in a scratch copy with \`${batch.data.verification?.buildCommand ?? "the site's build command"}\` before approval.`,
    "",
    "## Pages to test on the staging site",
    "",
    ...changed.map((file) => `- ${PAGES[file.fileKey as WebsiteFileKey] ?? file.path}`),
    "",
    `Review the export in the portal: ${portalUrl}#/admin/publishing/${batch.id}`,
  ].join("\n");
}

/** The paths of the files of every key, in the order of the keys. */
export const FILE_PATHS = Object.fromEntries(
  Object.entries(WEBSITE_FILES).map(([key, spec]) => [key, spec.path]),
) as Readonly<Record<WebsiteFileKey, string>>;

/** A failure of the website adapter as a person reads it. */
export function gitHubFailure(error: unknown): AppError {
  if (!(error instanceof GitHubError)) throw error;
  switch (error.kind) {
    case "staleBase":
      return new AppError(
        "failed-precondition",
        "The website changed while the change was being written. Nothing was overwritten; prepare a new export.",
      );
    case "accessLost":
      return new AppError(
        "failed-precondition",
        "GitHub refused the portal's credential. Nothing was published; an administrator needs to renew the credential.",
      );
    case "rateLimited":
      return new AppError(
        "resource-exhausted",
        `GitHub asked the portal to wait${error.retryAfterSeconds === null ? "" : ` ${error.retryAfterSeconds} seconds`}. Nothing was published; try again then.`,
      );
    case "conflict":
      return new AppError("already-exists", "A branch of this export exists already on GitHub.");
    case "notFound":
      return new AppError("not-found", "GitHub has no such branch, file or pull request.");
    case "unavailable":
      return new AppError(
        "failed-precondition",
        "GitHub could not be reached. Nothing was published; try again later.",
      );
  }
}
