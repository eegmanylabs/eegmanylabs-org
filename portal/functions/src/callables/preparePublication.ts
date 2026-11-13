import {
  COLLECTIONS,
  diffWebsiteFile,
  generateWebsiteFiles,
  PUBLIC_OUTPUTS,
  PUBLICATION_DIFF_ROWS_MAX,
  preparePublicationContract,
  privacyFindings,
  publicationBatchDocSchema,
  publicationFileDocSchema,
  publicationPayloadSha256,
  sha256Hex,
  WEBSITE_FILES,
  type WebsiteFileKey,
} from "@eegml/shared";
import { Timestamp } from "firebase-admin/firestore";
import {
  AppError,
  callerStamp,
  createdFields,
  defineCallable,
  readAccessDocument,
  requireCapability,
  runningInEmulator,
  writeAudit,
} from "../framework";
import { PUBLISHING_NOT_CONFIGURED_MESSAGE, websiteRepository } from "../integrations/github/adapters";
import { MAIN_BRANCH } from "../integrations/github/types";
import { alertIntegrationFailure } from "../notifications/alerts";
import { gitHubFailure, readPublicInputs } from "../publishing/model";

/**
 * Prepares a public export and its preview (requirements R14.1 to R14.4). Capability:
 * `publishing.prepare` for the programme. It reads the website's files on the main branch
 * through the website adapter, which reads and never writes here, assembles the approved public
 * fields of the outputs asked for into files in the website's own formats, and stores each file
 * with its difference from the main branch, row by row and field by field. Nothing leaves the
 * portal. A file in which anything shaped like an email address appears fails the export, which
 * is recorded with the reason and offered for nothing further. Demonstration records are
 * published only from the emulator, and the export says so wherever it is shown.
 */
export const preparePublication = defineCallable(preparePublicationContract, {
  handler: async (input, context) => {
    const { db, uid } = context;
    const at = context.clock.now();
    const access = await readAccessDocument(db, uid);
    requireCapability(context, access, "publishing.prepare", "programme");
    const repository = websiteRepository();
    if (repository === null) throw new AppError("failed-precondition", PUBLISHING_NOT_CONFIGURED_MESSAGE);

    const keys = [...new Set(input.outputs.flatMap((output) => PUBLIC_OUTPUTS[output]))] as WebsiteFileKey[];
    let baseCommit: string;
    const base: Partial<Record<WebsiteFileKey, string>> = {};
    const baseOrNull: Partial<Record<WebsiteFileKey, string | null>> = {};
    try {
      baseCommit = await repository.branchHead(MAIN_BRANCH);
      for (const key of keys) {
        const text = await repository.readFile(WEBSITE_FILES[key].path, baseCommit);
        baseOrNull[key] = text;
        if (text !== null) base[key] = text;
        else if (WEBSITE_FILES[key].existing) {
          throw new AppError(
            "failed-precondition",
            `The website has no ${WEBSITE_FILES[key].path} on its main branch.`,
          );
        }
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
      await alertIntegrationFailure(db, "github", at);
      throw gitHubFailure(error);
    }

    const syntheticData = runningInEmulator();
    const generated = generateWebsiteFiles(base, await readPublicInputs(db), {
      outputs: input.outputs,
      origins: syntheticData ? ["live", "importedHistorical", "demo"] : ["live", "importedHistorical"],
    });
    const files = keys.flatMap((key) => {
      const content = generated.files[key];
      return content === undefined ? [] : [{ key, path: WEBSITE_FILES[key].path, content }];
    });
    const findings = privacyFindings(Object.fromEntries(files.map((file) => [file.path, file.content])));
    const diffs = new Map(
      files.map((file) => [
        file.key,
        diffWebsiteFile(baseOrNull[file.key] ?? null, file.content, WEBSITE_FILES[file.key].key),
      ]),
    );
    const filesChanged = [...diffs.values()].filter((diff) => diff.bytesChanged).length;

    const batchReference = db.collection(COLLECTIONS.publicationBatches.collectionPath()).doc();
    const batch = db.batch();
    const auditEventId = writeAudit(
      batch,
      {
        action: "publication.prepared",
        actor: { kind: "user", uid },
        entityType: "publicationBatch",
        entityId: batchReference.id,
        changes: [
          { field: "outputs", after: [...input.outputs] },
          { field: "filesChanged", after: filesChanged },
          { field: "privacyFindings", after: findings.length },
        ],
        at,
      },
      db,
    );
    const stamp = callerStamp(uid, at, auditEventId);
    const failed = findings.length > 0;
    batch.create(
      batchReference,
      publicationBatchDocSchema.parse({
        ...createdFields("publicationBatches", stamp),
        kind: "website",
        outputs: [...input.outputs],
        syntheticData,
        baseCommit,
        payloadSha256: publicationPayloadSha256(files),
        diffSummary: Object.fromEntries(
          [...diffs.entries()].map(([key, diff]) => [
            key,
            { added: diff.counts.added, removed: diff.counts.removed, changed: diff.counts.changed },
          ]),
        ),
        notes: generated.notes.slice(0, 200).map((note) => note.slice(0, 500)),
        status: failed ? "failed" : "previewed",
        ...(failed
          ? {
              statusReason: `The privacy check found ${findings.length} ${findings.length === 1 ? "line" : "lines"} with text shaped like an email address (${[...new Set(findings.map((finding) => `${finding.path} line ${finding.line}`))].slice(0, 10).join(", ")}). Nothing was published.`,
            }
          : {}),
        requestedBy: uid,
        requestedAt: Timestamp.fromDate(at),
        verification: null,
        approvedBy: null,
        approvedAt: null,
        publishedAt: null,
        rolledBackBy: null,
        rolledBackAt: null,
      }),
    );
    for (const file of files) {
      const diff = diffs.get(file.key);
      if (diff === undefined) continue;
      const baseContent = baseOrNull[file.key] ?? null;
      batch.create(
        db.doc(COLLECTIONS.publicationFiles.docPath(batchReference.id, file.key)),
        publicationFileDocSchema.parse({
          ...createdFields("publicationFiles", stamp),
          batchId: batchReference.id,
          fileKey: file.key,
          path: file.path,
          content: file.content,
          sha256: sha256Hex(file.content),
          baseContent,
          baseSha256: baseContent === null ? null : sha256Hex(baseContent),
          diff: {
            created: diff.created,
            bytesChanged: diff.bytesChanged,
            columnsChanged: diff.columnsChanged,
            counts: diff.counts,
            rows: diff.rows.slice(0, PUBLICATION_DIFF_ROWS_MAX).map((row) => ({
              key: row.key.slice(0, 500),
              kind: row.kind,
              fields: row.fields.slice(0, 50).map((field) => ({
                column: field.column.slice(0, 100),
                before: field.before.slice(0, 10_000),
                after: field.after.slice(0, 10_000),
              })),
            })),
            rowsOmitted: Math.max(0, diff.rows.length - PUBLICATION_DIFF_ROWS_MAX),
          },
        }),
      );
    }
    await batch.commit();
    if (failed) {
      throw new AppError(
        "failed-precondition",
        "The export was refused: text shaped like an email address appeared in a generated file. It is kept in the publishing log with the lines concerned, and nothing was published.",
      );
    }
    return { batchId: batchReference.id, filesChanged };
  },
});
