// Workspace (docs/DATA_MODEL.md, section 9): pages and their Yjs content (D-010), threads and
// comments, attachments, user-created databases, custom properties, views and dashboards.
import { bytesSchema } from "../bytes";
import { entityTypeSchema } from "../entities";
import { timestampSchema } from "../timestamp";
import { z } from "../zod";
import {
  actorSchema,
  appendOnlyBaseSchema,
  boundedRecord,
  customValuesSchema,
  documentBaseSchema,
  entityRefShape,
  freeMapSchema,
  idListSchema,
  idSchema,
  keySchema,
  LIMITS,
  longTextSchema,
  mapKeySchema,
  provenanceShape,
  richTextSchema,
  scopeFieldsShape,
  scopeKeysSchema,
  shortTextSchema,
  uidListSchema,
  uidSchema,
} from "./base";

export const pageKindSchema = z.enum(["custom", "entity", "meeting", "report", "decision", "template"]);
export const pageAccessModeSchema = z.enum(["inherit", "restricted"]);
export const pageLevelSchema = z.enum(["view", "comment", "edit", "full"]);
export type PageLevel = z.output<typeof pageLevelSchema>;

/** For each level above `view`, the scope keys that hold at least that level on a page or a database. */
export const levelKeysSchema = z.strictObject({
  comment: scopeKeysSchema,
  edit: scopeKeysSchema,
  full: scopeKeysSchema,
});

/** A fractional index, which places an item between two others by writing one document. */
const orderSchema = z.string().min(1).max(100);
const iconSchema = z.string().min(1).max(64);

const chunkCountSchema = z.number().int().min(0).max(10_000);
const byteLengthSchema = z.number().int().min(0);

/**
 * `pages/{pageId}`: a page. The body of an entity takes the identifier `entityType__entityId`.
 * `scopeKeys` and `levelKeys` are resolved by a function from the permissions of the page, its
 * parent page or its entity, and the rules read those two fields alone.
 */
export const pageDocSchema = documentBaseSchema.extend({
  parentPageId: idSchema.nullable(),
  ancestorPageIds: z.array(idSchema).max(50),
  /** Set, with `entityId`, when the page is the body of an entity. */
  entityType: entityTypeSchema.exactOptional(),
  entityId: idSchema.exactOptional(),
  kind: pageKindSchema,
  title: shortTextSchema,
  icon: iconSchema.exactOptional(),
  order: orderSchema,
  isTemplate: z.boolean(),
  templateSourceId: idSchema.exactOptional(),
  accessMode: pageAccessModeSchema,
  ...scopeFieldsShape,
  levelKeys: levelKeysSchema,
  /** The generation of the merged snapshot that is current, or null while the page has none. */
  contentHead: z
    .strictObject({
      generation: z.number().int().min(0),
      chunkCount: chunkCountSchema,
      byteLength: byteLengthSchema,
      stateVector: bytesSchema,
      compactedAt: timestampSchema,
    })
    .nullable(),
  plainTextExcerpt: z.string().max(1_000).exactOptional(),
  mentionUids: uidListSchema,
  tagIds: idListSchema,
  lastEditedBy: actorSchema.nullable(),
});
export type PageDoc = z.output<typeof pageDocSchema>;

/** `pages/{pageId}/content/{generation__n}`: one chunk of the merged Yjs snapshot of a generation. */
export const pageContentChunkDocSchema = appendOnlyBaseSchema.extend({
  pageId: idSchema,
  generation: z.number().int().min(0),
  index: z.number().int().min(0),
  snapshot: bytesSchema,
});
export type PageContentChunkDoc = z.output<typeof pageContentChunkDocSchema>;

/**
 * `pages/{pageId}/updates/{id}`: a Yjs update awaiting compaction. Editors create updates, and
 * no client changes or removes one. An update too large for one document is split into parts
 * that share `updateId`.
 */
export const pageUpdateDocSchema = appendOnlyBaseSchema.extend({
  pageId: idSchema,
  updateId: idSchema,
  /** The part, counted from 0, and the number of parts of a split update. */
  index: z.number().int().min(0),
  count: z.number().int().min(1).max(1_000),
  update: bytesSchema,
  uid: uidSchema,
  /** The Yjs client identifier of the editor session. */
  clientId: z.number().int().min(0),
});
export type PageUpdateDoc = z.output<typeof pageUpdateDocSchema>;

export const pageVersionKindSchema = z.enum(["auto", "manual", "restore"]);

/** `pages/{pageId}/versions/{id}`: a snapshot stored by a function. Restoring one writes a new forward change. */
export const pageVersionDocSchema = appendOnlyBaseSchema.extend({
  pageId: idSchema,
  label: shortTextSchema.exactOptional(),
  kind: pageVersionKindSchema,
  restoredFromVersionId: idSchema.exactOptional(),
  chunkCount: chunkCountSchema,
  byteLength: byteLengthSchema,
});
export type PageVersionDoc = z.output<typeof pageVersionDocSchema>;

/** `pages/{pageId}/versions/{id}/chunks/{n}`: one chunk of the snapshot of a version. */
export const pageVersionChunkDocSchema = appendOnlyBaseSchema.extend({
  pageId: idSchema,
  versionId: idSchema,
  index: z.number().int().min(0),
  snapshot: bytesSchema,
});
export type PageVersionChunkDoc = z.output<typeof pageVersionChunkDocSchema>;

export const principalTypeSchema = z.enum(["user", "group", "role"]);

/** `pages/{pageId}/permissions/{principalType__principalId}`: the level of one principal on a restricted page. */
export const pagePermissionDocSchema = documentBaseSchema.extend({
  pageId: idSchema,
  principalType: principalTypeSchema,
  principalId: idSchema,
  level: pageLevelSchema,
});
export type PagePermissionDoc = z.output<typeof pagePermissionDocSchema>;

/**
 * `threads/{id}`: a thread of comments on any record. It carries the audience of its target as
 * scope fields, and one marked `restricted` takes the audience of the target's restricted document.
 */
export const threadDocSchema = documentBaseSchema.extend({
  targetType: entityTypeSchema,
  targetId: idSchema,
  /** Where in the target the thread is anchored: a block of a page, or a field of a record. */
  anchor: z
    .strictObject({
      blockId: z.string().min(1).max(200).exactOptional(),
      field: mapKeySchema.exactOptional(),
    })
    .exactOptional(),
  restricted: z.boolean(),
  ...scopeFieldsShape,
  resolvedAt: timestampSchema.nullable(),
  resolvedBy: actorSchema.nullable(),
  ...provenanceShape,
});
export type ThreadDoc = z.output<typeof threadDocSchema>;

/** `threads/{id}/comments/{id}`: a comment. Its author edits it, and removes it by setting `deletedAt`. */
export const threadCommentDocSchema = documentBaseSchema.extend({
  threadId: idSchema,
  /** Absent on an imported comment whose author has no login, whom `sourceAuthor` then names. */
  authorUid: uidSchema.exactOptional(),
  body: richTextSchema,
  mentionUids: uidListSchema,
  editedAt: timestampSchema.nullable(),
  deletedAt: timestampSchema.nullable(),
  ...scopeFieldsShape,
  ...provenanceShape,
});
export type ThreadCommentDoc = z.output<typeof threadCommentDocSchema>;

/** `attachments/{id}`: the metadata of a file attached to any record. The file itself is in Cloud Storage. */
export const attachmentDocSchema = documentBaseSchema.extend({
  ...entityRefShape,
  storagePath: z.string().min(1).max(1_024),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().min(0),
  sha256: z
    .string()
    .max(64)
    .regex(/^[0-9a-f]{64}$/, { error: "Expected a SHA-256 hash in hexadecimal" }),
  uploadedBy: actorSchema,
  restricted: z.boolean(),
  ...scopeFieldsShape,
  ...provenanceShape,
});
export type AttachmentDoc = z.output<typeof attachmentDocSchema>;

export const propertyTypeSchema = z.enum([
  "text",
  "richText",
  "number",
  "date",
  "dateRange",
  "email",
  "url",
  "checkbox",
  "person",
  "status",
  "select",
  "multiSelect",
  "file",
  "relation",
  "rollup",
  "formula",
  "createdTime",
  "editedTime",
  "createdBy",
  "editedBy",
]);
export type PropertyType = z.output<typeof propertyTypeSchema>;

const propertyShape = {
  key: keySchema,
  name: shortTextSchema,
  type: propertyTypeSchema,
  /** Options, the relation target, the rollup specification, the formula expression and the number format. */
  config: freeMapSchema,
  order: orderSchema,
  archivedAt: timestampSchema.nullable(),
};

/** The definition of one property of a user-created database. */
export const propertyDefinitionSchema = z.strictObject(propertyShape);

export const propertyAudienceSchema = z.enum(["member", "restricted"]);

/**
 * The definition of one custom property of a core collection. The value of a `member` property
 * sits in the `custom` map of the core document, and the value of a `restricted` property in
 * `private/custom` beneath it.
 */
export const coreCustomPropertySchema = z.strictObject({ ...propertyShape, audience: propertyAudienceSchema });

const PROPERTIES_MAX = 200;

/** `databases/{databaseId}`: a user-created database, with its property definitions. */
export const databaseDocSchema = documentBaseSchema.extend({
  name: shortTextSchema,
  description: longTextSchema.exactOptional(),
  icon: iconSchema.exactOptional(),
  parentPageId: idSchema,
  isTemplate: z.boolean(),
  templateSourceId: idSchema.exactOptional(),
  properties: boundedRecord(mapKeySchema, propertyDefinitionSchema, PROPERTIES_MAX),
  /** Copied, like `levelKeys`, from the parent page. */
  scopeKeys: scopeKeysSchema,
  levelKeys: levelKeysSchema,
});
export type DatabaseDoc = z.output<typeof databaseDocSchema>;

/** `databases/{databaseId}/rows/{rowId}`: one row, with its values keyed by property identifier. */
export const databaseRowDocSchema = documentBaseSchema.extend({
  databaseId: idSchema,
  title: shortTextSchema,
  values: boundedRecord(mapKeySchema, z.unknown(), PROPERTIES_MAX),
  order: orderSchema,
  pageId: idSchema.nullable(),
  tagIds: idListSchema,
});
export type DatabaseRowDoc = z.output<typeof databaseRowDocSchema>;

/** The core collections that accept custom properties. */
export const CUSTOMISABLE_COLLECTIONS = [
  "replications",
  "laboratories",
  "participations",
  "datasets",
  "tasks",
  "manuscripts",
  "persons",
] as const;

/** The key of a collection as views and custom properties address it: `core:<collection>` or `db:<databaseId>`. */
export const collectionKeySchema = z
  .string()
  .max(LIMITS.identifier + 5)
  .regex(/^(?:core:[A-Za-z]+|db:[^/]+)$/, { error: "Expected a collection key such as core:replications" });

/** `collectionSchemas/{collectionKey}`: the custom property definitions of a core collection. */
export const collectionSchemaDocSchema = documentBaseSchema.extend({
  collectionKey: z.enum(
    CUSTOMISABLE_COLLECTIONS.map((name) => `core:${name}`) as [
      `core:${(typeof CUSTOMISABLE_COLLECTIONS)[number]}`,
      ...`core:${(typeof CUSTOMISABLE_COLLECTIONS)[number]}`[],
    ],
  ),
  properties: boundedRecord(mapKeySchema, coreCustomPropertySchema, PROPERTIES_MAX),
});
export type CollectionSchemaDoc = z.output<typeof collectionSchemaDocSchema>;

/**
 * `{coreCollection}/{id}/private/custom`: the values of the restricted custom properties of a
 * core document, so that a custom field for a telephone number is never readable by every member.
 */
export const privateCustomDocSchema = documentBaseSchema.extend({
  custom: customValuesSchema,
});
export type PrivateCustomDoc = z.output<typeof privateCustomDocSchema>;

export const viewTypeSchema = z.enum(["table", "list", "board", "calendar", "timeline", "gallery"]);

/**
 * `views/{viewId}`: a stored definition of filters, sorts, grouping and visible properties,
 * which the browser applies to the documents it is permitted to load (D-011).
 */
export const viewDocSchema = documentBaseSchema.extend({
  collectionKey: collectionKeySchema,
  name: shortTextSchema,
  type: viewTypeSchema,
  /** Filter tree, sorts, grouping, visible properties, column order and widths, card layout, date properties. */
  config: freeMapSchema,
  /** A fixed filter such as one replication. */
  scope: freeMapSchema.exactOptional(),
  /** The creator, who alone sees the view until `isShared` is set. */
  ownerUid: uidSchema,
  isShared: z.boolean(),
  pageId: idSchema.nullable(),
  order: orderSchema,
});
export type ViewDoc = z.output<typeof viewDocSchema>;

export const dashboardScopeTypeSchema = z.enum(["programme", "replication", "laboratory", "group", "user"]);
export const widgetTypeSchema = z.enum(["view", "kpi", "chart", "timeline", "calendar", "activity", "note", "embed"]);

const gridSchema = z.number().int().min(0).max(1_000);

export const dashboardWidgetSchema = z.strictObject({
  type: widgetTypeSchema,
  config: freeMapSchema,
  x: gridSchema,
  y: gridSchema,
  w: gridSchema,
  h: gridSchema,
});

/** `dashboards/{id}`: a dashboard of the programme, a replication, a laboratory, a group or a user. */
export const dashboardDocSchema = documentBaseSchema.extend({
  scopeType: dashboardScopeTypeSchema,
  scopeId: idSchema,
  /** The owner of a user's dashboard, and null for every other dashboard. */
  ownerUid: uidSchema.nullable(),
  name: shortTextSchema,
  widgets: boundedRecord(mapKeySchema, dashboardWidgetSchema, 100),
  ...scopeFieldsShape,
});
export type DashboardDoc = z.output<typeof dashboardDocSchema>;
