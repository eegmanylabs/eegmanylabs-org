// Generated Google Docs (docs/INTEGRATIONS.md, section 3.5). A document is copied once from its
// template into a folder of a shared drive, its section tags are replaced by generated text
// anchored by named ranges, and later runs rewrite a section only while it still holds exactly
// the text last generated. Text outside the sections is never addressed: every request names a
// range or a tag. A hand edit stops the section and becomes a conflict for a person.
import {
  type Canonical,
  COLLECTIONS,
  canonicalFromApp,
  DOCUMENT_TEMPLATES,
  type DocumentTemplateDoc,
  documentTemplateDocSchema,
  type GeneratedDocumentDoc,
  generatedDocumentDocSchema,
  laboratoryDocSchema,
  laboratoryEquipmentDocSchema,
  type ManagedSection,
  MEMBERS_SCOPE_KEY,
  normaliseText,
  type ObservedSection,
  type PageDoc,
  PROGRAMME_KEY,
  type Provenance,
  pageDocSchema,
  parseStoredDocument,
  participationDocSchema,
  planSection,
  type RECRUITMENT_MODALITIES,
  renderSections,
  replicationDocSchema,
  replicationScopeKey,
  resolvedValue,
  resolveParticipation,
  type SectionPlan,
  type SyncPlanEntry,
  sectionRangeName,
  sectionTag,
  sectionTextHash,
  statusDefinitionId,
  systemWriteContext,
  type TaskListDoc,
  type TemplateData,
  taskDocSchema,
  taskListDocSchema,
} from "@eegml/shared";
import { type Firestore, Timestamp } from "firebase-admin/firestore";
import { reportFactOf } from "../../recruitment/reports";
import { retrying } from "../google/retry";
import { type DocsAdapter, type DocsDocument, type DocsRequest, ExternalServiceError } from "../google/types";
import { type JobDependencies, JobFailure, type JobOutcome, SYNC_ACTOR } from "./context";
import type { ClaimedRun } from "./queue";
import { upsertConflict } from "./records";
import { failureOf } from "./sheet-sync";

/** How often a batch planned against a revision that moved on is planned again. */
const STALE_REVISION_ATTEMPTS = 3;

/** A coded value in words: `collectionComplete` becomes "Collection complete". */
function words(code: string): string {
  const spaced = code.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

async function statusLabel(db: Firestore, key: string | null): Promise<string | null> {
  if (key === null) return null;
  const definition = await db.doc(COLLECTIONS.statusDefinitions.docPath(statusDefinitionId("replication", key))).get();
  const label: unknown = definition.get("label");
  return typeof label === "string" ? label : words(key);
}

async function laboratoryNames(db: Firestore): Promise<Map<string, string>> {
  const snapshot = await db.collection(COLLECTIONS.laboratories.collectionPath()).get();
  return new Map(snapshot.docs.map((document) => [document.id, String(document.get("name") ?? document.id)]));
}

async function participationsOf(db: Firestore, field: "replicationId" | "laboratoryId", id: string) {
  const snapshot = await db.collection(COLLECTIONS.participations.collectionPath()).where(field, "==", id).get();
  return snapshot.docs.flatMap((document) => {
    const parsed = parseStoredDocument(participationDocSchema, document.data());
    return parsed.success && parsed.data.archivedAt === null ? [{ id: document.id, ...parsed.data }] : [];
  });
}

/** The data of a template, read from the records it describes, and the kinds of record it was drawn from. */
export async function templateData(
  db: Firestore,
  template: Pick<DocumentTemplateDoc, "kind">,
  entityId: string,
  reportDate: string,
): Promise<{ readonly data: TemplateData; readonly sources: readonly string[]; readonly title: string }> {
  switch (template.kind) {
    case "programmeProgress": {
      const [replications, participations] = await Promise.all([
        db.collection(COLLECTIONS.replications.collectionPath()).get(),
        db.collection(COLLECTIONS.participations.collectionPath()).get(),
      ]);
      const sites = new Map<string, number>();
      for (const document of participations.docs) {
        if (document.get("archivedAt") != null) continue;
        const replicationId = String(document.get("replicationId"));
        sites.set(replicationId, (sites.get(replicationId) ?? 0) + 1);
      }
      const rows = [];
      for (const document of replications.docs) {
        const parsed = parseStoredDocument(replicationDocSchema, document.data());
        if (!parsed.success || parsed.data.archivedAt !== null) continue;
        rows.push({
          studyKey: document.id,
          title: parsed.data.shortTitle ?? null,
          status: await statusLabel(db, parsed.data.statusKey),
          laboratories: sites.get(document.id) ?? 0,
        });
      }
      rows.sort((a, b) => a.studyKey.localeCompare(b.studyKey));
      return {
        data: { kind: "programmeProgress", replications: rows },
        sources: ["replications", "participations"],
        title: `Programme progress, ${reportDate}`,
      };
    }
    case "replicationProgress":
    case "recruitment":
    case "meetings":
    case "milestones": {
      const parsed = parseStoredDocument(
        replicationDocSchema,
        (await db.doc(COLLECTIONS.replications.docPath(entityId)).get()).data(),
      );
      if (!parsed.success) throw new JobFailure("guard", false, "The replication of this document no longer exists.");
      const replication = parsed.data;
      if (template.kind === "replicationProgress") {
        const [participations, names] = await Promise.all([
          participationsOf(db, "replicationId", entityId),
          laboratoryNames(db),
        ]);
        return {
          data: {
            kind: "replicationProgress",
            studyKey: entityId,
            title: replication.shortTitle ?? null,
            status: await statusLabel(db, replication.statusKey),
            publicStage: replication.publicStageName ?? null,
            participations: participations
              .map((participation) => ({
                laboratory: names.get(participation.laboratoryId) ?? participation.laboratoryId,
                status: words(participation.status),
              }))
              .sort((a, b) => a.laboratory.localeCompare(b.laboratory)),
          },
          sources: ["the replication", "its participations"],
          title: `${entityId} progress, ${reportDate}`,
        };
      }
      if (template.kind === "recruitment") {
        const [participations, names, reports] = await Promise.all([
          participationsOf(db, "replicationId", entityId),
          laboratoryNames(db),
          db.collection(COLLECTIONS.recruitmentReports.collectionPath()).where("replicationId", "==", entityId).get(),
        ]);
        const facts = reports.docs
          .map((document) => reportFactOf(document.id, document.data()))
          .filter((fact) => fact !== null);
        const figure = (
          state: ReturnType<typeof resolveParticipation>,
          modality: (typeof RECRUITMENT_MODALITIES)[number],
        ) => ({
          reported: resolvedValue(state.reported, modality, "tested")?.value ?? null,
          verified: resolvedValue(state.verified, modality, "tested")?.value ?? null,
        });
        const sites = participations
          .map((participation) => {
            const state = resolveParticipation(participation.id, facts, { date: reportDate });
            return {
              laboratory: names.get(participation.laboratoryId) ?? participation.laboratoryId,
              main: figure(state, "main"),
              rest: figure(state, "rest"),
              participants: figure(state, "participants"),
            };
          })
          .sort((a, b) => a.laboratory.localeCompare(b.laboratory));
        return {
          data: { kind: "recruitment", asOfDate: reportDate, category: "Tested", sites },
          sources: ["recruitment reports, resolved per participation"],
          title: `${entityId} recruitment, ${reportDate}`,
        };
      }
      if (template.kind === "meetings") {
        const pages = await db
          .collection(COLLECTIONS.pages.collectionPath())
          .where("replicationId", "==", entityId)
          .get();
        const meetings = meetingsInAudience(
          entityId,
          pages.docs.flatMap((document) => {
            const page = parseStoredDocument(pageDocSchema, document.data());
            return page.success ? [{ id: document.id, page: page.data }] : [];
          }),
        );
        return {
          data: { kind: "meetings", meetings },
          sources: ["meeting pages"],
          title: `${entityId} meetings, ${reportDate}`,
        };
      }
      // Only the milestones of the replication's own task lists: never a personal list, nor a
      // list of a laboratory or a group that only happens to name the replication.
      const [tasks, lists] = await Promise.all([
        db.collection(COLLECTIONS.tasks.collectionPath()).where("replicationId", "==", entityId).get(),
        db.collection(COLLECTIONS.taskLists.collectionPath()).where("scopeId", "==", entityId).get(),
      ]);
      const replicationLists = replicationListIds(
        entityId,
        lists.docs.flatMap((document) => {
          const list = parseStoredDocument(taskListDocSchema, document.data());
          return list.success ? [{ id: document.id, list: list.data }] : [];
        }),
      );
      const milestones = tasks.docs.flatMap((document) => {
        const task = parseStoredDocument(taskDocSchema, document.data());
        if (
          !task.success ||
          task.data.kind !== "milestone" ||
          task.data.archivedAt !== null ||
          !replicationLists.has(task.data.listId)
        )
          return [];
        return [
          {
            title: task.data.title,
            dueDate: task.data.dueAt === undefined ? null : isoDate(task.data.dueAt.toDate()),
            status: words(task.data.statusKey),
          },
        ];
      });
      return {
        data: { kind: "milestones", milestones },
        sources: ["milestone tasks"],
        title: `${entityId} milestones, ${reportDate}`,
      };
    }
    case "laboratoryProgress": {
      const parsed = parseStoredDocument(
        laboratoryDocSchema,
        (await db.doc(COLLECTIONS.laboratories.docPath(entityId)).get()).data(),
      );
      if (!parsed.success) throw new JobFailure("guard", false, "The laboratory of this document no longer exists.");
      const [participations, equipment] = await Promise.all([
        participationsOf(db, "laboratoryId", entityId),
        db.collection(COLLECTIONS.laboratoryEquipment.collectionPath(entityId)).where("isCurrent", "==", true).get(),
      ]);
      return {
        data: {
          kind: "laboratoryProgress",
          name: parsed.data.name,
          description: parsed.data.description ?? null,
          participations: participations
            .map((participation) => ({ replication: participation.replicationId, status: words(participation.status) }))
            .sort((a, b) => a.replication.localeCompare(b.replication)),
          equipment: equipment.docs
            .flatMap((document) => {
              const configuration = parseStoredDocument(laboratoryEquipmentDocSchema, document.data());
              return configuration.success
                ? [
                    {
                      name: configuration.data.name,
                      channelCount: configuration.data.channelCount ?? null,
                      samplingRatesHz: configuration.data.samplingRatesHz ?? [],
                    },
                  ]
                : [];
            })
            .sort((a, b) => a.name.localeCompare(b.name)),
        },
        sources: ["the laboratory", "its participations", "its current equipment"],
        title: `${parsed.data.name} progress, ${reportDate}`,
      };
    }
  }
}

/** The address in the portal of the record a document describes. */
export function portalPath(entityType: GeneratedDocumentDoc["entityType"], entityId: string): string {
  if (entityType === "replication") return `#/replications/${entityId}`;
  if (entityType === "laboratory") return `#/labs/${entityId}`;
  return entityId === PROGRAMME_KEY ? "#/dashboards" : "#/";
}

/** What a read of the document shows of one section. */
export function observe(
  document: DocsDocument,
  name: string,
): ObservedSection & { readonly rangeId: string | null; readonly start: number } {
  const range = document.namedRanges.find((candidate) => candidate.name === sectionRangeName(name));
  if (range === undefined || range.ranges.length === 0) {
    return { found: false, pieces: 0, text: null, overlapsSuggestion: false, rangeId: null, start: 0 };
  }
  const pieces = [...range.ranges].sort((a, b) => a.startIndex - b.startIndex);
  const text = pieces.map((piece) => document.body.slice(piece.startIndex - 1, piece.endIndex - 1)).join("");
  const overlapsSuggestion = document.suggestions.some((suggestion) =>
    pieces.some((piece) => suggestion.startIndex < piece.endIndex && piece.startIndex < suggestion.endIndex),
  );
  return {
    found: true,
    pieces: pieces.length,
    text,
    overlapsSuggestion,
    rangeId: range.namedRangeId,
    start: pieces[0]?.startIndex ?? 0,
  };
}

interface Planned {
  readonly name: string;
  readonly plan: SectionPlan;
  readonly start: number;
  readonly rangeId: string | null;
  readonly designatedBase: Canonical | undefined;
}

/** The requests of one batch: each section from the end of the document towards its start, so earlier indexes stay valid. */
export function sectionRequests(document: DocsDocument, planned: readonly Planned[]): DocsRequest[] {
  const requests: DocsRequest[] = [];
  const located = planned
    .map((item) => {
      if (item.plan.kind === "adopt") {
        const tag = sectionTag(item.name);
        const at = document.body.indexOf(tag);
        return at < 0 ? null : { item, start: at + 1, tag };
      }
      if (item.plan.kind === "replace" && item.rangeId !== null) return { item, start: item.start, tag: null };
      return null;
    })
    .filter((entry) => entry !== null)
    .sort((a, b) => b.start - a.start);
  for (const { item, start, tag } of located) {
    if (item.plan.kind === "adopt" && tag !== null) {
      requests.push(
        { deleteContentRange: { range: { startIndex: start, endIndex: start + tag.length } } },
        { insertText: { index: start, text: item.plan.text } },
        {
          createNamedRange: {
            name: sectionRangeName(item.name),
            range: { startIndex: start, endIndex: start + item.plan.text.length },
          },
        },
      );
    } else if (item.plan.kind === "replace" && item.rangeId !== null) {
      requests.push({ replaceNamedRangeContent: { namedRangeId: item.rangeId, text: item.plan.text } });
    }
  }
  return requests;
}

async function readTemplate(db: Firestore, key: string): Promise<DocumentTemplateDoc> {
  const parsed = parseStoredDocument(
    documentTemplateDocSchema,
    (await db.doc(COLLECTIONS.documentTemplates.docPath(key)).get()).data(),
  );
  if (!parsed.success) throw new JobFailure("guard", false, "The template of this document is not registered.");
  return parsed.data;
}

/**
 * The meetings a document of a replication lists: meeting pages that keep the replication's own
 * audience, never one restricted to named people, whose title the document's readers may not read.
 */
export function meetingsInAudience(
  replicationId: string,
  pages: readonly { readonly id: string; readonly page: PageDoc }[],
): { title: string; date: string; url: string }[] {
  const audience = new Set([replicationScopeKey(replicationId), MEMBERS_SCOPE_KEY]);
  return pages
    .filter(
      ({ page }) =>
        page.kind === "meeting" &&
        page.archivedAt === null &&
        page.accessMode === "inherit" &&
        page.scopeKeys.some((key) => audience.has(key)),
    )
    .map(({ id, page }) => ({ title: page.title, date: isoDate(page.createdAt.toDate()), url: `#/pages/${id}` }));
}

/**
 * The task lists whose milestones a document of a replication lists: the replication's own, never
 * a personal list, nor a list of a laboratory or a group that only happens to name the replication.
 */
export function replicationListIds(
  replicationId: string,
  lists: readonly { readonly id: string; readonly list: TaskListDoc }[],
): ReadonlySet<string> {
  return new Set(
    lists
      .filter(
        ({ list }) =>
          list.scopeType === "replication" &&
          list.scopeId === replicationId &&
          list.ownerUid === null &&
          list.archivedAt === null,
      )
      .map(({ id }) => id),
  );
}

/** Marks a generated document failed once the queue has spent the attempts of its update. */
export async function markDocumentFailed(db: Firestore, id: string, message: string, at: Date): Promise<void> {
  const reference = db.doc(COLLECTIONS.generatedDocuments.docPath(id));
  if (!(await reference.get()).exists) return;
  await reference.update({
    status: "failed",
    statusReason: `${message} The attempts are spent: an administrator retries the run.`,
    updatedAt: Timestamp.fromDate(at),
    updatedBy: SYNC_ACTOR,
    writeContext: systemWriteContext(),
  });
}

/** Creates or updates one generated document. Throws a `JobFailure` for the queue to retry or end. */
export async function runDocumentUpdate(run: ClaimedRun, dependencies: JobDependencies): Promise<JobOutcome> {
  const { db, clock } = dependencies;
  const documentId = run.generatedDocumentId;
  if (documentId === undefined) throw new JobFailure("guard", false, "A document run names no document.");
  const reference = db.doc(COLLECTIONS.generatedDocuments.docPath(documentId));
  const record = parseStoredDocument(generatedDocumentDocSchema, (await reference.get()).data());
  if (!record.success) throw new JobFailure("guard", false, "The record of this document no longer exists.");
  const generated = record.data;
  const template = await readTemplate(db, generated.templateKey);
  if (!template.enabled) return { status: "skipped", stats: {}, note: "The template is switched off." };
  if (template.externalDocumentId === undefined || template.targetFolderId === undefined) {
    throw new JobFailure("guard", false, "The template names no template document or no folder for its copies.");
  }
  if (dependencies.adapters === null) throw new JobFailure("guard", false, "Not connected: credentials not supplied.");
  const retry = { sleep: dependencies.sleep, random: dependencies.random };
  const drive = retrying(dependencies.adapters.drive, retry);
  const docs = retrying(dependencies.adapters.docs, retry);
  const at = clock.now();
  const reportDate = isoDate(at);
  const definition = DOCUMENT_TEMPLATES[template.kind];
  const { data, sources, title } = await templateData(db, template, generated.entityId, reportDate);
  const portalUrl = `${dependencies.portalUrl}${portalPath(generated.entityType, generated.entityId)}`;
  const provenance: Provenance = { reportDate, portalUrl, sources };
  const texts = renderSections(data, provenance);
  const live = run.mode === "live";

  try {
    // The copy, made once. Outside a shared drive the service account cannot own it.
    let externalId = generated.externalDocumentId;
    if (externalId === undefined) {
      if (!live) {
        return {
          status: "succeeded",
          stats: { sections: definition.sections.length },
          plan: [
            {
              action: "adoptSection",
              detail: `Dry run: a copy of the template would be made in the shared drive as "${title}".`,
            },
          ],
          note: "Dry run: nothing was written.",
        };
      }
      const copy = await drive.copyFile(template.externalDocumentId, title, template.targetFolderId);
      externalId = copy.id;
      await reference.update({
        externalDocumentId: copy.id,
        url: copy.webViewLink,
        title: title.slice(0, 300),
        updatedAt: Timestamp.fromDate(at),
        updatedBy: SYNC_ACTOR,
        writeContext: systemWriteContext(),
      });
    }

    const designatedValue = async (field: string): Promise<Canonical> => {
      if (generated.entityType !== "laboratory") return null;
      const laboratory = await db.doc(COLLECTIONS.laboratories.docPath(generated.entityId)).get();
      const converted = canonicalFromApp({ type: "text" }, laboratory.get(field));
      return converted.ok ? converted.value : null;
    };

    for (let attempt = 1; ; attempt += 1) {
      const document = await docs.getDocument(externalId);
      const planned: Planned[] = [];
      for (const section of definition.sections) {
        const observed = observe(document, section.name);
        const stored = generated.managedSections[section.name];
        const designated =
          section.designatedField === undefined
            ? null
            : { field: section.designatedField, appValue: await designatedValue(section.designatedField) };
        planned.push({
          name: section.name,
          plan: planSection({
            generatedText: texts[section.name] ?? "",
            stored:
              stored === undefined
                ? undefined
                : {
                    status: stored.status,
                    textHash: stored.textHash,
                    ...(stored.base === undefined ? {} : { base: stored.base }),
                  },
            observed,
            tagPresent: document.body.includes(sectionTag(section.name)),
            designated,
          }),
          start: observed.start,
          rangeId: observed.rangeId,
          designatedBase: designated?.appValue,
        });
      }
      const entries: SyncPlanEntry[] = planned.map((item) => ({
        action:
          item.plan.kind === "adopt"
            ? ("adoptSection" as const)
            : item.plan.kind === "replace"
              ? ("writeSection" as const)
              : ("issue" as const),
        field: item.name,
        detail: describePlan(item.plan),
      }));
      if (!live)
        return {
          status: "succeeded",
          stats: { sections: planned.length },
          plan: entries,
          note: "Dry run: nothing was written.",
        };
      const requests = sectionRequests(document, planned);
      let revisionId = document.revisionId;
      if (requests.length > 0) {
        try {
          revisionId = (await docs.batchUpdate(externalId, requests, document.revisionId)).revisionId;
        } catch (error) {
          if (error instanceof ExternalServiceError && error.status === 400 && attempt < STALE_REVISION_ATTEMPTS)
            continue;
          throw error;
        }
      }
      const confirmed = requests.length > 0 ? await confirmRanges(docs, externalId, planned, revisionId) : document;
      await recordSections(db, documentId, generated, planned, confirmed, at, reportDate, run.id);
      const file = await drive.getFile(externalId);
      await reference.update({ lastDriveVersion: file.version, lastRevisionId: confirmed.revisionId });
      const edited = planned.filter((item) => item.plan.kind === "handEdited" || item.plan.kind === "missing").length;
      return {
        status: edited > 0 ? "partial" : "succeeded",
        stats: {
          sectionsWritten: planned.filter((item) => item.plan.kind === "adopt" || item.plan.kind === "replace").length,
          sectionsUnchanged: planned.filter((item) => item.plan.kind === "unchanged").length,
          sectionsEdited: edited,
        },
        plan: entries,
        driveVersion: file.version,
      };
    }
  } catch (error) {
    const failure = failureOf(error, dependencies.adapters?.kind ?? null);
    // A failure that the queue retries leaves the document waiting, and the runner marks it
    // failed only once the attempts are spent.
    await reference.update({
      status: failure.retryable ? "stale" : "failed",
      statusReason: failure.retryable ? `${failure.message} The update will be tried again.` : failure.message,
      updatedAt: Timestamp.fromDate(clock.now()),
      updatedBy: SYNC_ACTOR,
      writeContext: systemWriteContext(),
    });
    throw failure;
  }
}

function describePlan(plan: SectionPlan): string {
  switch (plan.kind) {
    case "adopt":
      return "The tag is replaced by generated text, anchored by a named range.";
    case "replace":
      return "The section still holds the text last generated, and is updated.";
    case "unchanged":
      return "The section is up to date.";
    case "handEdited":
      return "A person changed the section. Nothing is written until a reviewer decides.";
    case "missing":
      return "The section's range has gone from the document. Nothing is written.";
    case "detached":
      return "A reviewer kept the human text, so the section is generated no more.";
    case "noTag":
      return "The template has no tag for this section.";
  }
}

/**
 * Reads the document after a write and confirms that each written range covers its new text.
 * Whether replacing a range's content keeps the range is unstated, so a range that has gone is
 * created again over the text, where the text is found exactly once.
 */
async function confirmRanges(
  docs: DocsAdapter,
  documentId: string,
  planned: readonly Planned[],
  revisionId: string,
): Promise<DocsDocument> {
  const document = await docs.getDocument(documentId);
  const requests: DocsRequest[] = [];
  for (const item of planned) {
    if (item.plan.kind !== "adopt" && item.plan.kind !== "replace") continue;
    if (observe(document, item.name).found) continue;
    const at = document.body.indexOf(item.plan.text);
    if (at < 0 || document.body.indexOf(item.plan.text, at + 1) >= 0) continue;
    requests.push({
      createNamedRange: {
        name: sectionRangeName(item.name),
        range: { startIndex: at + 1, endIndex: at + 1 + item.plan.text.length },
      },
    });
  }
  if (requests.length === 0) return document;
  await docs.batchUpdate(documentId, requests, revisionId === document.revisionId ? revisionId : document.revisionId);
  return docs.getDocument(documentId);
}

async function recordSections(
  db: Firestore,
  documentId: string,
  generated: GeneratedDocumentDoc,
  planned: readonly Planned[],
  document: DocsDocument,
  at: Date,
  reportDate: string,
  runId: string,
): Promise<void> {
  const now = Timestamp.fromDate(at);
  const sections: Record<string, ManagedSection> = { ...generated.managedSections };
  const definition = DOCUMENT_TEMPLATES[(await readTemplate(db, generated.templateKey)).kind];
  for (const item of planned) {
    const section = definition.sections.find((candidate) => candidate.name === item.name);
    const previous = sections[item.name];
    if (item.plan.kind === "adopt" || item.plan.kind === "replace") {
      const observed = observe(document, item.name);
      const text = observed.text ?? item.plan.text;
      sections[item.name] = {
        rangeName: sectionRangeName(item.name),
        status: observed.found ? "current" : "missing",
        textHash: sectionTextHash(text),
        ...(section?.designatedField === undefined || item.designatedBase === undefined
          ? {}
          : { base: item.designatedBase }),
        generatedAt: now,
      };
    } else if (item.plan.kind === "missing" && previous !== undefined) {
      sections[item.name] = { ...previous, status: "missing" };
    } else if (item.plan.kind === "handEdited" && previous !== undefined) {
      sections[item.name] = { ...previous, status: "edited" };
      const designated = item.plan.designated;
      await upsertConflict(
        db,
        {
          origin: "document",
          generatedDocumentId: documentId,
          section: item.name,
          entityType: generated.entityType,
          entityId: generated.entityId,
          recordId: generated.entityId,
          ...(designated === null ? {} : { field: designated.field }),
          label: `${section?.label ?? item.name} section of ${generated.title}`,
          base: designated === null ? null : designated.base,
          app: designated === null ? null : designated.appValue,
          external: designated === null ? normaliseText(item.plan.documentText) : designated.documentValue,
        },
        at,
      );
    }
  }
  const attention = Object.values(sections).some(
    (section) => section.status === "edited" || section.status === "missing",
  );
  await db.doc(COLLECTIONS.generatedDocuments.docPath(documentId)).update({
    managedSections: sections,
    lastGeneratedAt: now,
    reportDate,
    status: attention ? "edited" : "current",
    statusReason: attention
      ? "A managed section was edited by hand or has gone. It is left as it is until a reviewer decides."
      : `Updated by run ${runId}.`,
    updatedAt: now,
    updatedBy: SYNC_ACTOR,
    writeContext: systemWriteContext(),
  });
}

/** The text a section would be generated with now, from the records it describes. */
export async function currentSectionText(
  db: Firestore,
  generated: GeneratedDocumentDoc,
  section: string,
  portalUrl: string,
  at: Date,
): Promise<string> {
  const template = await readTemplate(db, generated.templateKey);
  const reportDate = isoDate(at);
  const { data, sources } = await templateData(db, template, generated.entityId, reportDate);
  const texts = renderSections(data, {
    reportDate,
    portalUrl: `${portalUrl}${portalPath(generated.entityType, generated.entityId)}`,
    sources,
  });
  const text = texts[section];
  if (text === undefined) throw new JobFailure("guard", false, "The template has no such section.");
  return text;
}

/** The text of a section as the document holds it now, or null where its range has gone. */
export async function sectionTextNow(docs: DocsAdapter, externalId: string, section: string): Promise<string | null> {
  return observe(await docs.getDocument(externalId), section).text;
}

/**
 * Writes a section on a reviewer's decision, over whatever a person wrote in it: the one
 * place where a hand edit is replaced, and only because a person chose so. With `detach`, the
 * section keeps the human text and is generated no more. The record of the document is updated
 * with the new state of the section.
 */
export async function settleSection(
  db: Firestore,
  docs: DocsAdapter,
  generatedId: string,
  section: string,
  decision:
    | { readonly kind: "rewrite"; readonly text: string; readonly base?: Canonical }
    | { readonly kind: "detach" },
  at: Date,
): Promise<void> {
  const reference = db.doc(COLLECTIONS.generatedDocuments.docPath(generatedId));
  const record = parseStoredDocument(generatedDocumentDocSchema, (await reference.get()).data());
  if (!record.success || record.data.externalDocumentId === undefined) {
    throw new JobFailure("guard", false, "The generated document no longer exists.");
  }
  const previous = record.data.managedSections[section];
  if (previous === undefined) throw new JobFailure("guard", false, "The document has no such section.");
  const now = Timestamp.fromDate(at);
  let next: ManagedSection;
  if (decision.kind === "detach") {
    next = { ...previous, status: "detached" };
  } else {
    const document = await docs.getDocument(record.data.externalDocumentId);
    const observed = observe(document, section);
    if (observed.rangeId === null)
      throw new JobFailure("guard", false, "The section's range has gone from the document.");
    const written = await docs.batchUpdate(
      record.data.externalDocumentId,
      [{ replaceNamedRangeContent: { namedRangeId: observed.rangeId, text: decision.text } }],
      document.revisionId,
    );
    await confirmRanges(
      docs,
      record.data.externalDocumentId,
      [
        {
          name: section,
          plan: { kind: "replace", text: decision.text },
          start: observed.start,
          rangeId: observed.rangeId,
          designatedBase: undefined,
        },
      ],
      written.revisionId,
    );
    next = {
      rangeName: sectionRangeName(section),
      status: "current",
      textHash: sectionTextHash(decision.text),
      ...(decision.base === undefined ? {} : { base: decision.base }),
      generatedAt: now,
    };
  }
  const sections = { ...record.data.managedSections, [section]: next };
  const attention = Object.values(sections).some((item) => item.status === "edited" || item.status === "missing");
  await reference.update({
    managedSections: sections,
    status: attention ? "edited" : "current",
    updatedAt: now,
    updatedBy: SYNC_ACTOR,
    writeContext: systemWriteContext(),
  });
}
