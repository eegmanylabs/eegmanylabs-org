// The registry of entity types: the kinds of record that a polymorphic reference (the pair
// `entityType` and `entityId`) can point at (docs/DATA_MODEL.md, section 1). The collection of
// each type and the path of a referenced document are in collections.ts, next to the registry
// they are checked against. Add a row here, and there, when a new kind of record can be
// referenced that way.
import { z } from "./zod";

/**
 * | Entity type              | Document                                               |
 * |--------------------------|--------------------------------------------------------|
 * | `user`                   | `users/{uid}`                                          |
 * | `person`                 | `persons/{personId}`                                   |
 * | `institution`            | `institutions/{id}`                                    |
 * | `group`                  | `groups/{groupKey}`                                    |
 * | `programme`              | `programmes/{key}`                                     |
 * | `laboratory`             | `laboratories/{laboratoryId}`                          |
 * | `equipmentConfiguration` | `laboratories/{laboratoryId}/equipment/{configurationId}` |
 * | `replication`            | `replications/{studyKey}`                              |
 * | `hypothesis`             | `replications/{studyKey}/hypotheses/{hNN}`             |
 * | `protocol`               | `replications/{studyKey}/protocols/{id}`               |
 * | `protocolVersion`        | `replications/{studyKey}/protocolVersions/{id}`        |
 * | `candidateStudy`         | `candidateStudies/{id}`                                |
 * | `participation`          | `participations/{studyKey__laboratoryId}`              |
 * | `recruitmentReport`      | `recruitmentReports/{id}`                              |
 * | `taskList`               | `taskLists/{id}`                                       |
 * | `task`                   | `tasks/{id}`                                           |
 * | `page`                   | `pages/{pageId}`                                       |
 * | `thread`                 | `threads/{id}`                                         |
 * | `comment`                | `threads/{threadId}/comments/{commentId}`              |
 * | `attachment`             | `attachments/{id}`                                     |
 * | `database`               | `databases/{databaseId}`                               |
 * | `databaseRow`            | `databases/{databaseId}/rows/{rowId}`                  |
 * | `view`                   | `views/{viewId}`                                       |
 * | `dashboard`              | `dashboards/{id}`                                      |
 * | `storageEndpoint`        | `storageEndpoints/{key}`                               |
 * | `dataset`                | `datasets/{datasetKey}`                                |
 * | `processingRun`          | `processingRuns/{id}`                                  |
 * | `manuscript`             | `manuscripts/{id}`                                     |
 * | `contributorTable`       | `contributorTables/{id}`                               |
 * | `contributor`            | `contributors/{id}`                                    |
 * | `decision`               | `decisions/{id}`                                       |
 * | `risk`                   | `risks/{id}`                                           |
 * | `incident`               | `incidents/{id}`                                       |
 * | `meeting`                | `meetings/{id}`                                        |
 * | `progressReport`         | `progressReports/{id}`                                 |
 * | `documentLink`           | `documentLinks/{id}`                                   |
 * | `source`                 | `sources/{key}`                                        |
 * | `importBatch`            | `importBatches/{batchId}`                              |
 * | `integrationConnection`  | `integrationConnections/{system}`                      |
 * | `syncMapping`            | `syncMappings/{id}`                                    |
 * | `syncRun`                | `syncRuns/{id}`                                        |
 * | `syncConflict`           | `syncConflicts/{id}`                                   |
 * | `syncReviewItem`         | `syncReviewItems/{id}`                                 |
 * | `documentTemplate`       | `documentTemplates/{key}`                              |
 * | `generatedDocument`      | `generatedDocuments/{templateKey__entityType__entityId}` |
 * | `publicationBatch`       | `publicationBatches/{id}`                              |
 * | `automationRule`         | `automationRules/{id}`                                 |
 * | `scheduledReport`        | `scheduledReports/{id}`                                |
 *
 * The identifier of an entity in a subcollection joins the identifier of its parent document
 * to its own with two underscores, as in `AmodioJost2007__h01` for a hypothesis. Build it with
 * `nestedEntityId` and resolve it with `entityPath`.
 */
export const ENTITY_TYPES = [
  "user",
  "person",
  "institution",
  "group",
  "programme",
  "laboratory",
  "equipmentConfiguration",
  "replication",
  "hypothesis",
  "protocol",
  "protocolVersion",
  "candidateStudy",
  "participation",
  "recruitmentReport",
  "taskList",
  "task",
  "page",
  "thread",
  "comment",
  "attachment",
  "database",
  "databaseRow",
  "view",
  "dashboard",
  "storageEndpoint",
  "dataset",
  "processingRun",
  "manuscript",
  "contributorTable",
  "contributor",
  "decision",
  "risk",
  "incident",
  "meeting",
  "progressReport",
  "documentLink",
  "source",
  "importBatch",
  "integrationConnection",
  "syncMapping",
  "syncRun",
  "syncConflict",
  "syncReviewItem",
  "documentTemplate",
  "generatedDocument",
  "publicationBatch",
  "automationRule",
  "scheduledReport",
] as const;
export const entityTypeSchema = z.enum(ENTITY_TYPES);
export type EntityType = z.output<typeof entityTypeSchema>;
